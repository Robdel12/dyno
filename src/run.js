import { createHash } from 'node:crypto';
import { validFailure, snapshotFailure } from './failures.js';
import { testId, testDescriptor } from './suite.js';
import { validTimings, snapshotTimings, performanceSummary } from './browser/timings.js';
import { validOutput, snapshotOutput } from './browser/reporting.js';

function snapshotEvent(event) {
  return Object.freeze({
    ...event,
    ...(event.timings ? { timings: snapshotTimings(event.timings) } : {}),
    ...(event.attachments
      ? { attachments: Object.freeze(event.attachments.map((attachment) => Object.freeze({ ...attachment }))) }
      : {}),
    ...(event.tests
      ? {
          tests: Object.freeze(
            event.tests.map((test) =>
              Object.freeze({ ...testDescriptor(test), suites: Object.freeze([...test.suites]) })
            )
          )
        }
      : {}),
    ...(event.output ? { output: snapshotOutput(event.output) } : {}),
    ...(event.error ? { error: snapshotFailure(event.error, event.type === 'test' ? 'test' : 'runtime') } : {}),
    ...(event.additionalErrors
      ? { additionalErrors: Object.freeze(event.additionalErrors.map((error) => snapshotFailure(error, 'afterEach'))) }
      : {})
  });
}

let freeze = (value) => Object.freeze(value);
let list = (values) => freeze([...values]);
let active = (assignment) => assignment.status !== 'released';
let finished = (run) => ['completed', 'failed'].includes(run.status);
let worker = (run, id) => {
  let found = run.workers.find((worker) => worker.id === id);
  if (!found) throw new Error('Unknown run worker.');
  return found;
};
let text = (value) => typeof value === 'string' && value.trim() && value.length <= 256;

export function createRun(runId, { workers = ['0'], seed = null } = {}) {
  if (!Array.isArray(workers) || !workers.length || workers.length > 32 ||
    workers.some((id) => !text(id)) || new Set(workers).size !== workers.length)
    throw new Error('A run needs between 1 and 32 unique worker IDs.');
  if (seed !== null && !text(seed)) throw new Error('Seed must be a non-empty string of at most 256 characters.');
  return freeze({ runId, status: 'captured', tests: list([]), outcomes: list([]),
    workers: list(workers.map((id) => freeze({ id, ready: false }))),
    seed, priority: list([]), assignments: list([]), paused: false });
}

export function claimTest(run, { workerId = '0', executionId, now = 0 }) {
  let owner = worker(run, workerId);
  if (finished(run) || (run.tests.length && run.outcomes.length === run.tests.length))
    return freeze({ run, assignment: null, done: true });
  if (run.status !== 'running') throw new Error('Discover tests before requesting an assignment.');
  if (!text(executionId) || run.assignments.some((assignment) => assignment.id === executionId))
    throw new Error('Executions need unique IDs.');
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid assignment time.');
  let attempted = new Set(run.assignments.map((assignment) => assignment.testId));
  let reserved = new Set(run.assignments.filter(active).flatMap((assignment) => assignment.resources));
  let next = run.priority.map((id) => run.tests.find((test) => test.id === id))
    .find((test) => !attempted.has(test.id) && (test.skipReason || test.resources.every((name) => !reserved.has(name))));
  let owned = run.assignments.filter(assignment => assignment.workerId === owner.id && active(assignment));
  // Skips enter no browser document. Record trailing skips while the reported
  // real app stays reserved for inspection, but never overlap running work.
  if (!run.paused && (owned.some(assignment => assignment.status === 'running') || (!next?.skipReason && owned.length)))
    throw new Error('Release the previous execution before requesting another test.');
  if (!next || run.paused || run.workers.some((worker) => !worker.ready))
    return freeze({ run, assignment: null, done: run.outcomes.length === run.tests.length });
  let assignment = freeze({ id: executionId, workerId, testId: next.id,
    index: run.tests.indexOf(next), status: 'running', assignedAt: now,
    resources: next.skipReason ? list([]) : next.resources });
  return freeze({ run: freeze({ ...run, assignments: list([...run.assignments, assignment]) }), assignment: freeze({ ...assignment, test: next }), done: false });
}

