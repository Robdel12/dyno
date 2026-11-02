import { createExecution } from './execution.js';
import { validViewport } from './viewport.js';

let freeze = (value) => Object.freeze(value);
let record = (value) => value && typeof value === 'object' && !Array.isArray(value);
let text = (value) => typeof value === 'string' && value.length <= 10000;
let nonnegative = (value) => Number.isFinite(value) && value >= 0;
let strings = (value) => Array.isArray(value) && value.every(text);
let nullable = (validate) => (value) => value === null || validate(value);
let boolean = (value) => typeof value === 'boolean';
let fields = {
  phase: (value) => ['connecting', 'discovering', 'running', 'pausing', 'paused', 'resuming', 'debugging', 'completed', 'stopped', 'error'].includes(value),
  current: nullable((value) => Number.isSafeInteger(value) && value >= 0),
  files: strings,
  appHost: text,
  browser: text,
  interactive: boolean,
  pauseOnFailure: boolean,
  viewport: (value) => record(value) && Object.keys(value).every((key) => ['width', 'height'].includes(key)) &&
    validViewport(value, Number.MAX_SAFE_INTEGER),
  revision: (value) => Number.isSafeInteger(value) && value >= 0,
  presentation: (value) => ['app', 'reporter'].includes(value),
  viewportMode: (value) => ['fixed', 'browser'].includes(value),
  hasApp: boolean,
  debugMessage: nullable(text),
};

export function validOutput(entries) {
  return Array.isArray(entries) && entries.length <= 100 && entries.every((entry) =>
    record(entry) && ['app', 'test'].includes(entry.source) &&
    ['log', 'info', 'warn', 'error', 'debug'].includes(entry.level) &&
    typeof entry.text === 'string' && entry.text.length <= 2000 && nonnegative(entry.elapsed));
}

export function snapshotOutput(entries) {
  return freeze(entries.map(({ source, level, text, elapsed }) => freeze({ source, level, text, elapsed })));
}

function snapshot(value) {
  if (Array.isArray(value)) return freeze(value.map(snapshot));
  if (record(value)) return freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
  return value;
}

// Final outcomes travel once through /events. Live updates only carry progress.
export function liveChange(previous, next) {
  let set = Object.fromEntries(Object.keys(fields).filter((key) =>
    next[key] !== undefined && next[key] !== previous?.[key] &&
    !(key === 'phase' && ['completed', 'error', 'stopped'].includes(next.phase))).map((key) => [key, next[key]]));
  let before = new Map((previous?.tests ?? []).map((test) => [test.id, test]));
  let tests = [];
  for (let test of next.tests) {
    if (['passed', 'failed', 'skipped'].includes(test.status)) continue;
    let prior = before.get(test.id);
    let set = Object.fromEntries(['status', 'path'].filter((key) =>
      test[key] !== undefined && test[key] !== prior?.[key] &&
      !(key === 'status' && test[key] === 'pending')).map((key) => [key, test[key]]));
    let start = prior?.output?.length ?? 0;
    let entries = (test.output ?? []).slice(start);
    if (Object.keys(set).length || entries.length)
      tests.push({ index: test.index, set, ...(entries.length ? { output: { start, entries } } : {}) });
  }
  return Object.keys(set).length || tests.length ? { set, tests } : null;
}

export function runView(view = createExecution({ width: 1280, height: 800 }), run) {
  let live = new Map(view.tests.map((test) => [test.id, test]));
  let outcomes = new Map(run.outcomes.map((event) => [event.testId, event]));
  let partial = new Map((run.partial ?? []).map((test) => [test.id, test.output]));
  let tests = run.tests.map((test) => {
    let outcome = outcomes.get(test.id);
    let prior = live.get(test.id);
    if (!outcome && prior && !partial.has(test.id)) return prior;
    let result = outcome && Object.fromEntries(['workerId', 'executionId', 'status', 'skipReason', 'duration', 'timings', 'error', 'additionalErrors', 'output', 'attachments']
      .filter((key) => outcome[key] !== undefined).map((key) => [key, outcome[key]]));
    if (outcome && prior?.status === outcome.status && prior.output === outcome.output) return prior;
    return freeze({ ...test, status: 'pending', output: freeze([]), attachments: freeze([]), ...prior,
      ...(partial.has(test.id) ? { status: 'stopped', output: partial.get(test.id) } : {}), ...result });
  });
  let terminal = run.status === 'completed'
    ? { phase: 'completed', duration: run.summary.duration }
    : run.status === 'failed' ? { phase: run.stopped ? 'stopped' : 'error', error: run.error.message } : {};
  return freeze({ ...view, runId: run.runId, seed: run.seed ?? null, ...terminal,
    ...(run.coordination ? { coordination: run.coordination } : {}),
    ...(['completed', 'failed'].includes(run.status) ? { presentation: view.interactive ? 'reporter' : 'app' } : {}), tests: freeze(tests) });
}

