import { createHash } from 'node:crypto';

let freeze = value => Object.freeze(value);

export function createRepeat({ id, count, seed, source, workers, selection, command, browser, replay = false }) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Repeat count must be a positive safe integer.');
  return freeze({ schemaVersion: 1, id, requested: count, seed, source, workers, selection, command, browser,
    algorithm: 'dyno-repeat-v1', replay, resources: 'reused', status: 'running', rounds: 0,
    completed: 0, failedRounds: 0, tests: freeze([]), firstFailure: null, lastRunId: null });
}

export function repeatSeed(batch, number) {
  if (batch.replay || batch.seed === null || number === 1) return batch.seed;
  return createHash('sha256').update(JSON.stringify([batch.algorithm, batch.seed, number])).digest('hex');
}

export function acceptRepeatRound(batch, run) {
  if (run.runId === batch.lastRunId) return batch;
  if (batch.status !== 'running' || batch.rounds >= batch.requested) throw new Error('The repeated run has ended.');
  let number = batch.rounds + 1;
  if (JSON.stringify(run.source) !== JSON.stringify(batch.source)) throw new Error('The repeated test source changed.');
  if (run.seed !== repeatSeed(batch, number)) throw new Error('The run does not match this repeat round.');
  if (batch.tests.length && JSON.stringify(run.tests.map(test => test.id)) !== JSON.stringify(batch.tests.map(test => test.id)))
    throw new Error('The test selection changed between repeated runs.');
  let previousTests = new Map(batch.tests.map(test => [test.id, test]));
  let outcomes = new Map(run.outcomes.map(outcome => [outcome.testId, outcome]));
  let tests = run.tests.map(test => {
    let previous = previousTests.get(test.id) ?? { id: test.id, file: test.file, suites: test.suites, name: test.name,
      passed: 0, failed: 0, skipped: 0, notRun: 0 };
    let outcome = outcomes.get(test.id);
    let status = outcome?.status ?? 'notRun';
    return freeze({ ...previous, [status]: previous[status] + 1 });
  });
  let failure = run.outcomes.find(outcome => outcome.status === 'failed');
  let failed = Boolean(failure || run.status !== 'completed');
  let position = failure ? run.assignments.findIndex(item => item.id === failure.executionId) : -1;
  let firstFailure = batch.firstFailure;
  if (!firstFailure && failed) firstFailure = freeze({ round: number, runId: run.runId, seed: run.seed,
    ...(failure ? { testId: failure.testId, name: failure.name, workerId: failure.workerId,
      predecessors: freeze(run.assignments.slice(0, position).filter(item => item.workerId === failure.workerId)
        .map(item => item.testId)) } : {}),
    error: failure?.error ?? run.error });
  return freeze({ ...batch, rounds: number, completed: batch.completed + Number(run.status === 'completed'),
    failedRounds: batch.failedRounds + Number(failed), tests: freeze(tests), firstFailure,
    lastRunId: run.runId });
}

export function finishRepeat(batch, reason) {
  let status = batch.failedRounds ? 'failed' : 'passed';
  if (reason) status = 'interrupted';
  return freeze({ ...batch, status,
    ...(reason ? { reason } : {}) });
}

let quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

// Commands are display text. They are never executed by Dyno.
function runArguments(options) {
  let args = ['dyno'];
  for (let key of ['config', 'browser', 'browserPath', 'test', 'replay', 'host', 'port', 'reportDir'])
    if (options[key] !== undefined) args.push('--' + key.replace(/[A-Z]/g, value => '-' + value.toLowerCase()), quote(options[key]));
  for (let key of ['id', 'file', 'suite'])
    for (let value of options[key] ?? []) args.push('--' + key, quote(value));
  return args;
}

export function repeatCommand(options, { seed, count, workers }) {
  let args = runArguments(options);
  args.push('--workers', String(workers), '--repeat', String(count));
  if (seed !== null && !options.replay) args.push('--seed', quote(seed));
  return args.join(' ');
}

export function replayCommand(options, path) {
  return runArguments({ ...options, replay: path, test: undefined, id: [], file: [], suite: [] }).join(' ');
}
