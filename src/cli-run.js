import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { configOverrides } from './cli.js';
import { loadConfig } from './config.js';
import { buildSuite } from './build.js';
import { startWebServer } from './process.js';
import { createGateway } from './server.js';
import { createCoordinator } from './coordinator.js';
import { projectWorker } from './project-worker.js';
import { resolveSession, createBrowserPool } from './browser-session.js';
import { createCleanup, createCleanupScope } from './cleanup.js';
import { defaultViewport } from './browser/viewport.js';
import { createWatchSession } from './watch-session.js';
import { createReportWriter } from './reports.js';
import { createTimings } from './browser/timings.js';
import { readReplay } from './schedule.js';
import { createRepeat, repeatSeed, acceptRepeatRound, finishRepeat, repeatCommand } from './repeat.js';
import { createRepeatWriter } from './repeat-reports.js';

async function duringStartup(signal, start) {
  let controller = new AbortController();
  let abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try { return await start(controller.signal); }
  finally { signal.removeEventListener('abort', abort); }
}

async function acquire(scope, create) {
  try {
    let descriptor = await create();
    if (typeof descriptor?.teardown === 'function') scope.onCleanup(descriptor.teardown);
    return descriptor;
  } finally { scope.seal(); }
}

async function closeScope(scope, name) {
  let errors = await scope.run();
  if (errors.length) throw new AggregateError(errors, `${name}: ${errors.map(error => error.message).join(' ')}`);
}