export function workerView(run, progress, selected = run.workers[0].id, previous) {
  let owner = progress.find(worker => worker.id === selected) ?? progress[0];
  let base = owner?.view ?? createExecution({ width: 1280, height: 800 });
  let selectedRetired = run.workers.find(worker => worker.id === selected)?.status === 'retired';
  let ownsApp = id => run.assignments.some(assignment => assignment.workerId === id && assignment.status !== 'released' &&
    !run.tests[assignment.index].skipReason);
  let assignments = new Map(run.assignments.map(assignment => [assignment.testId, assignment]));
  let byWorker = new Map(progress.map(worker => [worker.id, new Map((worker.view?.tests ?? []).map(test => [test.id, test]))]));
  let prior = new Map((previous?.tests ?? []).map(test => [test.id, test]));
  let outcomes = new Set(run.outcomes.map(outcome => outcome.testId));
  let tests = run.tests.map(test => {
    let assignment = assignments.get(test.id);
    let live = byWorker.get(assignment?.workerId)?.get(test.id);
    let old = prior.get(test.id);
    if (old && (outcomes.has(test.id) || !live ||
      (old.workerId === assignment?.workerId && old.executionId === assignment?.id &&
        ['status', 'output', 'path'].every(key => old[key] === live[key])))) return old;
    return live ? freeze({ ...live, workerId: assignment.workerId, executionId: assignment.id })
      : freeze({ ...test, status: 'pending', output: freeze([]), attachments: freeze([]) });
  });
  let workers = run.workers.map(worker => {
    let view = progress.find(item => item.id === worker.id)?.view;
    return freeze({ id: worker.id, phase: worker.status === 'retired' ? 'retired' : worker.status === 'finished' ? 'completed' : view?.phase ?? 'connecting',
      current: view?.current ?? null, hasApp: worker.status !== 'retired' && ownsApp(worker.id) && (view?.hasApp ?? false) });
  });
  if (previous?.workers?.length === workers.length && workers.every((worker, index) =>
    Object.keys(worker).every(key => worker[key] === previous.workers[index][key]))) workers = previous.workers;
  let phase = base.phase;
  if (run.paused) phase = workers.some(worker => ['running', 'pausing', 'resuming'].includes(worker.phase)) ? 'pausing' : 'paused';
  return runView(freeze({ ...base, phase, hasApp: !selectedRetired && ownsApp(selected) && Boolean(base.hasApp), identity: owner?.identity ?? null,
    capabilities: owner?.capabilities, selectedWorker: selected, workers: freeze(workers), tests: freeze(tests) }), run);
}

export function applyLiveChange(view, change, run) {
  view = runView(view, run);
  if (!record(change) || Object.keys(change).some((key) => !['set', 'tests'].includes(key)) ||
    !record(change.set) || !Array.isArray(change.tests) || change.tests.length > run.tests.length)
    throw new Error('Invalid live reporting change.');
  for (let [key, value] of Object.entries(change.set))
    if (!Object.hasOwn(fields, key) || !fields[key](value)) throw new Error(`Invalid live field: ${key}.`);
  if (['completed', 'error', 'stopped'].includes(change.set.phase))
    throw new Error('Final run state comes from accepted events, not live progress.');
  if (change.set.current != null && !run.tests.some((test) => test.index === change.set.current))
    throw new Error('Unknown current test.');
  let updates = new Map();
  for (let update of change.tests) {
    let test = view.tests.find((test) => test.index === update?.index);
    if (!test || updates.has(update.index) || !record(update.set) ||
      Object.keys(update).some((key) => !['index', 'set', 'output'].includes(key)) ||
      Object.keys(update.set).some((key) => !['status', 'path'].includes(key)) ||
      (update.set.status !== undefined && !['pending', 'running', 'stopped'].includes(update.set.status)) ||
      (update.set.path !== undefined && !text(update.set.path)))
      throw new Error('Unknown test or invalid live test fields.');
    if (update.output !== undefined && (!record(update.output) ||
      Object.keys(update.output).some((key) => !['start', 'entries'].includes(key)) ||
      !Number.isSafeInteger(update.output.start) || update.output.start < 0 ||
      !validOutput(update.output.entries) || update.output.start + update.output.entries.length > 100))
      throw new Error('Invalid live output.');
    let finished = ['passed', 'failed', 'skipped'].includes(test.status);
    if (!finished && update.output && update.output.start !== test.output.length)
      throw new Error('Live output arrived out of order.');
    updates.set(update.index, finished ? test : freeze({ ...test, ...snapshot(update.set),
      ...(update.output ? { output: freeze([...test.output, ...snapshotOutput(update.output.entries)]) } : {}) }));
  }
  return runView(freeze({ ...view, ...snapshot(change.set),
    tests: freeze(view.tests.map((test) => updates.get(test.index) ?? test)) }), run);
}

