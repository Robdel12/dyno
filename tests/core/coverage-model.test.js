import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import libInstrument from 'istanbul-lib-instrument';
import { acceptCoverage, createCoverageState, finalizeCoverage, mergeCoverageResults, releaseCoverage } from '../../src/coverage-model.js';
import { publicCoverage, writeCoverageReport } from '../../src/coverage-reports.js';

let source = `function choose(value) {\n  if (value) return 'yes';\n  return 'no';\n}\nglobalThis.choose = choose;\n`;
let options = { include: ['src/**'], exclude: [], reporters: ['html', 'lcov', 'json', 'json-summary'] };
let packet = (coverage, sequence = 1, documentId = 'document') => ({ executionId: 'execution', documentId, sequence, coverage });
let accept = (state, data, sequence = 1, document = 'document', workerId = '0') =>
  acceptCoverage(state, packet(data, sequence, document), { workerId });

async function project(t) {
  let root = await mkdtemp(join(tmpdir(), 'dyno-coverage-model-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  return root;
}

function instrument(path, code = source, inputSourceMap) {
  let instrumenter = libInstrument.createInstrumenter({ esModules: true });
  let output = instrumenter.instrumentSync(code, path, inputSourceMap);
  let context = vm.createContext({});
  vm.runInContext(output, context);
  return {
    baseline: structuredClone(instrumenter.fileCoverage),
    snapshot() { return JSON.parse(JSON.stringify(context.__coverage__)); },
    choose(value) { vm.runInContext(`choose(${JSON.stringify(value)})`, context); },
  };
}

test('coverage retains the latest document counters once across updates, workers, and retries', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let app = instrument(path);
  app.choose(true);
  let early = app.snapshot();
  let initial = createCoverageState();
  let first = accept(initial, early);
  app.choose(false);
  let final = app.snapshot();
  let state = accept(first, final, 2);
  assert.equal(accept(state, final, 2), state);
  assert.equal(accept(state, early, 1), state);
  let other = instrument(path);
  other.choose(true);
  state = accept(state, other.snapshot(), 1, 'document', '1');
  let result = await finalizeCoverage(state, options, { root });
  assert.equal(result.status, 'complete');
  assert.equal(result.data[path].f[0], 3);
  assert.equal(first.documents[0].data[path].f[0], 1);
  assert.equal(initial.documents.length, 0);
  final[path].f[0] = 99;
  assert.equal(result.data[path].f[0], 3);
  assert.throws(() => accept(state, early, 2), /replay changed/);
});

test('coverage rejects changed app builds, malformed counters, and counters that reset within a document', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let app = instrument(path);
  app.choose(true);
  let data = app.snapshot();
  let state = accept(createCoverageState(), data);
  let changed = instrument(path, source.replace('yes', 'changed'));
  assert.throws(() => accept(state, changed.snapshot(), 1, 'other'), /source changed/);
  let decreased = structuredClone(data);
  decreased[path].f[0] = 0;
  assert.throws(() => accept(state, decreased, 2), /counters decreased/);
  assert.throws(() => accept(state, {}, 2), /snapshot lost/);
  let bad = structuredClone(data);
  bad[path].s[0] = -1;
  assert.throws(() => accept(createCoverageState(), bad), /invalid statements/);
  bad[path].s[0] = Number.NaN;
  assert.throws(() => accept(createCoverageState(), bad), /invalid statements/);
  bad[path].s[0] = 1;
  bad[path].s.extra = 0;
  assert.throws(() => accept(createCoverageState(), bad), /invalid statements/);
  assert.throws(() => acceptCoverage(state, packet(data, 0), { workerId: '0' }), /positive sequence/);
  for (let error of [null, 42, {}])
    assert.throws(() => acceptCoverage(state, { ...packet(data, 2), error }, { workerId: '0' }), /collection error/);
});

