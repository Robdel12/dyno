import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuite, addTest, addHook, addSuite, compileSuite } from '../../src/suite.js';
import { createRun, acceptEvent, claimTest, releaseTest } from '../../src/run.js';
import { normalizeConfig } from '../../src/config.js';
import { createCleanup } from '../../src/cleanup.js';

test('suite snapshots keep earlier test and hook definitions unchanged', () => {
  let empty = createSuite();
  let first = addTest(empty, 'save a name', async () => {});
  let hooked = addHook(first, 'beforeEach', async () => {});
  let next = addTest(hooked, 'open the dashboard', async () => {});
  assert.equal(empty.children.length, 0);
  assert.equal(first.beforeEach.length, 0);
  assert.deepEqual(first.children.map(test => test.name), ['save a name']);
  assert.deepEqual(next.children.map(test => test.name), ['save a name', 'open the dashboard']);
  assert.throws(() => first.children.push({ name: 'late test' }), TypeError);
});

test('reported outcomes produce new run snapshots and authoritative totals', () => {
  let initial = createRun('browser-1');
  let definition = { id: JSON.stringify(['file', 'Workflow', 'save a name']), file: 'file', suites: ['Workflow'], index: 0, name: 'save a name', skipReason: null };
  let input = { runId: initial.runId, type: 'start', tests: [definition] };
  let started = acceptEvent(initial, input).run;
  input.tests.push('changed by caller');
  assert.equal(initial.status, 'captured');
  assert.deepEqual(started.tests.map(test=>test.name), ['save a name']);
  let assigned = claimTest(started, { executionId: 'save' }).run;
  let passed = acceptEvent(assigned, { executionId: 'save', runId: initial.runId, type: 'test', index: 0, testId: definition.id, name: 'save a name', status: 'passed' }).run;
  let released = releaseTest(passed, { executionId: 'save' });
  let complete = acceptEvent(released, { runId: initial.runId, type: 'complete', passed: 99, failed: 99 });
  assert.deepEqual(started.outcomes, []);
  assert.equal(passed.status, 'running');
  assert.equal(complete.run.status, 'completed');
  assert.equal(complete.event.passed, 1);
  assert.equal(complete.event.failed, 0);
  assert.throws(() => complete.run.outcomes.pop(), TypeError);
  assert.throws(() => acceptEvent(complete.run, input), /finished/);
});

test('config normalization preserves the caller inputs when applying CLI overrides', () => {
  let input = { port: 7357, browser: { args: ['--disable-gpu'] }, webServer: { url: 'http://localhost:3000', command: ['node', 'app.js'], env: { MODE: 'test' } } };
  let config = normalizeConfig(input, '/project/dyno.config.js', { port: 0, host: '0.0.0.0' });
  assert.equal(input.port, 7357);
  assert.equal(config.port, 0);
  assert.equal(config.host, '0.0.0.0');
  input.browser.args.push('--another-flag');
  input.webServer.command.push('changed');
  input.webServer.env.MODE = 'development';
  assert.deepEqual(config.browser.args, ['--disable-gpu']);
  assert.deepEqual(config.webServer.command, ['node', 'app.js']);
  assert.equal(config.webServer.env.MODE, 'test');
  assert.throws(() => { config.webServer.env.MODE = 'changed'; }, TypeError);
});

test('cleanup finishes remaining work after a failure and does not run twice', async () => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-cleanup-'));
  let log = join(directory, 'closed.txt');
  try {
    let cleanup = createCleanup();
    cleanup.add(() => appendFile(log, 'first\n'));
    cleanup.add(async () => { await appendFile(log, 'second\n'); throw new Error('Second cleanup failed'); });
    cleanup.add(() => appendFile(log, 'third\n'));
    let first = cleanup.run();
    assert.equal(cleanup.run(), first);
    let errors = await first;
    assert.equal(errors[0].message, 'Second cleanup failed');
    assert.equal(await readFile(log, 'utf8'), 'third\nsecond\nfirst\n');
    assert.throws(() => cleanup.add(() => {}), /already started/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('compilation preserves nested definition snapshots and derives scoped hooks', () => {
  let file = createSuite('a.test.js', { file: 'a.test.js' });
  let group = addTest(addHook(createSuite('Accounts'), 'beforeEach', () => {}), 'saves', () => {});
  let next = addSuite(file, group);
  let root = addSuite(createSuite(), next);
  let plan = compileSuite(root);
  assert.equal(file.children.length, 0);
  assert.equal(plan[0].scopes.length, 1);
  assert.equal(plan[0].scopes[0].beforeEach.length, 1);
  assert.deepEqual(plan[0].suites, ['Accounts']);
  assert.throws(() => plan[0].suites.push('changed'), TypeError);
  assert.deepEqual(compileSuite(root), plan);
});