export function partialOutput(view, run) {
  let finished = new Set(run.outcomes.map((event) => event.testId));
  return freeze((view?.tests ?? []).filter((test) => !finished.has(test.id) && test.output.length)
    .map((test) => freeze({ id: test.id, output: test.output })));
}

// Observer records replace changed tests absolutely, so coalescing loses no data.
export function observerChange(previous, next) {
  if (!previous || previous.tests.length !== next.tests.length) return { snapshot: next };
  let set = Object.fromEntries(Object.entries(next).filter(([key, value]) => key !== 'tests' && value !== previous[key]));
  let tests = next.tests.flatMap((test, position) => test === previous.tests[position] ? [] : [{ position, value: test }]);
  return Object.keys(set).length || tests.length ? { set, tests } : null;
}

export function applyObserverChange(previous, change) {
  if (change.snapshot) return freeze(change.snapshot);
  if (!previous || !record(change.set) || !Array.isArray(change.tests)) throw new Error('Reporter needs an initial snapshot.');
  let updates = new Map();
  for (let { position, value } of change.tests) {
    if (!Number.isSafeInteger(position) || position < 0 || position >= previous.tests.length ||
      updates.has(position) || value?.id !== previous.tests[position].id) throw new Error('Invalid changed reporter test.');
    updates.set(position, freeze(value));
  }
  return freeze({ ...previous, ...snapshot(change.set), tests: freeze(previous.tests.map((test, position) => updates.get(position) ?? test)) });
}

// Initial history and coalesced changes arrive in bounded records. Publish a
// complete view only after the matching commit frame has arrived.
export function acceptObserverFrame(previous = { view: null, sequence: null, pending: null }, kind, data) {
  if (!record(data)) throw new Error('Invalid reporter frame.');
  if (kind === 'view-start') {
    if (typeof data.reset !== 'boolean' || !record(data.set) || Object.hasOwn(data.set, 'tests') ||
      !Number.isSafeInteger(data.count) || data.count < 0 ||
      (data.reset ? data.sequence !== 0 : !previous.view || previous.pending || data.sequence !== previous.sequence + 1))
      throw new Error('Reporter batch arrived out of order.');
    return freeze({ ...previous, pending: freeze({ sequence: data.sequence, reset: data.reset,
      count: data.count, set: snapshot(data.set), tests: freeze([]) }) });
  }
  let pending = previous.pending;
  if (!pending || data.sequence !== pending.sequence) throw new Error('Reporter frame has no matching batch.');
  if (kind === 'view-tests') {
    if (!Array.isArray(data.tests) || pending.tests.length + data.tests.length > pending.count)
      throw new Error('Invalid reporter records.');
    let tests = [...pending.tests];
    for (let item of data.tests) {
      if (!record(item?.value) || typeof item.value.id !== 'string' || !Number.isSafeInteger(item.position) ||
        item.position < 0 || (pending.reset && item.position !== tests.length) ||
        tests.some((test) => test.position === item.position)) throw new Error('Invalid reporter test position.');
      tests.push(snapshot(item));
    }
    return freeze({ ...previous, pending: freeze({ ...pending, tests: freeze(tests) }) });
  }
  if (kind !== (pending.reset ? 'snapshot' : 'view-change') || pending.tests.length !== pending.count)
    throw new Error('Reporter batch ended before all records arrived.');
  let view = pending.reset
    ? freeze({ ...snapshot(pending.set), tests: freeze(pending.tests.map((test) => test.value)) })
    : applyObserverChange(previous.view, pending);
  if (new Set(view.tests.map((test) => test.id)).size !== view.tests.length)
    throw new Error('Duplicate reporter test identity.');
  return freeze({ view, sequence: data.sequence, pending: null });
}