export function reportedExecution(run, { workerId = '0', executionId }) {
  worker(run, workerId);
  let assignment = run.assignments.find((assignment) => assignment.id === executionId && assignment.workerId === workerId);
  if (finished(run) || !assignment || assignment.status !== 'reported')
    throw new Error('Only a reported, owned execution can be released.');
  return assignment;
}

export function releaseTest(run, { workerId = '0', executionId, now = 0 }) {
  let assignment = reportedExecution(run, { workerId, executionId });
  if (!Number.isFinite(now) || now < assignment.assignedAt) throw new Error('Invalid release time.');
  return freeze({ ...run, assignments: list(run.assignments.map((item) => item === assignment
    ? freeze({ ...item, status: 'released', releasedAt: now }) : item)) });
}

export function retainExecution(run, { workerId = '0', executionId }) {
  if (run.outcomes.length !== run.tests.length) throw new Error('Retain documents only when every selected test has reported.');
  let assignment = reportedExecution(run, { workerId, executionId });
  return freeze({ ...run, assignments: list(run.assignments.map((item) => item === assignment
    ? freeze({ ...item, status: 'retained' }) : item)) });
}

export function pauseRun(run, paused) {
  if (finished(run) || typeof paused !== 'boolean') throw new Error('Cannot change run admission.');
  return freeze({ ...run, paused });
}

