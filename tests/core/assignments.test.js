import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, acceptEvent, claimTest, releaseTest, pauseRun, retainExecution } from '../../src/run.js';
import { testId, createSuite, addTest, addSuite, compileSuite, testDescriptor } from '../../src/suite.js';

let catalog = ['copy', 'paste', 'save', 'review'].map((name, position) => ({
  id: testId('workflow.js', ['Contacts'], name), file: 'workflow.js', suites: ['Contacts'],
  name, index: position * 3 + 2, skipReason: null,
  resources: position < 2 ? ['clipboard'] : [],
}));
function ready({ workers = ['a', 'b'], tests = catalog, seed = null } = {}) {
  let run = createRun('run', { workers, seed });
  for (let workerId of workers) run = acceptEvent(run, { runId: 'run', type: 'start', workerId, tests }).run;
  return run;
}
function result(assignment, status = 'passed') {
  return { runId: 'run', type: 'test', workerId: assignment.workerId, executionId: assignment.id,
    index: assignment.index, testId: assignment.testId, name: assignment.test.name, status, output: [] };
}
let permutations = (values) => values.length ? values.flatMap((value, index) =>
  permutations(values.filter((_, position) => position !== index)).map(tail => [value, ...tail])) : [[]];

test('all workers validate the same immutable catalog before any test is assigned', () => {
  let initial = createRun('run', { workers: ['a', 'b'] });
  let started = acceptEvent(initial, { runId: 'run', workerId: 'a', type: 'start', tests: catalog }).run;
  assert.equal(claimTest(started, { workerId: 'a', executionId: 'one' }).assignment, null);
  let changed = structuredClone(catalog); changed[0].resources.push('camera');
  assert.throws(() => acceptEvent(started, { runId: 'run', workerId: 'b', type: 'start', tests: changed }), /different.*catalog/);
  let registered = acceptEvent(started, { runId: 'run', workerId: 'b', type: 'start', tests: catalog });
  assert.equal(registered.event, null, 'Only one canonical start event is emitted.');
  let assigned = claimTest(registered.run, { workerId: 'a', executionId: 'one' });
  assert.equal(assigned.assignment.testId, catalog[0].id);
  assert.equal(initial.tests.length, 0);
  assert.equal(started.workers[1].ready, false);
  assert.throws(() => registered.run.tests[0].resources.push('late'), TypeError);
  assert.throws(() => claimTest(registered.run, { workerId: 'unknown', executionId: 'two' }), /Unknown/);
});

test('whole resource sets stay reserved through result acceptance until document and project cleanup release them', () => {
  let initial = ready();
  let first = claimTest(initial, { workerId: 'a', executionId: 'copy', now: 10 });
  let second = claimTest(first.run, { workerId: 'b', executionId: 'save', now: 11 });
  assert.equal(first.assignment.test.name, 'copy');
  assert.equal(second.assignment.test.name, 'save', 'Another worker bypasses a blocked clipboard test.');
  let reported = acceptEvent(second.run, result(first.assignment)).run;
  assert.throws(() => claimTest(reported, { workerId: 'a', executionId: 'paste' }), /Release/);
  let next = acceptEvent(reported, result(second.assignment)).run;
  next = releaseTest(next, { workerId: 'b', executionId: 'save', now: 20 });
  let review = claimTest(next, { workerId: 'b', executionId: 'review', now: 21 });
  assert.equal(review.assignment.test.name, 'review');
  next = acceptEvent(review.run, result(review.assignment)).run;
  next = releaseTest(next, { workerId: 'b', executionId: 'review', now: 22 });
  assert.equal(claimTest(next, { workerId: 'b', executionId: 'blocked' }).assignment, null);
  next = releaseTest(next, { workerId: 'a', executionId: 'copy', now: 23 });
  assert.equal(claimTest(next, { workerId: 'b', executionId: 'paste', now: 24 }).assignment.test.name, 'paste');
  assert.deepEqual(initial.assignments, []);
  assert.equal(first.run.assignments[0].status, 'running');
  assert.equal(reported.assignments[0].status, 'reported');
});

test('all 24 completion orders preserve test identity, catalog order, final logs and authoritative totals', () => {
  for (let order of permutations([0, 1, 2, 3])) {
    let run = ready({ workers: ['a', 'b', 'c', 'd'], tests: catalog.map(test => ({ ...test, resources: [] })) });
    let assignments = [];
    for (let [index, workerId] of ['a', 'b', 'c', 'd'].entries()) {
      let assigned = claimTest(run, { workerId, executionId: 'execution-' + index });
      run = assigned.run; assignments.push(assigned.assignment);
    }
    for (let position of order) {
      let input = { ...result(assignments[position]), output: [{ source: 'test', level: 'log', text: 'Saved ' + position, elapsed: 1 }] };
      run = acceptEvent(run, input).run;
      input.output[0].text = 'Changed by caller';
    }
    assert.deepEqual(run.tests.map(test => test.id), catalog.map(test => test.id));
    assert.deepEqual(run.outcomes.map(test => test.testId), order.map(position => catalog[position].id));
    for (let position of order) assert.equal(run.outcomes.find(outcome => outcome.testId === catalog[position].id).output[0].text, 'Saved ' + position);
    assert.throws(() => acceptEvent(run, { runId:'run', type:'complete' }), /before all/);
    for (let assignment of assignments) run = releaseTest(run, { workerId: assignment.workerId, executionId: assignment.id });
    let complete = acceptEvent(run, { runId: 'run', type: 'complete', duration: 10, passed: 99 });
    assert.equal(complete.event.passed, 4);
    assert.equal(complete.event.failed, 0);
    assert.throws(() => acceptEvent(complete.run, result(assignments[0])), /finished/);
  }
});

