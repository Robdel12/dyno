import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchState, watchTransition } from '../../src/watch.js';

test('a browser joining during a build cannot consume queued changes or lose its running status', () => {
  let initial = createWatchState();
  let changed = watchTransition(initial, { type: 'changed' });
  let building = watchTransition(changed, { type: 'building' });
  let running = watchTransition(building, { type: 'running' });
  let built = watchTransition(running, { type: 'built', revision: 1 });
  assert.equal(built.run, 'running');
  assert.equal(built.build, 'idle');
  assert.equal(built.published, 0);
  let finished = watchTransition(built, { type: 'finished' });
  let scheduled = watchTransition(finished, { type: 'scheduled', revision: 1 });
  assert.equal(scheduled.published, 1);
  assert.equal(initial.revision, 0);
});

test('edits arriving during a failed build stay queued for recovery', () => {
  let state = createWatchState();
  for (let type of ['changed', 'building', 'changed']) state = watchTransition(state, { type });
  state = watchTransition(state, { type: 'failed', revision: 1 });
  assert.equal(state.revision, 2);
  assert.equal(state.published, 1);
  assert.equal(state.build, 'idle');
});
