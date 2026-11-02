import { testDescriptor, testId } from './suite.js';

let freeze = value => Object.freeze(value);
let list = values => freeze([...values]);
let text = value => typeof value === 'string' && value.length > 0 && value.length <= 10000;
let unique = values => Array.isArray(values) && values.length <= 10000 && values.every(text) && new Set(values).size === values.length;

export function parseSchedule(input) {
  if (input?.version !== 2) throw new Error('Replay requires a version 2 Dyno schedule. Record a new run first.');
  if (input.algorithm !== 'sha256-id-rank-v1' || input.source?.algorithm !== 'sha256-source-content-v1' || !/^[a-f0-9]{64}$/.test(input.source?.hash ?? ''))
    throw new Error('This schedule has an unsupported execution or source fingerprint.');
  if (input.seed !== null && (typeof input.seed !== 'string' || !input.seed.trim() || input.seed.length > 256))
    throw new Error('Invalid replay seed.');
  if (!Array.isArray(input.workers) || !input.workers.length || input.workers.length > 32 || input.workers.some((id, index) => id !== String(index)))
    throw new Error('Replay worker IDs must match Dyno worker slots, starting at 0.');
  if (!unique(input.selected) || !input.selected.length || !unique(input.priority) || input.priority.length !== input.selected.length ||
    input.priority.some(id => !input.selected.includes(id))) throw new Error('Replay selection and priority must contain the same unique test IDs.');
  if (!Array.isArray(input.catalog) || input.catalog.length !== input.selected.length || input.catalog.some((test, index) =>
    !test || test.id !== input.selected[index] || typeof test.file !== 'string' || !Array.isArray(test.suites) || !test.suites.length ||
    test.suites.some(name => !text(name)) || !text(test.name) || test.id !== testId(test.file, test.suites, test.name) ||
    !Number.isSafeInteger(test.index) || test.index < 0 || !Array.isArray(test.resources) || test.resources.some(name => !text(name)) ||
    (test.skipReason !== null && !text(test.skipReason)))) throw new Error('Invalid replay test catalog.');
  if (!Array.isArray(input.assignments) || !input.assignments.length || input.assignments.length > input.selected.length ||
    input.assignments.some(assignment => !assignment || !text(assignment.executionId) || !input.workers.includes(assignment.workerId) ||
      !input.selected.includes(assignment.testId) || !['running', 'reported', 'released', 'retained'].includes(assignment.status)) ||
    new Set(input.assignments.map(assignment => assignment.executionId)).size !== input.assignments.length ||
    new Set(input.assignments.map(assignment => assignment.testId)).size !== input.assignments.length)
    throw new Error('Replay needs unique, owned test assignments.');
  if (!unique(input.completion) || input.completion.some(id => !input.assignments.some(assignment => assignment.testId === id)) ||
    input.assignments.some(assignment => input.completion.includes(assignment.testId) !== (assignment.status !== 'running')))
    throw new Error('Replay completion history does not match its assignments.');
  let attempted = new Set(input.assignments.map(assignment => assignment.testId));
  let selected = input.selected.filter(id => attempted.has(id));
  return freeze({ source: freeze({ ...input.source }), seed: input.seed, workers: list(input.workers), selected: list(selected),
    priority: list(input.priority.filter(id => attempted.has(id))),
    catalog: freeze(input.catalog.filter(test => attempted.has(test.id)).map(test => freeze({ ...testDescriptor(test), suites: list(test.suites) }))),
    queues: freeze(Object.fromEntries(input.workers.map(id => [id, list(input.assignments.filter(assignment => assignment.workerId === id).map(assignment => assignment.testId))]))),
    omitted: input.selected.length - selected.length });
}

export function createSchedule(run) {
  let origin = run.startedClock ?? 0;
  return freeze({ version: 2, algorithm: 'sha256-id-rank-v1', source: run.source ?? null, seed: run.seed ?? null,
    catalog: freeze(run.tests.map(test => freeze({ ...testDescriptor(test), suites: list(test.suites) }))),
    selected: list(run.tests.map(test => test.id)), priority: list(run.priority ?? []), workers: list((run.workers ?? []).map(worker => worker.id)),
    ...(run.replay ? { replay: freeze({ omitted: run.replay.omitted }) } : {}),
    assignments: freeze((run.assignments ?? []).map(assignment => freeze({
      executionId: assignment.id, workerId: assignment.workerId, testId: assignment.testId, status: assignment.status,
      assignedAt: Math.max(0, assignment.assignedAt - origin),
      ...(assignment.reportedAt === undefined ? {} : { reportedAt: Math.max(0, assignment.reportedAt - origin) }),
      ...(assignment.releasedAt === undefined ? {} : { releasedAt: Math.max(0, assignment.releasedAt - origin) }),
    }))), completion: list(run.outcomes.map(outcome => outcome.testId)) });
}
