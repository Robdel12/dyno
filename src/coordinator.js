import { randomUUID, createHash } from 'node:crypto';
import { createRun, acceptEvent, claimTest, releaseTest, reportedExecution, joinWorker, finishWorker, retireWorkers, pauseRun } from './run.js';
import { mapStack, sourceContext } from './stack.js';
import { finishRunTimings, recordProjectCleanup } from './run-timings.js';
import { partialOutput, validOutput, snapshotOutput, applyLiveChange, workerView } from './browser/reporting.js';

let terminal = (run) => ['completed', 'failed'].includes(run.status);
let problem = (status, message) => Object.assign(new Error(message), { status });

// Network/process handles stay here. The run value remains the only source of
// catalog, assignment, resource and outcome state.
export function createCoordinator(config, bundle, {
  workerIds = ['0'], onEvent = () => {}, onRun = async () => {}, onError = () => {}, rebuild,
} = {}) {
  let runs = new Map(), bundles = new Map(), workers = new Map();
  let queues = new Map(), receipts = new Map(), drains = new Map();
  let pendingReports = new Set(), waiters = new Map();
  let progress = new Map(), views = new Map(), versions = new Map();
  let commands = new Map();
  let retirements = new Map(), connectionDeadlines = new Map(), joinDeadlines = new Map();
  let stopping = false, closing, managedRun, primaryRun;
  let restarting;
  let joining = Promise.resolve();
  let requireOpen = () => { if (stopping) throw problem(503, 'Dyno is shutting down.'); };
  let controls = (runId) => [...workers.values()].map(worker => worker.control).filter(control => control.has(runId));
  let view = (runId, selected) => {
    let run = runs.get(runId);
    if (!run) return;
    selected ??= run.workers[0].id;
    let cached = views.get(runId) ?? new Map();
    let previous = cached.get(selected);
    let revision = versions.get(runId);
    if (previous && previous.revision === revision) return previous.value;
    let value = workerView(run, run.workers.map(worker => ({ id: worker.id,
      view: progress.get(runId)?.get(worker.id), ...workers.get(worker.id)?.control.metadata(runId) })), selected, previous?.value);
    cached.set(selected, { revision, value });
    views.set(runId, cached);
    return value;
  };
  let partial = run => partialOutput(view(run.runId), run);
  let interrupted = (run, workerId, input = []) => {
    if (!Array.isArray(input) || input.length > run.tests.length || new Set(input.map(test => test?.id)).size !== input.length ||
      input.some(test => !test || !run.assignments.some(assignment => assignment.testId === test.id && assignment.workerId === workerId) || !validOutput(test.output)))
      throw new Error('Invalid interrupted test output.');
    let output = new Map(partial(run).map(test => [test.id, test]));
    for (let test of input) if (!run.outcomes.some(outcome => outcome.testId === test.id))
      output.set(test.id, Object.freeze({ id: test.id, output: snapshotOutput(test.output) }));
    return Object.freeze([...output.values()]);
  };
  let wake = (runId) => {
    for (let resolve of waiters.get(runId) ?? []) resolve();
    waiters.delete(runId);
  };
  let publish = run => {
    runs.set(run.runId, run);
    versions.set(run.runId, (versions.get(run.runId) ?? 0) + 1);
    for (let control of controls(run.runId)) control.publish(run.runId);
    wake(run.runId);
  };
  let serialize = (runId, work) => {
    let queued = (queues.get(runId) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(runId, queued);
    let clear = () => { if (queues.get(runId) === queued) queues.delete(runId); };
    queued.then(clear, clear);
    return queued;
  };
  let remember = (runId, key, digest, reply) => {
    let history = new Map(receipts.get(runId));
    history.set(key, { digest, reply });
    while (history.size > 64 || [...history.values()].reduce((total, item) => total + Buffer.byteLength(item.reply), 0) > 1_000_000)
      history.delete(history.keys().next().value);
    receipts.set(runId, history);
    return reply;
  };
  let replay = (runId, key, digest) => {
    let receipt = receipts.get(runId)?.get(key);
    if (receipt && receipt.digest !== digest) throw problem(409, 'Changed replay of an accepted request.');
    return receipt?.reply;
  };
  let drainProject = (context) => {
    let onDrain = workers.get(context.workerId)?.drain;
    if (!onDrain) return Promise.resolve(null);
    let scopes = drains.get(context.runId) ?? new Map();
    if (scopes.has(context.executionId)) return scopes.get(context.executionId);
    let work = Promise.resolve().then(async () => {
      let startedAt = performance.now();
      let deadline = AbortSignal.timeout(config.cleanupTimeout);
      let controller = new AbortController();
      let expired = Promise.withResolvers();
      let abort = () => {
        let error = new Error(`Project execution cleanup exceeded ${config.cleanupTimeout} ms. The callback must honor its abort signal; Dyno stopped waiting.`);
        controller.abort(error); expired.reject(error);
      };
      deadline.addEventListener('abort', abort, { once: true });
      try {
        await Promise.race([onDrain({ ...context, signal: controller.signal }), expired.promise]);
        return Object.freeze({ startedAt, finishedAt: performance.now(), status: 'passed' });
      } catch (error) {
        throw Object.assign(new Error(error.message, { cause: error }), {
          projectCleanup: Object.freeze({ startedAt, finishedAt: performance.now(), status: 'failed' }),
        });
      } finally { deadline.removeEventListener('abort', abort); }
    });
    scopes.set(context.executionId, work);
    drains.set(context.runId, scopes);
    return work;
  };
  let persist = (run) => {
    let work = Promise.resolve().then(() => onRun(run));
    pendingReports.add(work);
    work.then(() => pendingReports.delete(work), () => pendingReports.delete(work));
    return work.catch(error => { onError(error); throw error; });
  };
  let retire = run => {
    if (!run.managed) return Promise.resolve();
    if (!retirements.has(run.runId)) {
      let work = Promise.resolve().then(async () => {
        let results = await Promise.allSettled(run.workers.map(worker => workers.get(worker.id).lifecycle.retire()));
        publish(retireWorkers(runs.get(run.runId)));
        let errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join(' '));
      });
      retirements.set(run.runId, work);
    }
    return retirements.get(run.runId);
  };
  let commitTerminal = async (previous, candidate) => {
    let { run, event } = candidate;
    let failures = [];
    if (event.type === 'fatal') {
      try { await retire(previous); }
      catch (error) { failures.push(`Native cleanup: ${error.message}`); }
    }
    let native = controls(run.runId).map(control => control.finish(run.runId));
    let projectExecutions = previous.assignments.filter(assignment => !previous.tests[assignment.index].skipReason);
    let project = projectExecutions
      .map(assignment => drainProject({ runId: run.runId, executionId: assignment.id,
        workerId: assignment.workerId, test: previous.tests[assignment.index] }));
    let cleanup = await Promise.allSettled([...native, ...project]);
    for (let [index, result] of cleanup.entries()) {
      if (result.status !== 'rejected') continue;
      let error = result.reason;
      stopping = true;
      failures.push(`${index < native.length ? (event.error ? 'Native cleanup' : 'Native browser cleanup failed') : 'Project execution cleanup failed'}: ${error.message}`);
      if (index >= native.length) onError(Object.assign(error, { phase: 'cleanup' }));
    }
    if (failures.length) {
      let message = [event.error?.message, ...failures.filter(message => !event.error?.message?.includes(message))].filter(Boolean).join(' ');
      ({ run, event } = acceptEvent(previous, { runId: run.runId, type: 'fatal',
        partial: run.partial ?? partial(previous), error: { ...event.error, message, phase: 'cleanup' } }));
    }
    for (let [index, result] of cleanup.slice(native.length).entries())
      run = recordProjectCleanup(run, projectExecutions[index].id, result.status === 'fulfilled' ? result.value : result.reason.projectCleanup);
    if (run.managed && event.type === 'fatal') run = retireWorkers(run);
    run = finishRunTimings(run, performance.now());
    event = Object.freeze({ ...event, ...(event.type === 'complete' ? run.summary : { coordination: run.coordination }) });
    try { await persist(run); }
    catch (error) {
      stopping = true;
      publish(Object.freeze({ ...run, status: 'failed', stopped: false,
        error: Object.freeze({ phase: 'runtime', message: error.message }), partial: run.partial ?? partial(previous) }));
      throw problem(503, error.message);
    }
    publish(run);
    return { run, event };
  };
  let mapFailure = (runId, error) => {
    let snapshot = bundles.get(runId);
    let stack = typeof error?.stack === 'string' ? mapStack(error.stack, snapshot?.map, config.root) : undefined;
    let declaration = typeof error?.declaration === 'string' ? mapStack(error.declaration, snapshot?.map, config.root) : undefined;
    if (declaration && !stack?.includes(config.testDir)) stack = `${stack ?? error.message}\nDeclared at:\n${declaration}`;
    let mapped = { ...error, ...(stack ? { stack } : {}), ...(declaration ? { declaration } : {}) };
    return { ...mapped, source: sourceContext(mapped, snapshot, config.root) };
  };
  let stopRun = async (previous, error, stopped = false) => {
    if (!previous || terminal(previous)) return false;
    let result = await commitTerminal(previous, acceptEvent(previous, {
      runId: previous.runId, type: 'fatal', stopped, partial: partial(previous), error,
    }));
    onEvent(result.event);
    return true;
  };
  let failRun = (runId, error) => {
    serialize(runId, () => stopRun(runs.get(runId), { phase: 'runtime', message: error.message }))
      .then(stopped => { if (stopped && runId === primaryRun && runs.get(runId).managed) onError(error); }, onError);
  };
  let register = (workerId, control, drain) => {
    if (workers.has(workerId)) throw new Error('Worker gateway is already registered.');
    workers.set(workerId, { control, drain });
  };
  let selection = input => {
    input ??= {};
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['ids', 'names', 'files', 'suites'].includes(key)))
      throw problem(400, 'Invalid test selection.');
    let entries = Object.entries(input).map(([key, values]) => {
      if (!Array.isArray(values) || values.length > 10000 || values.some(value => typeof value !== 'string' || !value || value.length > 10000))
        throw problem(400, 'Invalid test selection.');
      return [key, Object.freeze([...values])];
    });
    return Object.freeze(Object.fromEntries(entries));
  };
  let create = (snapshot, ids, managed, selected, runId = randomUUID()) => {
    if (config.replay && JSON.stringify(snapshot.fingerprint) !== JSON.stringify(config.replay.source))
      throw new Error('The replay source fingerprint changed. Record a new schedule for these tests.');
    while (runs.size >= 20) {
      let finished = [...runs.values()].find(run => terminal(run) && !queues.has(run.runId));
      if (!finished) throw problem(429, 'Dyno already has 20 active browser runs. Finish or close one before joining again.');
      for (let control of controls(finished.runId)) control.drop(finished.runId);
      for (let map of [runs, bundles, receipts, drains, progress, views, versions, retirements]) map.delete(finished.runId);
    }
    if (config.replay) selected = selection({ ids: config.replay.selected });
    let run = Object.freeze({ ...createRun(runId, { seed: config.seed, workers: ids, replay: config.replay }),
      managed, selection: selected, source: snapshot.fingerprint, startedAt: new Date().toISOString() });
    bundles.set(runId, snapshot);
    if (managed) {
      managedRun = runId;
      let deadline = AbortSignal.timeout(Math.min(2147483647, 35000 + config.timeout));
      let expired = () => {
        if (!stopping && !terminal(runs.get(runId)))
          failRun(runId, new Error('Not every browser worker registered its test catalog before the startup deadline.'));
      };
      joinDeadlines.set(runId, () => deadline.removeEventListener('abort', expired));
      deadline.addEventListener('abort', expired, { once: true });
    }
    publish(run);
    return run;
  };
  let restart = (runId, selected) => {
    requireOpen();
    if (restarting) throw problem(409, 'This browser run is already restarting.');
    if (runId !== managedRun) throw problem(409, 'This browser run was replaced.');
    let previous = runs.get(runId);
    if (!terminal(previous)) publish(pauseRun(previous, true));
    onEvent({ type: 'restarting', runId, selection: selected });
    restarting = (async () => {
      await retire(previous);
      await serialize(runId, () => stopRun(runs.get(runId), { message: 'Browser run replaced.' }));
      requireOpen();
      let snapshot = rebuild ? await rebuild() : bundle;
      requireOpen();
      let run = create(snapshot, workerIds, true, selected);
      primaryRun = run.runId;
      await Promise.all(run.workers.map(worker => workers.get(worker.id).lifecycle.open()));
    })().catch(async error => {
      try {
        await serialize(runId, () => stopRun(runs.get(runId), { phase: 'runtime', message: error.message }));
      } finally { onError(error); }
      throw error;
    }).finally(() => { restarting = undefined; });
    restarting.catch(() => {});
    return restarting;
  };
  return Object.freeze({
    register, requireOpen, serialize,
    lifecycle(workerId, lifecycle) {
      workers.set(workerId, { ...workers.get(workerId), lifecycle });
    },
    connection(workerId, event) {
      if (stopping) return;
      onEvent({ type: 'browser-connection', workerId, ...event });
      if (event.source !== 'socket') return;
      let key = `${event.runId}:${workerId}`;
      connectionDeadlines.get(key)?.(); connectionDeadlines.delete(key);
      let run = runs.get(event.runId);
      if (event.status !== 'closed' || !run || terminal(run) || retirements.has(run.runId) ||
        run.workers.some(worker => worker.id === workerId && worker.status === 'finished') ||
        workers.get(workerId).control.connected(event.runId)) return;
      let deadline = AbortSignal.timeout(config.cleanupTimeout);
      let expired = () => {
        connectionDeadlines.delete(key);
        if (!stopping && !terminal(runs.get(run.runId)) && !retirements.has(run.runId))
          failRun(run.runId, new Error(`Browser worker ${workerId} lost its controller connection.`));
      };
      connectionDeadlines.set(key, () => deadline.removeEventListener('abort', expired));
      deadline.addEventListener('abort', expired, { once: true });
    },
    get: runId => runs.get(runId),
    view,
    progress(workerId, runId, change) {
      let run = runs.get(runId);
      let indices = [change.set?.current, ...(change.tests ?? []).map(update => update.index)];
      for (let index of indices) {
        let test = run.tests.find(test => test.index === index);
        if (test && !run.assignments.some(assignment => assignment.workerId === workerId && assignment.testId === test.id))
          throw problem(403, 'Live progress belongs to another worker.');
      }
      let views = progress.get(runId) ?? new Map();
      let next = applyLiveChange(views.get(workerId), change, run);
      views.set(workerId, next);
      progress.set(runId, views);
      versions.set(runId, (versions.get(runId) ?? 0) + 1);
      for (let control of controls(runId)) control.publish(runId);
    },
    values: () => [...runs.values()],
    bundle: runId => bundles.get(runId),
    attachment(id) {
      return [...runs.values()].flatMap(run => run.outcomes).flatMap(outcome => outcome.attachments ?? [])
        .find(attachment => attachment.id === id && attachment.status === 'captured');
    },
    isPrimary: runId => runId === primaryRun,
    notify(kind, value) {
      if (!primaryRun) return;
      for (let control of controls(primaryRun)) control.notify(primaryRun, kind, value);
    },
    reload() {
      if (!primaryRun) return false;
      let run = runs.get(primaryRun);
      if (run.managed) restart(primaryRun, run.selection);
      else for (let control of controls(primaryRun)) control.reload(primaryRun);
      return true;
    },
    async capture(workerId, input) {
      let work = joining.then(async () => {
        requireOpen();
        let control = workers.get(workerId).control;
        let managed = control.manages(input.launchKey);
        let previousRunId = managed ? managedRun : input.previous?.runId;
        let current = managed ? runs.get(managedRun) : undefined;
        let joinedBefore = current && current.workers.find(worker => worker.id === workerId)?.status !== 'pending';
        if (joinedBefore) {
          let requested = selection(input.selection);
          restart(current.runId, Object.values(requested).some(values => values.length) ? requested : current.selection);
          throw problem(409, 'Dyno is restarting this browser run.');
        }
        let reuse = current && !joinedBefore;
        let snapshot = reuse ? bundles.get(current.runId) : rebuild ? await rebuild() : bundle;
        requireOpen();
        let runId = reuse ? current.runId : randomUUID();
        onEvent({ type: 'joining', runId, workerId, previousRunId: previousRunId ?? null });
        let joined = await control.join(runId, input.launchKey, input.previous);
        requireOpen();
        if (!reuse) current = create(snapshot, managed ? workerIds : [workerId], managed, selection(input.selection), runId);
        current = joinWorker(current, workerId);
        publish(current);
        let primary = runs.get(primaryRun);
        if (managed || !primary || joined.previousRunId === primaryRun || (!primary.managed && terminal(primary))) primaryRun = runId;
        onEvent({ type: 'capture', runId, workerId, owned: joined.owned, previousRunId: joined.previousRunId });
        return { runId, workerId, ...joined, selection: current.selection };
      });
      joining = work.catch(() => {});
      return work;
    },
    replaced(runId) {
      return serialize(runId, () => stopRun(runs.get(runId), { message: 'Browser left the test run before completion.' }));
    },
    command(input, selected) {
      let run = runs.get(input.runId);
      if (!run) throw problem(404, 'Unknown test run.');
      if (input.command === 'rerun' && run.replay) {
        if (input.ids.length && (input.ids.length !== run.replay.selected.length || input.ids.some(id => !run.replay.selected.includes(id))))
          throw problem(400, 'Queue replay uses its recorded selection. Start a regular run to select different tests.');
        input = { ...input, ids: run.replay.selected };
      }
      if (input.command === 'rerun' && run.managed) {
        restart(run.runId, selection({ ids: input.ids }));
        return Promise.resolve({ requestId: input.requestId });
      }
      let global = ['pause', 'stop', 'rerun', 'pause-on-failure', 'reload'].includes(input.command) ||
        (input.command === 'continue' && run.paused);
      let ids = global ? run.workers.map(worker => worker.id) : [input.workerId ?? selected];
      if (ids.some(id => !run.workers.some(worker => worker.id === id))) throw problem(400, 'Unknown reporter worker.');
      let targets = ids.map(id => workers.get(id).control);
      if (targets.some(control => !control.connected(input.runId)))
        throw problem(409, 'The test browser is disconnected. Reopen its execution URL before sending commands.');
      let requestId = input.requestId ?? randomUUID();
      if (commands.size >= 64) throw problem(429, 'Too many pending reporter commands. Wait for a reply.');
      if (commands.has(requestId)) throw problem(409, 'This reporter command is already pending.');
      if (!terminal(run) && ['pause', 'continue', 'stop'].includes(input.command))
        publish(pauseRun(run, input.command === 'pause' ? !run.paused : input.command === 'stop'));
      if (input.command === 'pause-on-failure') publish(Object.freeze({ ...run, pauseOnFailure: input.value }));
      let completion = Promise.withResolvers();
      let deadline = AbortSignal.timeout(10000);
      let expired = () => {
        commands.delete(requestId);
        completion.reject(problem(504, 'A browser worker did not reply to the command.'));
      };
      commands.set(requestId, { runId: run.runId, ids, replies: new Map(), ...completion, detach: () => deadline.removeEventListener('abort', expired) });
      deadline.addEventListener('abort', expired, { once: true });
      for (let control of targets) control.sendCommand({ ...input, requestId });
      return completion.promise;
    },
    commandResult(workerId, input) {
      let pending = commands.get(input.requestId);
      if (!pending || pending.runId !== input.runId || !pending.ids.includes(workerId))
        throw problem(409, 'Unknown reporter command acknowledgement.');
      pending.replies.set(workerId, input.error ?? null);
      if (pending.replies.size !== pending.ids.length) return;
      pending.detach(); commands.delete(input.requestId);
      let error = [...pending.replies.values()].find(Boolean);
      pending.resolve({ requestId: input.requestId, error });
    },
    async assignment(workerId, input, signal) {
      let requestedAt = performance.now();
      let key = `${workerId}:assignment:${input.requestId}`;
      let digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      while (true) {
        signal?.throwIfAborted();
        let pending;
        let reply = await serialize(input.runId, () => {
          requireOpen();
          workers.get(workerId).control.authorize(input);
          let reply = replay(input.runId, key, digest);
          if (reply) return reply;
          let previous = runs.get(input.runId);
          let claimed = claimTest(previous, { workerId, executionId: randomUUID(), requestedAt, now: performance.now() });
          if (!claimed.assignment && !claimed.done && !claimed.run.paused) {
            pending = Promise.withResolvers();
            let listeners = waiters.get(input.runId) ?? new Set();
            listeners.add(pending.resolve);
            waiters.set(input.runId, listeners);
            return;
          }
          if (claimed.run !== previous) publish(claimed.run);
          return remember(input.runId, key, digest, JSON.stringify({ assignment: claimed.assignment, done: claimed.done, paused: claimed.run.paused }));
        });
        if (reply) return reply;
        let aborted = () => pending.reject(signal.reason);
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) aborted();
        try { await pending.promise; }
        finally {
          signal?.removeEventListener('abort', aborted);
          waiters.get(input.runId)?.delete(pending.resolve);
        }
      }
    },
    async release(workerId, input) {
      let key = `${workerId}:released:${input.requestId}`;
      let digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      let prepared = await serialize(input.runId, () => {
        requireOpen(); workers.get(workerId).control.authorize(input);
        let reply = replay(input.runId, key, digest);
        if (reply) return { reply };
        let run = runs.get(input.runId);
        let assignment = reportedExecution(run, { workerId, executionId: input.executionId });
        return { assignment, test: run.tests[assignment.index] };
      });
      if (prepared.reply) return prepared.reply;
      let cleanup;
      try {
        if (!prepared.test.skipReason) cleanup = await drainProject({ runId: input.runId, executionId: input.executionId, workerId, test: prepared.test });
      } catch (error) {
        await serialize(input.runId, () => stopRun(runs.get(input.runId), {
          phase: 'cleanup', message: `Project execution cleanup failed: ${error.message}`,
        }));
        throw error;
      }
      return serialize(input.runId, () => {
        requireOpen(); workers.get(workerId).control.authorize(input);
        let reply = replay(input.runId, key, digest);
        if (reply) return reply;
        let run = recordProjectCleanup(runs.get(input.runId), input.executionId, cleanup);
        publish(releaseTest(run, { workerId, executionId: input.executionId, now: performance.now() }));
        workers.get(workerId).control.releaseExecution(input.runId, input.executionId);
        return remember(input.runId, key, digest, '{}');
      });
    },
    event(workerId, input) {
      return serialize(input.runId, async () => {
        requireOpen();
        let control = workers.get(workerId).control;
        control.authorize(input);
        let key = `${workerId}:${input.type === 'test' ? 'test:' + input.testId : input.type}`;
        let digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        let repeated = replay(input.runId, key, digest);
        if (repeated) return repeated;
        let { connectionKey, ...eventInput } = input;
        eventInput = { ...eventInput, workerId };
        let previous = runs.get(input.runId);
        if (input.type === 'departed') {
          if (!terminal(previous)) publish(Object.freeze({ ...pauseRun(previous, true), partial: interrupted(previous, workerId, input.partial) }));
          return '{}';
        }
        if (input.type === 'start') eventInput.seed = previous.seed;
        if (input.type === 'test') eventInput.attachments = control.attachments(input.runId, input.executionId);
        if (input.error) eventInput.error = mapFailure(input.runId, input.error);
        if (Array.isArray(input.additionalErrors)) eventInput.additionalErrors = input.additionalErrors.map(error => mapFailure(input.runId, error));
        if (input.type === 'fatal') {
          eventInput.partial = interrupted(previous, workerId, input.partial);
        }
        let proposed = previous;
        if (input.type === 'complete') {
          proposed = finishWorker(previous, workerId);
          if (proposed.workers.some(worker => worker.status !== 'finished')) {
            publish(proposed);
            return remember(input.runId, key, digest, '{}');
          }
          if (proposed.workers.length > 1) eventInput.duration = performance.now() - proposed.startedClock;
        }
        let { run, event } = acceptEvent(proposed, eventInput, { receivedAt: performance.now() });
        if (input.type === 'start' && run.workers.every(worker => worker.status === 'ready')) {
          joinDeadlines.get(run.runId)?.(); joinDeadlines.delete(run.runId);
        }
        if (input.type === 'start' && previous.startedClock === undefined) run = Object.freeze({ ...run, startedClock: performance.now() });
        if (event?.type === 'test') control.acceptAttachments(input.runId, input.executionId);
        for (let attachment of event?.attachments ?? []) onEvent({ type: 'attachment', runId: run.runId, workerId, executionId: event.executionId, attachment });
        if (event && ['complete', 'fatal'].includes(event.type)) ({ run, event } = await commitTerminal(previous, { run, event }));
        else publish(run);
        let reply = remember(run.runId, key, digest, JSON.stringify({ error: event?.error, additionalErrors: event?.additionalErrors,
          attachments: event?.attachments, remaining: run.tests.length - run.outcomes.length,
          workRemaining: run.tests.filter(test => !test.skipReason && !run.outcomes.some(outcome => outcome.testId === test.id)).length }));
        if (event) onEvent(event);
        return reply;
      });
    },
    close({ error } = {}) {
      stopping = true;
      for (let runId of waiters.keys()) wake(runId);
      closing ??= (async () => {
        for (let command of commands.values()) { command.detach(); command.reject(problem(503, 'Dyno is shutting down.')); }
        commands.clear();
        for (let detach of [...connectionDeadlines.values(), ...joinDeadlines.values()]) detach();
        connectionDeadlines.clear(); joinDeadlines.clear();
        await restarting?.catch(() => {});
        let failures = [];
        await Promise.allSettled([...queues.values()]);
        for (let previous of runs.values()) {
          try { await stopRun(previous, { phase: 'runtime',
            message: `Dyno stopped before the browser run completed.${error ? ' ' + error.message : ''}`,
            ...(error?.stack ? { stack: error.stack } : {}) }); }
          catch (error) { failures.push(error); }
        }
        await joining;
        let pending = await Promise.allSettled([...pendingReports]);
        failures.push(...pending.filter(result => result.status === 'rejected').map(result => result.reason));
        if (failures.length) throw new AggregateError(failures, 'Could not finish Dyno reports and cleanup.');
      })();
      return closing;
    },
  });
}