export async function runTests(options, { signal, output }) {
  let controller = new AbortController();
  let runSignal = AbortSignal.any([signal, controller.signal]);
  let exitCode = 0;
  let sessionTimings = createTimings();
  let sessionId = randomUUID();
  let session = Object.freeze({ id: sessionId });
  let browserCleanup;
  let sessionStartedAt = new Date().toISOString();
  let sessionSnapshot = (status, timings = sessionTimings.snapshot()) => Object.freeze({
    schemaVersion: 1, sessionId, startedAt: sessionStartedAt, status, timings,
    ...(browserCleanup ? { browserCleanup } : {})
  });
  let measure = (name, work) => sessionTimings.measure('lifecycle', name, work);
  let loaded = await measure('Load config', () => loadConfig(options.config, configOverrides(options)));
  let replay = options.replay ? await measure('Read replay schedule', () => readReplay(options.replay)) : null;
  if (replay && options.workers !== undefined && options.workers !== replay.workers.length)
    throw new Error(`Replay requires ${replay.workers.length} workers. Remove --workers or use that count.`);
  if (options.manual && replay?.workers.length > 1) throw new Error('Multi-worker queue replay requires a managed browser.');
  if (options.manual && options.workers > 1) throw new Error('Manual URL runs use one worker. Remove --workers or use a managed browser.');
  let config = Object.freeze({ ...loaded, replay, workers: options.manual ? 1 : replay?.workers.length ?? loaded.workers,
    seed: replay ? replay.seed : loaded.seed ?? (loaded.random ? randomUUID() : null) });
  let browserPlan = options.manual ? null : await measure('Resolve browser', () => resolveSession(config.browser, { headless: !options.ui }));
  let cleanups = createCleanup();
  let cleanup = (name, work) => cleanups.add(() => sessionTimings.measure('lifecycle', name, work));
  let pending = Promise.withResolvers();
  pending.promise.catch(() => {});
  let failed = error => {
    pending.reject(error);
    controller.abort(error);
  };
  let endingError;
  let finalizationErrors = [];
  let batch, batchWriter, batchReason;
  let watcher, coordinator;
  let instances = [];
  let launchKeys = [];
  let writer = createReportWriter(config.reportDir, {
    redact: value => launchKeys.reduce((text, key) => text.replaceAll(key, '[private launch]'), value)
  });
  let savedRuns = 0;
  let saveRun = async (run) => {
    if (batch && coordinator.isPrimary(run.runId)) {
      let next = acceptRepeatRound(batch, run);
      if (next === batch) return;
      batch = next;
      let result = await batchWriter.save(batch, run);
      // Portable failure/final reports own retained images. Successful
      // intermediate captures must not accumulate outside the evidence budget.
      for (let image of run.outcomes.flatMap(outcome => outcome.attachments ?? []))
        if (image.status === 'captured') await rm(image.path, { force: true });
      if (result.saved) { savedRuns++; output.event({ type: 'report-saved', ...result.saved }); }
      if (result.limited) {
        batchReason = 'evidence-limit';
        throw new Error('Repeated-run evidence reached 256 MiB. Accepted counts were saved; no further rounds will start.');
      }
      return;
    }
    let result = await writer.save(run, sessionSnapshot('running'));
    savedRuns++;
    output.event({ type: 'report-saved', ...result });
  };
  let persistent = options.ui || options.manual || options.watch;
  let report = (event) => {
    if (event.type === 'capture') {
      let gateway = instances.find(instance => instance.id === event.workerId)?.gateway;
      event = { ...event, reporterURL: `${gateway.origin}/__dyno__/reporter?run=${encodeURIComponent(event.runId)}` };
    }
    if (coordinator?.isPrimary(event.runId)) watcher?.observe(event);
    output.event(event, { persistent });
    if (coordinator?.isPrimary(event.runId) && !persistent) {
      if (event.type === 'complete') pending.resolve(event);
      if (event.type === 'fatal') failed(new Error(event.error?.message ?? 'Browser runtime failed.'));
    }
  };
  let aborted = () => pending.reject(runSignal.reason);
  runSignal.addEventListener('abort', aborted, { once: true });
  if (runSignal.aborted) aborted();
  try {
    let bundle = await measure('Bundle tests', () => buildSuite(config));
    if (replay && JSON.stringify(bundle.fingerprint) !== JSON.stringify(replay.source))
      throw new Error('The replay source fingerprint changed. Record a new schedule for these tests.');
    runSignal.throwIfAborted();
    let pool = browserPlan
      ? await measure('Prepare browser', () => createBrowserPool(browserPlan, {
          size: config.workers, signal: runSignal,
          onExit: failed,
          onDiagnostic: (event) => { if (!runSignal.aborted) output.event({ type: 'browser-diagnostic', ...event }); }
        }))
      : null;
    if (pool) cleanup('Stop browser', async () => {
      let result = await pool.stop();
      browserCleanup = result;
      output.event({ type: 'browser-stopped', sessionId, ...result });
    });
    let setup;
    if (config.setup) {
      let scope = createCleanupScope();
      cleanup('Project teardown', () => closeScope(scope, 'Project teardown failed'));
      setup = await measure('Project setup', () => acquire(scope, () => duringStartup(runSignal, async (startupSignal) => {
        let module = await import(pathToFileURL(config.setup).href);
        if (typeof module.default !== 'function') throw new Error('setup must export a function.');
        return module.default({ config, session, signal: startupSignal, onCleanup: scope.onCleanup });
      })));
      if (setup?.teardown !== undefined && typeof setup.teardown !== 'function')
        throw new Error('setup.teardown must be a function.');
      if (setup?.beforeExecution !== undefined && typeof setup.beforeExecution !== 'function')
        throw new Error('setup.beforeExecution must be a function.');
      if (setup?.drain !== undefined && typeof setup.drain !== 'function')
        throw new Error('setup.drain must be a function.');
    }
    runSignal.throwIfAborted();
    if (setup?.createWorker !== undefined && typeof setup.createWorker !== 'function')
      throw new Error('setup.createWorker must be a function.');
    if (config.workers > 1 && !setup?.createWorker)
      throw new Error('Concurrent runs need setup.createWorker to provide isolated project resources.');
    let projectCleanups = createCleanup();
    let appCleanups = createCleanup();
    cleanup('Project worker teardown', async () => {
      let errors = await projectCleanups.run();
      if (errors.length) throw new AggregateError(errors, `Project worker teardown failed: ${errors.map(error => error.message).join(' ')}`);
    });
    cleanup('Stop app server', async () => {
      let errors = await appCleanups.run();
      if (errors.length) throw new AggregateError(errors, 'App server cleanup failed.');
    });
    let workerIds = Array.from({ length: config.workers }, (_, index) => String(index));
    coordinator = createCoordinator(config, bundle, {
      workerIds, onEvent: report, onRun: saveRun,
      onError: error => {
        output.event({ type: 'error', phase: error.phase ?? 'report', message: error.message });
        failed(error);
      },
      rebuild: persistent ? () => buildSuite(config) : null,
    });
    cleanup('Save reports and close gateway', async () => {
      let results = await Promise.allSettled(instances.map(instance => instance.gateway.close({ error: endingError })));
      let errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Could not finish Dyno reports and cleanup.');
    });
    let starting = new AbortController();
    let startupSignal = AbortSignal.any([runSignal, starting.signal]);
    let starts = await measure('App server ready', () => Promise.allSettled(workerIds.map(async (id, index) => {
      try {
        let scope;
        if (setup?.createWorker) {
          scope = createCleanupScope();
          projectCleanups.add(() => closeScope(scope, `Project worker ${id} teardown failed`));
        }
        let descriptor = setup?.createWorker
          ? await measure(`Project worker ${id} setup`, () => acquire(scope, () => duringStartup(startupSignal, startupSignal =>
              setup.createWorker({ worker: Object.freeze({ id, index }), config, session,
                signal: startupSignal, onCleanup: scope.onCleanup }))))
          : setup ?? {};
        let project = projectWorker(config, descriptor, index, setup?.createWorker ? setup : undefined);
        runSignal.throwIfAborted();
        let browser = pool ? await pool.createWorker(id, { viewport: config.viewport ?? defaultViewport }) : null;
        let launchKey = browser ? randomUUID() : null;
        if (launchKey) launchKeys = [...launchKeys, launchKey];
        let gateway = await measure(`Start worker ${id} gateway`, () => createGateway(project.config, bundle, {
          coordinator, workerId: id, fixtures: project.fixtures, beforeExecution: project.beforeExecution,
          onDrain: project.drain ? context => sessionTimings.measure('lifecycle',
            ('Project cleanup: ' + [...context.test.suites, context.test.name].join(' › ')).slice(0, 200),
            () => project.drain(context), { signal: context.signal }) : undefined,
          interactive: Boolean(options.ui || options.manual), releaseFinal: options.repeat !== undefined, onEvent: report,
        }));
        let instance = { id, gateway, browser, launchKey, config: project.config };
        instances = [...instances, instance];
        if (browser) gateway.attachSession(browser, launchKey);
        let appServer = await measure(`Worker ${id} app server ready`, () => duringStartup(startupSignal, startupSignal => startWebServer(
          { ...project.config.webServer, env: { ...project.config.webServer.env, DYNO_URL: gateway.origin } },
          { signal: startupSignal, onReady: headers => gateway.setDocumentPolicy(headers),
            output: message => output.diagnostic(`[app] ${message}`) }
        )));
        appCleanups.add(appServer.stop);
        let appExited = () => failed(appServer.failure ?? new Error(`Worker ${id} app server stopped.`));
        appServer.child?.once('exit', appExited);
        cleanups.add(async () => appServer.child?.removeListener('exit', appExited));
        if (appServer.failure) throw appServer.failure;
        runSignal.throwIfAborted();
      } catch (error) { starting.abort(error); throw error; }
    })));
    let startupFailure = starts.find(result => result.status === 'rejected');
    if (startupFailure) throw startupFailure.reason;
    instances.sort((left, right) => Number(left.id) - Number(right.id));
    let gateway = instances[0].gateway;
    if (options.watch) {
      watcher = createWatchSession({
        config, inputs: bundle.inputs, signal: runSignal,
        onStatus: event => {
          output.event({ type: 'watch', ...event });
          coordinator.notify('watch', event);
        }, onError: failed,
        reload: () => coordinator.reload(),
      });
      cleanup('Stop watching', () => watcher.close());
    }
    let captureURL = instance => {
      let url = new URL(instance.gateway.url);
      if (replay) return url;
      if (options.test) url.searchParams.set('test', options.test);
      for (let key of ['id', 'file', 'suite'])
        for (let value of options[key] ?? []) url.searchParams.append(key, value);
      return url;
    };
    let first = instances[0];
    let browserInfo = browserPlan
      ? { ...first.browser.identity, path: browserPlan.path, isolated: browserPlan.isolated }
      : null;
    if (options.repeat !== undefined) {
      batch = createRepeat({ id: sessionId, count: options.repeat, seed: config.seed, source: bundle.fingerprint,
        workers: config.workers, replay: Boolean(replay), browser: browserInfo,
        selection: Object.freeze(replay ? { ids: replay.selected } :
          { test: options.test, ids: options.id, files: options.file, suites: options.suite }),
        command: repeatCommand(options, { seed: config.seed, count: options.repeat, workers: config.workers }) });
      batchWriter = await createRepeatWriter(join(config.reportDir, 'repeat-' + sessionId), {
        redact: value => launchKeys.reduce((text, key) => text.replaceAll(key, '[private launch]'), value)
      });
      output.event({ type: 'repeat-start', batchId: batch.id, requested: batch.requested, seed: batch.seed,
        resources: batch.resources, command: batch.command, browser: browserInfo });
    }
    output.event({
      type: 'ready', url: captureURL(first).href, appURL: first.config.webServer.url,
      workers: instances.map(instance => ({ id: instance.id, url: captureURL(instance).href, appURL: instance.config.webServer.url })),
      files: bundle.files, browser: browserInfo, seed: config.seed,
      ...(replay ? { replay: { selected: replay.selected.length, omitted: replay.omitted } } : {}),
    });
    if (['0.0.0.0', '::'].includes(config.host) && !output.json) {
      for (let entries of Object.values(networkInterfaces()))
        for (let entry of entries ?? []) {
          if (!entry.internal && entry.family === 'IPv4')
            output.line(`Device: ${gateway.url.replace(/127\.0\.0\.1|\[::1\]/, entry.address)}`);
        }
    }
    let expired = () => {
      let message = `No complete browser result within ${config.runTimeout} ms. The browser may be disconnected, blocked, or stuck.`;
      let output = instances.map(instance => instance.browser?.logs?.trim()).filter(Boolean).join('\n');
      controller.abort(new Error(output ? `${message}\nBrowser output:\n${output}` : message));
    };
    let previous;
    for (let number = 1; number <= (options.repeat ?? 1); number++) {
      runSignal.throwIfAborted();
      if (number > 1) {
        pending = Promise.withResolvers();
        pending.promise.catch(() => {});
      }
      let deadline = persistent ? null : AbortSignal.timeout(config.runTimeout);
      deadline?.addEventListener('abort', expired, { once: true });
      try {
        if (batch) output.event({ type: 'repeat-round', batchId: batch.id, round: number,
          requested: batch.requested, seed: repeatSeed(batch, number) });
        if (number > 1) await coordinator.advance(previous.runId, repeatSeed(batch, number));
        else if (browserPlan) await measure('Open browsers', () => Promise.all(instances.map(instance => {
          let url = captureURL(instance);
          url.hash = new URLSearchParams({ launch: instance.launchKey }).toString();
          return instance.browser.open(url.href);
        })));
        previous = await sessionTimings.measure('lifecycle', 'Browser results', () => pending.promise, { signal: runSignal });
        if (previous.failed) exitCode = 1;
      } finally {
        deadline?.removeEventListener('abort', expired);
      }
    }
  } catch (error) {
    let reason = runSignal.aborted ? runSignal.reason : error;
    endingError = reason instanceof Error ? reason : new Error(reason?.message ?? String(reason));
    endingError.message = launchKeys.reduce((message, key) => message.replaceAll(key, '[private launch]'), endingError.message);
  } finally {
    controller.abort(new Error('Dyno is shutting down.'));
    for (let error of await sessionTimings.measure('lifecycle', 'Cleanup', () => cleanups.run())) {
      output.event({ type: 'error', phase: 'cleanup', message: error.message });
      finalizationErrors.push(error.message);
      exitCode = 1;
    }
    let session = sessionSnapshot(exitCode ? 'failed' : signal.aborted ? 'interrupted' : endingError ? 'failed' : 'completed', sessionTimings.end());
    try { await writer.finishSession(session); }
    catch (error) {
      exitCode = 1;
      finalizationErrors.push(error.message);
      session = Object.freeze({ ...session, status: 'failed' });
      output.event({ type: 'error', phase: 'report', message: error.message });
    }
    if (batchWriter) {
      let reason = [batchReason ?? (signal.aborted ? signal.reason.message : endingError?.message), ...finalizationErrors]
        .filter(Boolean).join(' ') || undefined;
      batch = finishRepeat(batch, reason);
      try {
        let prefixCommand = batch.firstFailure ? repeatCommand(options, { seed: batch.seed,
          count: batch.firstFailure.round, workers: config.workers }) : undefined;
        let saved = await batchWriter.finish(batch, session, { prefixCommand });
        output.event({ type: 'repeat-complete', ...batch, ...saved,
          ...(prefixCommand ? { prefixCommand } : {}) });
      } catch (error) {
        exitCode = 1;
        finalizationErrors.push(error.message);
        output.event({ type: 'error', phase: 'report', message: error.message });
      }
    }
    output.event({ type: 'session-timing', ...session }, { savedRuns: batchWriter ? 0 : savedRuns });
    runSignal.removeEventListener('abort', aborted);
  }
  if (signal.aborted && !finalizationErrors.length) signal.throwIfAborted();
  if (endingError && !signal.aborted) throw endingError;
  if (exitCode) return exitCode;
  signal.throwIfAborted();
  return 0;
}
