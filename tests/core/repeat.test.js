import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepeat, repeatSeed, acceptRepeatRound, finishRepeat, repeatCommand } from '../../src/repeat.js';
import { createRepeatWriter } from '../../src/repeat-reports.js';
import { createRun, acceptEvent, claimTest, releaseTest } from '../../src/run.js';
import { testId } from '../../src/suite.js';

let source = { algorithm: 'sha256-source-content-v1', hash: 'a'.repeat(64) };
let descriptor = { id: testId('checkout.test.js', ['Shop'], 'checkout'), name: 'checkout', file: 'checkout.test.js', suites: ['Shop'], index: 0 };
let batch = count => createRepeat({ id: 'batch', count, seed: 'root', source, workers: 1, selection: {}, command: 'dyno --repeat 3 --seed root' });
function run(number, seed, { fail = false, interrupt = false } = {}) {
  let value = { ...createRun('run-' + number, { seed }), source };
  value = acceptEvent(value, { runId: value.runId, type: 'start', tests: [descriptor] }).run;
  value = claimTest(value, { executionId: 'execution-' + number }).run;
  if (!interrupt) {
    value = acceptEvent(value, { type: 'test', runId: value.runId, executionId: 'execution-' + number,
      testId: descriptor.id, index: 0, name: descriptor.name, status: fail ? 'failed' : 'passed',
      ...(fail ? { error: { message: 'Expected confirmation', phase: 'test' } } : {}) }).run;
    value = releaseTest(value, { executionId: 'execution-' + number });
  }
  return acceptEvent(value, { runId: value.runId, type: interrupt ? 'fatal' : 'complete',
    ...(interrupt ? { error: { message: 'Lost browser', phase: 'runtime' } } : {}) }).run;
}

test('repeat counts preserve failures, partial work and source identity without counting a delivered run twice', () => {
  let state = batch(3);
  let first = run(1, repeatSeed(state, 1), { fail: true });
  state = acceptRepeatRound(state, first);
  assert.equal(acceptRepeatRound(state, first), state);
  state = acceptRepeatRound(state, run(2, repeatSeed(state, 2)));
  state = acceptRepeatRound(state, run(3, repeatSeed(state, 3), { interrupt: true }));
  let result = finishRepeat(state, 'Lost browser');
  assert.equal(result.completed, 2);
  assert.equal(result.tests[0].passed, 1);
  assert.equal(result.tests[0].failed, 1);
  assert.equal(result.tests[0].notRun, 1);
  assert.equal(result.firstFailure.round, 1);
  assert.equal(result.status, 'interrupted');
  assert.throws(() => acceptRepeatRound(result, run(4, 'root')), /ended/);
  assert.throws(() => acceptRepeatRound(batch(3), { ...first, source: {} }), /source changed/);
});

test('round seed series preserve single-run input and prefixes, while replay repeats a fixed seed', () => {
  let short = batch(2), long = batch(100);
  assert.equal(repeatSeed(short, 1), 'root');
  assert.equal(repeatSeed(short, 2), repeatSeed(long, 2));
  assert.notEqual(repeatSeed(short, 1), repeatSeed(short, 2));
  assert.equal(repeatSeed({ ...long, replay: true }, 2), 'root');
  assert.equal(repeatSeed({ ...long, seed: null }, 2), null);
  let command = repeatCommand({ config: "a'b/config.js", suite: ['Shop'] }, { seed: 'root', count: 2, workers: 4 });
  assert.ok(command.includes("--config 'a'\\''b/config.js'"));
  assert.ok(command.includes("--suite 'Shop' --workers 4 --repeat 2 --seed 'root'"));
});

test('the evidence budget preserves accepted counts and publishes an explicit interruption without partial reports', async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-repeat-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let writer = await createRepeatWriter(directory, { limit: 1 });
  let state = batch(1);
  let first = run(1, 'root', { fail: true });
  state = acceptRepeatRound(state, first);
  let saved = await writer.save(state, first);
  assert.equal(saved.limited, true);
  assert.equal(saved.saved, undefined);
  let paths = await writer.finish(finishRepeat(state, 'evidence-limit'), {});
  let report = JSON.parse(await readFile(paths.json, 'utf8'));
  assert.equal(report.tests[0].failed, 1);
  assert.equal(report.reason, 'evidence-limit');
  assert.match(report.evidenceUnavailable, /evidence limit/);
  assert.match(await readFile(paths.junit, 'utf8'), /<error message="evidence-limit"/);
  let junit = await readFile(paths.junit, 'utf8');
  assert.match(junit, /tests="2" failures="1" skipped="0" errors="1"/);
  assert.equal((junit.match(/<testcase /g) ?? []).length, 2);
  assert.equal((junit.match(/<failure /g) ?? []).length, 1);
  assert.equal((await readdir(directory)).some(name => name.startsWith('.')), false);
});

test('a schedule storage failure preserves the accepted round and its JUnit failure', async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-repeat-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let writer = await createRepeatWriter(directory);
  await writeFile(join(directory, 'schedules'), 'This file blocks the schedule directory.');
  let first = run(1, 'root', { fail: true });
  let state = acceptRepeatRound(batch(1), first);
  await assert.rejects(writer.save(state, first), /schedules/);
  let paths = await writer.finish(finishRepeat(state, 'Schedule storage failed'), {});
  let entry = JSON.parse((await readFile(paths.ledger, 'utf8')).trim());
  assert.equal(entry.tests[0].status, 'failed');
  assert.match(entry.tests[0].error.message, /Expected confirmation/);
  assert.equal(entry.schedule, undefined);
  let junit = await readFile(paths.junit, 'utf8');
  assert.match(junit, /failures="1"/);
  assert.equal((junit.match(/<testcase /g) ?? []).length, 2);
});

test('failed final artifact publication leaves durable batch metadata unfinished', async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-repeat-finalize-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let writer = await createRepeatWriter(directory);
  let first = run(1, 'root');
  let state = acceptRepeatRound(batch(1), first);
  await writer.save(state, first);
  await mkdir(join(directory, 'junit.xml'));
  await assert.rejects(writer.finish(finishRepeat(state), {}));
  let persisted = JSON.parse(await readFile(join(directory, 'batch.json'), 'utf8'));
  assert.equal(persisted.status, 'running');
  assert.equal(persisted.tests[0].passed, 1);
  await assert.rejects(readFile(join(directory, 'index.html')), { code: 'ENOENT' });
});
