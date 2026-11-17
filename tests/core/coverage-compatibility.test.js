import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { instrumentCoverage } from '../../src/coverage-instrument.js';
import { createCoverageState, acceptCoverage, releaseCoverage, finalizeCoverage } from '../../src/coverage-model.js';
import { project } from '../helpers/project.js';

let options = { include: ['**/*'], exclude: [], thresholds: {} };
let packet = (coverage, sequence = 1) => ({ executionId: 'execution', documentId: 'document', sequence,
  coverage: JSON.parse(JSON.stringify(coverage)) });

test('Istanbul truthiness counters survive cumulative snapshots and execution release', async t => {
  let fixture = await project(t);
  let filename = join(fixture.directory, 'app.js');
  let instrumenter = createInstrumenter({ esModules: true, reportLogic: true,
    coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
  let code = instrumenter.instrumentSync('globalThis.choose = (left, right) => left && right;', filename);
  let app = {};
  runInNewContext(code, app);
  app.choose(false, true);
  let state = acceptCoverage(createCoverageState(), packet(app.__coverage__), { workerId: '0' });
  app.choose(true, true);
  state = acceptCoverage(state, packet(app.__coverage__, 2), { workerId: '0' });
  state = releaseCoverage(state, { workerId: '0', executionId: 'execution' });
  let result = await finalizeCoverage(state, options, { root: fixture.directory });
  assert.equal(result.failed, false);
  assert.deepEqual(result.data[filename].bT, JSON.parse(JSON.stringify(app.__coverage__[filename].bT)));
  assert(Object.keys(result.data[filename].bT).length > 0);
  let invalid = packet(app.__coverage__, 3);
  invalid.coverage[filename].bT = { 999: [] };
  assert.throws(() => acceptCoverage(createCoverageState(), invalid, { workerId: '0' }), /branch truthiness counters/);
});

test('a module without functions or branches can satisfy those coverage thresholds', async t => {
  let fixture = await project(t);
  let filename = join(fixture.directory, 'app.js');
  let output = instrumentCoverage({ code: 'globalThis.value = 42;', filename });
  let app = {};
  runInNewContext(output.code, app);
  let state = acceptCoverage(createCoverageState(), packet(app.__coverage__), { workerId: '0' });
  let result = await finalizeCoverage(state, { ...options, thresholds: { functions: 100, branches: 100 } }, { root: fixture.directory });
  assert.equal(result.failed, false);
  assert.equal(result.summary.functions.total, 0);
  assert.equal(result.summary.branches.total, 0);
});

test('whole-project filters exclude instrumented sources outside the configured project', async t => {
  let fixture = await project(t);
  let inside = join(fixture.directory, 'app.js');
  let outside = join(fixture.directory, '..', 'outside-app.js');
  let app = {};
  for (let filename of [inside, outside])
    runInNewContext(instrumentCoverage({ code: 'globalThis.value = 42;', filename }).code, app);
  let state = acceptCoverage(createCoverageState(), packet(app.__coverage__), { workerId: '0' });
  let result = await finalizeCoverage(state, options, { root: fixture.directory });
  assert.deepEqual(Object.keys(result.data), [inside]);
  assert.equal(result.summary.statements.total, 1);
  assert.equal(result.summary.statements.covered, 1);
});