test('stale, duplicate and foreign outcomes never replace the assigned user result', () => {
  let { run, assignment } = claimTest(ready(), { workerId: 'a', executionId: 'one' });
  let input = result(assignment);
  for (let change of [{ workerId: 'b' }, { executionId: 'old' }, { testId: catalog[1].id }, { index: 1 }, { name: 'other' }])
    assert.throws(() => acceptEvent(run, { ...input, ...change }), /Unexpected/);
  assert.throws(() => releaseTest(run, { workerId: 'a', executionId: 'one' }), /reported/);
  let accepted = acceptEvent(run, input).run;
  assert.throws(() => retainExecution(accepted, {workerId:'a',executionId:'one'}), /every selected/);
  assert.throws(() => acceptEvent(accepted, input), /Unexpected/);
  assert.throws(() => releaseTest(accepted, { workerId: 'b', executionId: 'one' }), /owned/);
  let released = releaseTest(accepted, { workerId: 'a', executionId: 'one', now: 1 });
  assert.throws(() => claimTest(released, { workerId: 'a', executionId: 'one' }), /unique/);
  assert.equal(accepted.outcomes.length, 1);
  assert.equal(run.outcomes.length, 0);
});

test('a seed gives stable priority through filtering while pause prevents new assignments', () => {
  let run = ready({ seed: 'issue-184' });
  assert.deepEqual(run.priority, ready({ seed: 'issue-184' }).priority);
  let subset = catalog.filter((_, index) => index !== 1);
  assert.deepEqual(ready({ seed: 'issue-184', tests: subset }).priority,
    run.priority.filter(id => subset.some(test => test.id === id)));
  let paused = pauseRun(run, true);
  assert.equal(claimTest(paused, { workerId: 'a', executionId: 'one' }).assignment, null);
  assert.equal(run.paused, false);
  assert.ok(claimTest(pauseRun(paused, false), { workerId: 'a', executionId: 'one' }).assignment);
});

test('custom resources survive suite compilation and cannot change after registration', () => {
  let resources = ['clipboard', 'camera'];
  let suite = addTest(createSuite('Contacts'), 'copies', () => {}, { resources });
  resources.push('late');
  let plan = compileSuite(addSuite(createSuite('workflow.js', { file: 'workflow.js' }), suite));
  assert.deepEqual(testDescriptor(plan[0]).resources, ['camera', 'clipboard']);
  assert.throws(() => addTest(createSuite('Contacts'), 'copies', () => {}, { resource: ['clipboard'] }), /Unknown test option/);
  for (let invalid of [['clipboard', 'clipboard'], [''], 'clipboard', [42]])
    assert.throws(() => addTest(createSuite('Contacts'), 'copies', () => {}, { resources: invalid }), /resources/);
});


test('a skip can follow a reported document but cannot overlap an unfinished assignment', () => {
  let tests = [catalog[0], { ...catalog[1], skipReason: 'Later' }];
  let first = claimTest(ready({ workers: ['a'], tests }), { workerId: 'a', executionId: 'real' });
  assert.throws(() => claimTest(first.run, { workerId:'a', executionId:'too-early' }), /Release/);
  let reported = acceptEvent(first.run, result(first.assignment)).run;
  let skipped = claimTest(reported, {workerId:'a',executionId:'skip'});
  assert.equal(skipped.assignment.testId, tests[1].id);
  assert.deepEqual(skipped.assignment.resources, []);
  assert.equal(skipped.run.assignments[0].status, 'reported');
  assert.throws(() => acceptEvent(skipped.run, {...result(skipped.assignment,'skipped'),skipReason:'Changed'}), /registered reason/);
  let accepted = acceptEvent(skipped.run, {...result(skipped.assignment,'skipped'),skipReason:'Later'}).run;
  let released = releaseTest(accepted, {workerId:'a',executionId:'skip'});
  let retained = retainExecution(released, {workerId:'a',executionId:'real'});
  assert.deepEqual(retained.assignments.map(assignment=>assignment.status), ['retained','released']);
  assert.equal(acceptEvent(retained, {runId:'run',type:'complete'}).event.skipped, 1);
});