test('a collection error preserves acknowledged document counters and makes coverage partial', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let app = instrument(path);
  app.choose(true);
  let state = accept(createCoverageState(), app.snapshot());
  for (let coverage of [null, {}]) {
    let failed = acceptCoverage(state, { ...packet(coverage, 2), error: 'The app document could not be read.' }, { workerId: '0' });
    let result = await finalizeCoverage(failed, options, { root });
    assert.equal(result.status, 'partial');
    assert.equal(result.failed, true);
    assert.equal(result.data[path].f[0], 1);
    assert.match(result.failures.join(' '), /could not be read/);
  }
});

test('releasing many executions folds their counters once without retaining repeated source maps', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let app = instrument(path, 'globalThis.counter = 1;\n'.repeat(6000) + source);
  app.choose(true);
  let data = app.snapshot();
  let singleBytes = Buffer.byteLength(JSON.stringify(data));
  assert(singleBytes > 400000);
  let state = createCoverageState();
  for (let index = 0; index < 100; index++) {
    let executionId = 'execution-' + index;
    state = acceptCoverage(state, { ...packet(data), executionId }, { workerId: '0' });
    state = releaseCoverage(state, { workerId: '0', executionId });
    assert.equal(releaseCoverage(state, { workerId: '0', executionId }), state);
  }
  assert.equal(state.documents.length, 0);
  assert(state.bytes < singleBytes * 1.1);
  let result = await finalizeCoverage(state, options, { root });
  assert.equal(result.status, 'complete');
  assert.equal(result.data[path].f[0], 100);
  let changed = instrument(path, source);
  assert.throws(() => accept(state, changed.snapshot()), /source changed/);
});

test('source maps report original TypeScript and a baseline includes a never-loaded source', async t => {
  let root = await project(t);
  let original = join(root, 'src/app.ts');
  let typed = source.replace('choose(value)', 'choose(value: boolean): string');
  let output = await transform(typed, { loader: 'ts', sourcefile: original, sourcemap: 'external' });
  let generated = join(root, 'build/app.js');
  let app = instrument(generated, output.code, JSON.parse(output.map));
  app.choose(true);
  app.choose(false);
  let absent = instrument(join(root, 'src/never.js'), 'function never() { return 7; }');
  let baseline = join(root, 'baseline.json');
  await writeFile(baseline, JSON.stringify({ [generated]: app.baseline, [absent.baseline.path]: absent.baseline }));
  let state = accept(createCoverageState(), app.snapshot());
  let result = await finalizeCoverage(state, { ...options, include: ['src/**/*.{ts,js}'], baseline }, { root });
  assert.equal(result.scope, 'all-files');
  assert.deepEqual(Object.keys(result.data).sort(), [original, absent.baseline.path].sort());
  assert.equal(result.data[absent.baseline.path].f[0], 0);
  assert.equal(result.summary.functions.pct, 50);
  assert.equal(result.sources[original], typed);
  let excluded = await finalizeCoverage(state, { ...options, baseline, exclude: ['src/never.js'] }, { root });
  assert.equal(excluded.summary.functions.pct, 100);
  await writeFile(absent.baseline.path, 'function never() { return 7; }');
  let directory = join(root, 'report/coverage');
  let written = await writeCoverageReport(result, directory, options, { root });
  assert(written.files.includes('index.html'));
  assert(written.files.includes('lcov.info'));
  assert(written.files.includes('coverage-final.json'));
  let lcov = await readFile(join(directory, 'lcov.info'), 'utf8');
  assert.match(lcov, /src\/app.ts/);
  assert.match(lcov, /src\/never.js/);
  assert.equal(written.bytes, (await Promise.all(written.files.map(file => stat(join(directory, file))))).reduce((total, info) => total + info.size, 0));
  let saved = JSON.parse(await readFile(join(directory, 'coverage-summary.json'), 'utf8'));
  for (let metric of ['lines', 'statements', 'functions', 'branches'])
    assert.deepEqual(saved.total[metric], result.summary[metric]);
  let metadata = publicCoverage(result);
  assert(!Object.hasOwn(metadata, 'sources'));
  assert(!Object.hasOwn(metadata, 'data'));
});

