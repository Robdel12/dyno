function snapshotEvent(event) {
  return Object.freeze({
    ...event,
    ...(event.tests ? { tests: Object.freeze([...event.tests]) } : {}),
    ...(event.output ? { output: Object.freeze(event.output.map(entry => Object.freeze({ ...entry }))) } : {}),
    ...(event.error ? { error: Object.freeze({ ...event.error, ...(event.error.source ? { source: Object.freeze({ ...event.error.source }) } : {}) }) } : {})
  });
}

export function createRun(runId) {
  return Object.freeze({ runId, status: 'captured', tests: Object.freeze([]), outcomes: Object.freeze([]) });
}

export function acceptEvent(run, input) {
  if (!run || input.runId !== run.runId || ['completed', 'failed'].includes(run.status)) throw new Error('Unknown or finished run.');
  if (input.duration !== undefined && (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration < 0)) throw new Error('Event duration must be a non-negative number.');
  if (input.error !== undefined && (!input.error || typeof input.error.message !== 'string' || (input.error.stack !== undefined && typeof input.error.stack !== 'string'))) throw new Error('An event error requires a message and an optional stack.');

  if (input.output !== undefined && (!Array.isArray(input.output) || input.output.length > 100 || input.output.some(entry => !entry || !['app', 'test'].includes(entry.source) || !['log', 'info', 'warn', 'error', 'debug'].includes(entry.level) || typeof entry.text !== 'string' || entry.text.length > 2000 || typeof entry.elapsed !== 'number' || !Number.isFinite(entry.elapsed) || entry.elapsed < 0))) throw new Error('Invalid console output.');

  if (input.type === 'start') {
    if (run.status !== 'captured' || !Array.isArray(input.tests) || !input.tests.length || input.tests.some(name => typeof name !== 'string' || !name.trim()) || new Set(input.tests).size !== input.tests.length) throw new Error('Invalid run start.');
    let event = snapshotEvent(input);
    return { run: Object.freeze({ ...run, status: 'running', tests: event.tests }), event };
  }
  if (input.type === 'test') {
    if (run.status !== 'running' || input.index !== run.outcomes.length || input.index >= run.tests.length || input.name !== run.tests[input.index] || !['passed', 'failed'].includes(input.status)) throw new Error('Unexpected or duplicate test result.');
    if (input.status === 'failed' && !input.error) throw new Error('A failed test requires an error.');
    let event = snapshotEvent(input);
    return { run: Object.freeze({ ...run, outcomes: Object.freeze([...run.outcomes, event]) }), event };
  }
  if (input.type === 'complete') {
    if (run.status !== 'running' || run.outcomes.length !== run.tests.length) throw new Error('Run completed before all tests reported.');
    let failed = run.outcomes.filter(outcome => outcome.status === 'failed').length;
    let event = snapshotEvent({ ...input, failed, passed: run.outcomes.length - failed });
    return { run: Object.freeze({ ...run, status: 'completed', summary: event }), event };
  }
  if (input.type === 'fatal') {
    if (!input.error) throw new Error('A fatal event requires an error.');
    let event = snapshotEvent(input);
    return { run: Object.freeze({ ...run, status: 'failed', error: event.error }), event };
  }
  throw new Error('Unknown reporter event.');
}
