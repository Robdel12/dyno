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

export function createRun(runId) {
  return Object.freeze({ runId, status: 'captured', tests: Object.freeze([]), outcomes: Object.freeze([]) });
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
    if (
      run.status !== 'captured' ||
      !Array.isArray(input.tests) ||
      !input.tests.length ||
      input.tests.some(
        (test) =>
          !test ||
          typeof test.file !== 'string' ||
          !Array.isArray(test.suites) ||
          test.suites.some((name) => typeof name !== 'string' || !name.trim()) ||
          typeof test.name !== 'string' ||
          !test.name.trim() ||
          test.id !== testId(test.file, test.suites, test.name) ||
          !Number.isInteger(test.index) ||
          test.index < 0
      ) ||
      new Set(input.tests.map((test) => test.id)).size !== input.tests.length ||
      new Set(input.tests.map((test) => test.index)).size !== input.tests.length
    )
      throw new Error('Invalid run start.');
    let event = snapshotEvent(input);
    return {
      run: Object.freeze({
        ...run,
        status: 'running',
        tests: event.tests,
        ...(typeof input.userAgent === 'string' ? { userAgent: input.userAgent } : {})
      }),
      event
    };
  }
  if (input.type === 'test') {
    if (
      run.status !== 'running' ||
      input.index !== run.outcomes.length ||
      input.index >= run.tests.length ||
      input.testId !== run.tests[input.index].id ||
      input.name !== run.tests[input.index].name ||
      !['passed', 'failed', 'skipped'].includes(input.status)
    )
      throw new Error('Unexpected or duplicate test result.');
    if (input.status !== 'failed' && (input.error || input.additionalErrors?.length))
      throw new Error('Only failed tests can include failures.');
    if (input.status === 'failed' && !input.error) throw new Error('A failed test requires an error.');
    if (input.status === 'skipped' && (typeof input.skipReason !== 'string' || !input.skipReason.trim()))
      throw new Error('A skipped test requires a reason.');
    let event = snapshotEvent({ ...input, output: input.output ?? [], file: run.tests[input.index].file, suites: run.tests[input.index].suites });
    return { run: Object.freeze({ ...run, outcomes: Object.freeze([...run.outcomes, event]) }), event };
  }
  if (input.type === 'complete') {
    if (run.status !== 'running' || run.outcomes.length !== run.tests.length)
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