test('baselines must have zero counters and agree with the instrumented app', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let app = instrument(path);
  app.choose(true);
  let state = accept(createCoverageState(), app.snapshot());
  let baseline = join(root, 'baseline.json');
  await writeFile(baseline, JSON.stringify(app.snapshot()));
  await assert.rejects(finalizeCoverage(state, { ...options, baseline }, { root }), /baseline counters must be zero/);
  let changed = instrument(path, source + 'choose(true);');
  await writeFile(baseline, JSON.stringify({ [path]: changed.baseline }));
  await assert.rejects(finalizeCoverage(state, { ...options, baseline }, { root }), /source changed/);
});

test('missing and interrupted collection cannot pass thresholds or become coverage from a baseline alone', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let app = instrument(path);
  let baseline = join(root, 'baseline.json');
  await writeFile(baseline, JSON.stringify({ [path]: app.baseline }));
  let empty = await finalizeCoverage(createCoverageState(), { ...options, baseline }, { root });
  assert.equal(empty.status, 'unavailable');
  assert.equal(empty.failed, true);
  let state = accept(createCoverageState(), app.snapshot());
  let interrupted = await finalizeCoverage(state, { ...options, thresholds: { lines: 0 } }, { root, complete: false });
  assert.equal(interrupted.status, 'partial');
  assert.equal(interrupted.failed, true);
  assert.match(interrupted.failures.join(' '), /every worker completed/);
  let filtered = await finalizeCoverage(state, { ...options, include: ['not-here/**'] }, { root });
  assert.equal(filtered.status, 'unavailable');
});

test('coverage thresholds use exact counts and repeated rounds evaluate their union', async t => {
  let root = await project(t);
  let path = join(root, 'src/app.js');
  let rounds = [];
  for (let value of [true, false]) {
    let app = instrument(path);
    app.choose(value);
    let state = accept(createCoverageState(), app.snapshot());
    let result = await finalizeCoverage(state, { ...options, thresholds: { branches: 100 } }, { root, evaluate: false });
    assert.equal(result.failed, false);
    assert.equal(result.summary.branches.pct, 50);
    rounds.push(result);
  }
  let combined = mergeCoverageResults(rounds, { ...options, thresholds: { branches: 100 } }, { root });
  assert.equal(combined.summary.branches.pct, 100);
  assert.equal(combined.data[path].f[0], 2);
  assert.equal(combined.failed, false);
  let failed = mergeCoverageResults([rounds[0]], { ...options, thresholds: { branches: 90 } }, { root });
  assert.equal(failed.failed, true);
  assert.match(failed.failures[0], /branches coverage is 50%, below the 90% threshold/);
  let changed = instrument(path, source.replace('yes', 'changed'));
  let other = await finalizeCoverage(accept(createCoverageState(), changed.snapshot()), options, { root });
  assert.throws(() => mergeCoverageResults([rounds[0], other], options, { root }), /source changed/);
});

test('HTML source lookup cannot follow a project symlink outside the project root', async t => {
  let root = await project(t);
  let external = await mkdtemp(join(tmpdir(), 'dyno-external-source-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  let secret = 'OUTSIDE_SOURCE_MUST_NOT_BE_READ';
  await writeFile(join(external, 'private.js'), secret);
  let path = join(root, 'src/app.js');
  await symlink(join(external, 'private.js'), path);
  let app = instrument(path);
  let result = await finalizeCoverage(accept(createCoverageState(), app.snapshot()), options, { root });
  let directory = join(root, 'coverage');
  let written = await writeCoverageReport(result, directory, options, { root });
  for (let file of written.files.filter(file => file.endsWith('.html')))
    assert(!(await readFile(join(directory, file), 'utf8')).includes(secret));
});