export function acceptEvent(run, input) {
  if (!run || input.runId !== run.runId || ['completed', 'failed'].includes(run.status))
    throw new Error('Unknown or finished run.');
  if (
    input.duration !== undefined &&
    (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration < 0)
  )
    throw new Error('Event duration must be a non-negative number.');
  if (input.timings !== undefined && (!validTimings(input.timings) || input.type !== 'test' ||
    input.duration === undefined || Math.abs(input.duration - input.timings.duration) > 0.01))
    throw new Error('Invalid test timings.');
  if (input.error !== undefined && !validFailure(input.error))
    throw new Error('An event error requires a message and a valid phase/stack.');
  if (
    input.additionalErrors !== undefined &&
    (!Array.isArray(input.additionalErrors) || input.additionalErrors.some((error) => !validFailure(error)))
  )
    throw new Error('Invalid additional failures.');

  if (input.output !== undefined && !validOutput(input.output))
    throw new Error('Invalid console output.');

  if (input.type === 'start') {
    let workerId = input.workerId ?? '0';
    let owner = worker(run, workerId);
    if (
      owner.ready ||
      !Array.isArray(input.tests) ||
      !input.tests.length ||
      input.tests.some(
        (test) =>
          !test ||
          typeof test.file !== 'string' ||
          !Array.isArray(test.suites) || !test.suites.length ||
          test.suites.some((name) => typeof name !== 'string' || !name.trim()) ||
          typeof test.name !== 'string' ||
          !test.name.trim() ||
          test.id !== testId(test.file, test.suites, test.name) ||
          !Number.isInteger(test.index) ||
          test.index < 0 ||
          (test.skipReason != null && (typeof test.skipReason !== 'string' || !test.skipReason.trim())) ||
          (test.resources !== undefined && (!Array.isArray(test.resources) || test.resources.length > 32 ||
            test.resources.some((name) => !text(name) || name.length > 128) || new Set(test.resources).size !== test.resources.length))
      ) ||
      new Set(input.tests.map((test) => test.id)).size !== input.tests.length ||
      new Set(input.tests.map((test) => test.index)).size !== input.tests.length
    )
      throw new Error('Invalid run start.');
    let event = snapshotEvent(input);
    if (run.tests.length && JSON.stringify(run.tests) !== JSON.stringify(event.tests))
      throw new Error('Workers registered different test catalogs.');
    let priority = run.priority;
    if (!run.tests.length) {
      let ranks = new Map(event.tests.map((test) => [test.id,
        run.seed === null ? null : createHash('sha256').update(JSON.stringify([run.seed, test.id])).digest('hex')]));
      priority = event.tests.map((test) => test.id);
      if (run.seed !== null) priority.sort((left, right) => {
        let a = ranks.get(left), b = ranks.get(right);
        return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
      });
    }
    return {
      run: Object.freeze({
        ...run,
        status: 'running',
        tests: run.tests.length ? run.tests : event.tests,
        priority: list(priority),
        workers: list(run.workers.map((item) => item === owner ? freeze({ ...item, ready: true }) : item)),
        ...(typeof input.userAgent === 'string' ? { userAgent: input.userAgent } : {})
      }),
      event: run.tests.length ? null : event
    };
  }
  if (input.type === 'test') {
    let assignment = run.assignments.find((assignment) => assignment.id === input.executionId &&
      assignment.workerId === (input.workerId ?? '0') && assignment.testId === input.testId);
    if (
      run.status !== 'running' ||
      !assignment || assignment.status !== 'running' || input.index !== assignment.index ||
      input.index >= run.tests.length ||
      input.testId !== run.tests[input.index].id ||
      input.name !== run.tests[input.index].name ||
      !['passed', 'failed', 'skipped'].includes(input.status)
    )
      throw new Error('Unexpected or duplicate test result.');
    if (input.status === 'skipped' && input.skipReason !== run.tests[input.index].skipReason)
      throw new Error('A skipped result must retain its registered reason.');
    if (Boolean(run.tests[input.index].skipReason) !== (input.status === 'skipped'))
      throw new Error('Skipped outcomes must match the registered test selection.');
    if (input.status !== 'failed' && (input.error || input.additionalErrors?.length))
      throw new Error('Only failed tests can include failures.');
    if (input.status === 'failed' && !input.error) throw new Error('A failed test requires an error.');
    if (input.status === 'skipped' && (typeof input.skipReason !== 'string' || !input.skipReason.trim()))
      throw new Error('A skipped test requires a reason.');
    let event = snapshotEvent({ ...input, workerId: assignment.workerId, executionId: assignment.id, output: input.output ?? [], file: run.tests[input.index].file, suites: run.tests[input.index].suites });
    return { run: Object.freeze({ ...run, outcomes: Object.freeze([...run.outcomes, event]),
      assignments: list(run.assignments.map((item) => item === assignment ? freeze({ ...item, status: 'reported' }) : item)) }), event };
  }
  if (input.type === 'complete') {
    if (run.status !== 'running' || run.outcomes.length !== run.tests.length ||
      run.assignments.some(assignment => !['released', 'retained'].includes(assignment.status)))
      throw new Error('Run completed before all tests reported.');
    let failed = run.outcomes.filter((outcome) => outcome.status === 'failed').length;
    let skipped = run.outcomes.filter((outcome) => outcome.status === 'skipped').length;
    let event = snapshotEvent({ ...input, failed, skipped, passed: run.outcomes.length - failed - skipped, performance: performanceSummary(run.outcomes, input.duration) });
    return { run: Object.freeze({ ...run, status: 'completed', summary: event }), event };
  }
  if (input.type === 'fatal') {
    if (!input.error) throw new Error('A fatal event requires an error.');
    if (input.stopped !== undefined && typeof input.stopped !== 'boolean') throw new Error('Invalid stopped status.');
    let partial = input.partial ?? [];
    if (!Array.isArray(partial) || partial.length > run.tests.length ||
      new Set(partial.map((test) => test?.id)).size !== partial.length ||
      partial.some((test) => !test || !run.tests.some((item) => item.id === test.id) ||
        run.outcomes.some((item) => item.testId === test.id) || !validOutput(test.output)))
      throw new Error('Invalid interrupted test output.');
    partial = Object.freeze(partial.map((test) => Object.freeze({ id: test.id,
      output: snapshotOutput(test.output) })));
    let event = snapshotEvent({ ...input, partial });
    return { run: Object.freeze({ ...run, status: 'failed', stopped: input.stopped === true, error: event.error, partial }), event };
  }
  throw new Error('Unknown reporter event.');
}
