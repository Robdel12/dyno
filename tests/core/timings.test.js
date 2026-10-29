import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimings, validTimings, snapshotTimings, performanceSummary } from '../../src/browser/timings.js';

test('timings preserve overlapping intervals and rank slow work without adding it twice', async () => {
  let clock = 0;
  let timings = createTimings({ now: () => clock });
  let finish = timings.begin('test', 'Test body');
  clock = 10;
  let finishStep = timings.begin('step', 'Save contact', 'test');
  clock = 20;
  let finishRequest = timings.begin('request', 'POST /contacts', 'test');
  clock = 70;
  finishRequest();
  clock = 80;
  finishStep();
  clock = 100;
  finish();
  let result = timings.end();
  assert.equal(result.duration, 100);
  assert.deepEqual(result.entries.map(entry => entry.duration), [100, 70, 50]);
  assert.ok(validTimings(result));
  let summary = performanceSummary([
    { id: 'fast', name: 'fast', status: 'passed', duration: 10, index: 0 },
    { id: 'slow', name: 'slow', status: 'failed', duration: 100, index: 1, timings: result },
    { id: 'skip', name: 'skip', status: 'skipped', duration: 1000, index: 2 }
  ]);
  assert.deepEqual(summary.slowestTests.map(test => test.id), ['slow', 'fast']);
  assert.deepEqual(summary.slowestTests[0].slowestWork.map(entry => entry.name), ['Save contact', 'POST /contacts']);
  assert.ok(Object.isFrozen(snapshotTimings(result).entries[0]));
});

test('cancelled work ends at the abort, preserves its error, and ignores late completion', async () => {
  let clock = 0;
  let timings = createTimings({ now: () => clock });
  let pending = Promise.withResolvers();
  let controller = new AbortController();
  let work = timings.measure('step', 'Waiting for save', () => pending.promise, { signal: controller.signal });
  await Promise.resolve();
  clock = 25;
  let error = new Error('Stopped');
  controller.abort(error);
  await assert.rejects(work, actual => actual === error);
  let result = timings.end();
  clock = 100;
  pending.resolve();
  await Promise.resolve();
  assert.equal(result.entries[0].duration, 25);
  assert.equal(result.entries[0].status, 'cancelled');
  assert.deepEqual(timings.snapshot(), result);
});

test('bounded timings report omissions and reject malformed intervals', () => {
  let clock = 0;
  let timings = createTimings({ now: () => clock, limit: 2 });
  for (let index = 0; index < 4; index++) { let finish = timings.begin('request', 'GET /'); clock++; finish(); }
  let result = timings.end();
  assert.equal(result.entries.length, 2);
  assert.equal(result.truncated, 2);
  assert.ok(validTimings(result));
  for (let change of [ { start: -1 }, { duration: Infinity }, { duration: 99 }, { id: 9 }, { kind: 'unknown' }, { status: 'unknown' }, { name: 'x'.repeat(201) } ])
    assert.equal(Boolean(validTimings({ ...result, entries: [{ ...result.entries[0], ...change }] })), false);
});
