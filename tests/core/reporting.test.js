import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, acceptEvent, claimTest } from '../../src/run.js';
import { createReport } from '../../src/report-model.js';
import { liveChange, applyLiveChange, runView, partialOutput, observerChange, applyObserverChange, acceptObserverFrame } from '../../src/browser/reporting.js';

let catalog = ['first', 'second'].map((name, position) => ({
  id: JSON.stringify(['tests/a.js', 'Contacts', name]), file: 'tests/a.js', suites: ['Contacts'],
  name, index: position ? 9 : 2, skipReason: null,
}));
let started = () => acceptEvent(createRun('run'), { runId: 'run', type: 'start', tests: catalog }).run;
let entry = { source: 'test', level: 'log', text: 'Contact saved 🦖', elapsed: 1 };

test('live changes preserve sparse catalog IDs and output without sending completed histories', () => {
  let run = started(), initial = runView(undefined, run);
  let running = applyLiveChange(initial, { set: { current: 9, phase: 'running' }, tests: [
    { index: 9, set: { status: 'running', path: '/contacts' }, output: { start: 0, entries: [entry] } },
  ] }, run);
  assert.equal(initial.tests[1].status, 'pending');
  assert.deepEqual(initial.tests[1].output, []);
  assert.equal(running.tests[1].id, catalog[1].id);
  assert.equal(running.tests[1].output[0].text, entry.text);
  assert.ok(Object.isFrozen(running.tests[1].output[0]));
  let delta = liveChange(initial, running);
  assert.equal(delta.tests.length, 1);
  assert.equal(delta.tests[0].index, 9);
  assert.equal(delta.tests[0].id, undefined);
  assert.deepEqual(applyLiveChange(initial, delta, run), running);
  assert.equal(liveChange(running, running), null);
});

test('whole malformed live changes reject without changing state, including late changes for accepted results', () => {
  let run = started(), view = runView(undefined, run);
  let invalid = [
    { set: { tests: [] }, tests: [] }, { set: { phase: 'made-up' }, tests: [] },
    { set: { current: 0 }, tests: [] }, { set: { duration: -1 }, tests: [] },
    { set: { viewport: { width: 100, height: 100, unknown: true } }, tests: [] },
    { set: {}, tests: [{ index: 0, set: { status: 'running' } }] },
    { set: {}, tests: [{ index: 2, set: {} }, { index: 2, set: {} }] },
    { set: {}, tests: [{ index: 2, set: { status: 'passed' } }] },
    ...[null, false, { start: 1, entries: [entry] }, { start: 0, entries: [{ ...entry, level: 'invalid' }] },
      { start: 0, entries: [{ ...entry, text: 'x'.repeat(2001) }] },
      { start: 0, entries: [{ ...entry, elapsed: null }] }].map((output) => ({ set: {}, tests: [{ index: 2, set: {}, output }] })),
  ];
  for (let change of invalid) assert.throws(() => applyLiveChange(view, change, run));
  let outcome = { runId: 'run', type: 'test', testId: catalog[0].id, index: 0, name: 'first', status: 'passed', output: [entry] };
  run = claimTest(run, { executionId: 'first' }).run;
  run = acceptEvent(run, { ...outcome, executionId: 'first' }).run;
  view = runView(view, run);
  assert.throws(() => applyLiveChange(view, { set: {}, tests: [{ index: 2, set: {}, output: { start: 0, entries: [{ ...entry, source: 'foreign' }] } }] }, run));
  let late = applyLiveChange(view, { set: {}, tests: [{ index: 2, set: { status: 'running' }, output: { start: 0, entries: [entry] } }] }, run);
  assert.equal(late.tests[0].status, 'passed');
  assert.deepEqual(late.tests[0].output, [entry]);
});

test('accepted outcomes own final data while interrupted output remains visible in portable reports', () => {
  let run = started();
  let view = applyLiveChange(undefined, { set: {}, tests: [{ index: 9, set: { status: 'running' }, output: { start: 0, entries: [entry] } }] }, run);
  run = acceptEvent(run, { runId: 'run', type: 'fatal', error: { message: 'Stopped' }, partial: partialOutput(view, run) }).run;
  let report = createReport(run);
  assert.equal(report.tests[1].status, 'not-run');
  assert.deepEqual(report.tests[1].output, [entry]);
  assert.deepEqual(report.tests[1].attachments, []);
  assert.equal(runView(view, run).phase, 'error');
  for (let partial of [[{ id: 'unknown', output: [] }], [{ id: catalog[1].id, output: [null] }]])
    assert.throws(() => acceptEvent(started(), { runId: 'run', type: 'fatal', error: { message: 'Stopped' }, partial }));
});

test('coalesced observer replacements reconstruct exact retained results without duplicated logs', () => {
  let run = started(), first = runView(undefined, run);
  let next = applyLiveChange(first, { set: { current: 2 }, tests: [{ index: 2, set: { status: 'running' }, output: { start: 0, entries: [entry] } }] }, run);
  let change = observerChange(first, next);
  assert.deepEqual(applyObserverChange(first, change), next);
  assert.equal(observerChange(next, next), null);
  assert.throws(() => applyObserverChange(first, { set: {}, tests: [{ position: 0, value: { id: 'wrong' } }] }));
  assert.equal(change.tests.length, 1);
});

test('observer batches publish atomically and reject missing, reordered, duplicate and foreign records', () => {
  let run = started(), view = runView(undefined, run), { tests, ...set } = view;
  let pending = acceptObserverFrame(undefined, 'view-start', { sequence: 0, reset: true, set, count: 2 });
  assert.equal(pending.view, null);
  assert.throws(() => acceptObserverFrame(pending, 'snapshot', { sequence: 0 }));
  assert.throws(() => acceptObserverFrame(pending, 'view-tests', { sequence: 1, tests: [] }));
  pending = acceptObserverFrame(pending, 'view-tests', { sequence: 0, tests: [{ position: 0, value: tests[0] }] });
  assert.equal(pending.view, null);
  assert.throws(() => acceptObserverFrame(pending, 'view-tests', { sequence: 0, tests: [{ position: 0, value: tests[0] }] }));
  pending = acceptObserverFrame(pending, 'view-tests', { sequence: 0, tests: [{ position: 1, value: tests[1] }] });
  let accepted = acceptObserverFrame(pending, 'snapshot', { sequence: 0 });
  assert.deepEqual(accepted.view, view);
  assert.equal(accepted.pending, null);
  assert.throws(() => acceptObserverFrame(accepted, 'view-start', { sequence: 2, reset: false, set: {}, count: 0 }));
  pending = acceptObserverFrame(accepted, 'view-start', { sequence: 1, reset: false, set: {}, count: 1 });
  pending = acceptObserverFrame(pending, 'view-tests', { sequence: 1, tests: [{ position: 0, value: { ...tests[0], id: 'foreign' } }] });
  assert.throws(() => acceptObserverFrame(pending, 'view-change', { sequence: 1 }));
  assert.deepEqual(accepted.view, view);
  let viewport = { width: 390, height: 844 };
  pending = acceptObserverFrame(accepted, 'view-start', { sequence: 1, reset: false, set: { viewport }, count: 0 });
  viewport.width = 1;
  let committed = acceptObserverFrame(pending, 'view-change', { sequence: 1 });
  assert.equal(committed.view.viewport.width, 390);
  assert.ok(Object.isFrozen(committed.view.viewport));
});
