import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { frameworkCoverageReport, frameworkCoverageTarget } from '../../scripts/coverage/report.js';

let root = fileURLToPath(new URL('../../', import.meta.url));

test('framework coverage preserves Node shutdown behavior and saves real counter hits', { timeout: 10000 }, async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-self-coverage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  let filename = join(directory, 'source.js');
  let instrumenter = createInstrumenter({ esModules: true, coverageVariable: '__dynoSelfCoverage', coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
  let code = instrumenter.instrumentSync("let ready = () => process.stdout.write('ready'); ready(); process.stdin.resume();", filename);
  let baseline = join(directory, 'baseline.json');
  await writeFile(baseline, JSON.stringify({ [filename]: instrumenter.lastFileCoverage() }));
  await writeFile(filename, code);
  let raw = join(directory, 'raw');
  let child = spawn(process.execPath, ['--import', join(root, 'scripts/coverage/bootstrap.js'), filename], {
    env: { ...process.env, NODE_OPTIONS: '', DYNO_SELF_COVERAGE_DIR: raw, DYNO_SELF_COVERAGE_BASELINE: baseline },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let exit = once(child, 'exit');
  await once(child.stdout, 'data', { signal: t.signal });
  child.kill('SIGTERM');
  let [codeResult, signal] = await exit;
  assert.equal(codeResult, null);
  assert.equal(signal, 'SIGTERM');
  let [name] = await readdir(raw);
  let record = JSON.parse(await readFile(join(raw, name), 'utf8'));
  assert.equal(record.kind, 'node');
  assert.equal(record.coverage[filename].f[0], 1);
});

test('framework reports count independent executions once and retain untouched product files', async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-self-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'raw'));
  let baseline = {};
  let sources = {};
  for (let name of ['src/shared.js', 'src/browser/unused.js']) {
    let path = join(directory, name);
    let source = 'export function answer() { return 42; }';
    let instrumenter = createInstrumenter({ esModules: true });
    instrumenter.instrumentSync(source, path);
    baseline[path] = instrumenter.lastFileCoverage();
    sources[path] = source;
  }
  let visited = join(directory, 'src/shared.js');
  for (let [name, kind, id, hits] of [
    ['browser-first', 'browser', 'one-document', 1],
    ['browser-last', 'browser', 'one-document', 2],
    ['node', 'node', 'another-execution', 1],
  ]) {
    let counters = { [visited]: { s: { 0: hits }, f: { 0: hits }, b: {} } };
    let buildId = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
    await writeFile(join(directory, 'raw', name + '.json'), JSON.stringify({ schemaVersion: 1, buildId, kind, id, coverage: counters }));
  }
  let result = await frameworkCoverageReport({ directory, baseline, sources, root: directory, scope: 'all-suites' });
  assert.equal(result.documents, 2);
  assert.equal(result.summaries.combined.files, 2);
  assert.equal(result.summaries.browserSource.functions.pct, 0);
  let coverage = JSON.parse(await readFile(join(directory, 'report/coverage-final.json'), 'utf8'));
  assert.equal(coverage[visited].f[0], 3);
  assert.equal(coverage[join(directory, 'src/browser/unused.js')].f[0], 0);
  assert.match(await readFile(join(directory, 'report/index.html'), 'utf8'), /All files/);
});

test('a framework target requires a successful full suite without collection errors', async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-self-target-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'raw'));
  let baseline = {}, sources = {}, coverage = {};
  for (let name of ['src/shared.js', 'src/browser/app.js']) {
    let filename = join(directory, name);
    let source = 'globalThis.answer = () => 42; answer();';
    let instrumenter = createInstrumenter({ esModules: true });
    let code = instrumenter.instrumentSync(source, filename);
    baseline[filename] = instrumenter.lastFileCoverage();
    sources[filename] = source;
    let app = {};
    runInNewContext(code, app);
    coverage[filename] = app.__coverage__[filename];
  }
  let buildId = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  await writeFile(join(directory, 'raw/node.json'), JSON.stringify({ schemaVersion: 1, buildId, kind: 'node', id: 'execution', coverage }));
  let report = await frameworkCoverageReport({ directory, baseline, sources, root: directory, scope: 'all-suites' });
  assert.equal(frameworkCoverageTarget({ ...report, testExitCode: 0 }).met, true);
  await writeFile(join(directory, 'raw/errors-final.json'), JSON.stringify(['Final counters could not be delivered.']));
  let partial = await frameworkCoverageReport({ directory, baseline, sources, root: directory, scope: 'all-suites' });
  assert.equal(partial.summaries.combined.lines.pct, 100);
  assert.equal(partial.collection, 'partial');
  assert.equal(frameworkCoverageTarget({ ...partial, testExitCode: 0 }).met, false);
  assert.equal(frameworkCoverageTarget({ ...report, scope: 'subset:core', testExitCode: 0 }).met, false);
  assert.equal(frameworkCoverageTarget({ ...report, testExitCode: 1 }).met, false);
});
