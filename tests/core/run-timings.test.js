import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishRunTimings, recordProjectCleanup } from '../../src/run-timings.js';

test('concurrent timing keeps coordinator wall, browser work and worker intervals separate', () => {
  let run = {
    startedClock: 0, status: 'completed', tests: [{ skipReason: null }, { skipReason: null }], workers: [{ id: '0' }, { id: '1' }],
    outcomes: [{ status: 'passed', duration: 35 }, { status: 'passed', duration: 60 }], summary: { duration: 1 },
    assignments: [
      { id: 'first', workerId: '0', index: 0, requestedAt: 0, assignedAt: 10, reportedAt: 50, releasedAt: 80 },
      { id: 'second', workerId: '1', index: 1, requestedAt: 0, assignedAt: 20, reportedAt: 90 },
    ],
  };
  let drained = recordProjectCleanup(run, 'first', { startedAt: 60, finishedAt: 75, status: 'passed' });
  drained = recordProjectCleanup(drained, 'second', { startedAt: 95, finishedAt: 100, status: 'passed' });
  let finished = finishRunTimings(drained, 100);
  assert.equal(finished.summary.duration, 100);
  assert.equal(finished.coordination.wallDuration, 100);
  assert.equal(finished.coordination.testWorkDuration, 95);
  assert.equal(Object.hasOwn(finished.summary.performance, 'outsideTestsDuration'), false);
  assert.deepEqual(finished.coordination.workers, [
    { id: '0', executionDuration: 40, handoffDuration: 30, queueDuration: 10, projectCleanupDuration: 15, unassignedDuration: 20 },
    { id: '1', executionDuration: 70, handoffDuration: 10, queueDuration: 20, projectCleanupDuration: 5, unassignedDuration: 0 },
  ]);
  assert.equal(run.assignments[0].projectCleanup, undefined);
  assert.equal(run.summary.duration, 1);
  assert.ok(Object.isFrozen(finished.coordination.workers[0]));
});

test('an interrupted assignment measures execution until cleanup without inventing browser work', () => {
  let run = {
    startedClock: 0, status: 'failed', tests: [{ skipReason: null }], workers: [{ id: '0' }], outcomes: [],
    assignments: [{ id: 'lost', workerId: '0', index: 0, requestedAt: 0, assignedAt: 10 }],
  };
  let drained = recordProjectCleanup(run, 'lost', { startedAt: 90, finishedAt: 100, status: 'failed' });
  let { coordination } = finishRunTimings(drained, 100);
  assert.equal(coordination.testWorkDuration, 0);
  assert.deepEqual(coordination.workers[0], { id: '0', executionDuration: 80, handoffDuration: 10, queueDuration: 10, projectCleanupDuration: 10, unassignedDuration: 0 });
  assert.throws(() => recordProjectCleanup(run, 'lost', { startedAt: 9, finishedAt: 100, status: 'passed' }), /Invalid/);
  assert.throws(() => finishRunTimings(run, -1), /Invalid/);
});
