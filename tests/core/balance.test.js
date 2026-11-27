import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredDurations, fittedWorkers, balancedOrder } from '../../src/balance.js';

test('measured durations keep each test\'s latest timing and ignore skips', () => {
  let runs = [
    { outcomes: [{ testId: 'a', status: 'passed', duration: 100 }, { testId: 'b', status: 'skipped', duration: 0 }] },
    { outcomes: [{ testId: 'a', status: 'failed', duration: 300 }] },
  ];
  assert.deepEqual(measuredDurations(runs), { a: 300 });
});

test('a run never uses more workers than tests or than its longest test can use', () => {
  assert.equal(fittedWorkers(['a', 'b'], {}, 4), 2, 'two tests need at most two workers');
  assert.equal(fittedWorkers([], {}, 4), 4, 'an unknown selection uses every worker');
  // One long test dominates: 1000 + 100 + 100 = 1200 ms of work, longest 1000 ms.
  assert.equal(fittedWorkers(['a', 'b', 'c'], { a: 1000, b: 100, c: 100 }, 4), 2);
  // Even work spreads across every worker it can use.
  assert.equal(fittedWorkers(['a', 'b', 'c', 'd'], { a: 100, b: 100, c: 100, d: 100 }, 4), 4);
  assert.equal(fittedWorkers(['a', 'b', 'c'], { a: 100 }, 4), 3, 'missing timings fall back to the test count');
});

test('balanced order starts the longest work first and keeps ties in registered order', () => {
  assert.deepEqual(balancedOrder(['a', 'b', 'c', 'd'], { a: 10, b: 300, c: 10, d: 50 }), ['b', 'd', 'a', 'c']);
  assert.deepEqual(balancedOrder(['a', 'b'], {}), ['a', 'b']);
  // Untimed tests count as average work.
  assert.deepEqual(balancedOrder(['a', 'b', 'c'], { a: 10, c: 30 }), ['c', 'b', 'a']);
});
