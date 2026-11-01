import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { configOverrides } from './cli.js';
import { loadConfig } from './config.js';
import { buildSuite } from './build.js';
import { startWebServer } from './process.js';
import { createGateway } from './server.js';
import { resolveSession, createBrowserPool } from './browser-session.js';
import { createCleanup } from './cleanup.js';
import { defaultViewport } from './browser/viewport.js';
import { createWatchSession } from './watch-session.js';
import { createReportWriter } from './reports.js';
import { createTimings } from './browser/timings.js';

async function duringStartup(signal, start) {
  let controller = new AbortController();
  let abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try { return await start(controller.signal); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function runTests(options, { signal, output }) {
  let controller = new AbortController();
  let runSignal = AbortSignal.any([signal, controller.signal]);
  let exitCode = 0;
  let sessionTimings = createTimings();
  let sessionId = randomUUID();
  let browserCleanup;
  let sessionStartedAt = new Date().toISOString();
  let sessionSnapshot = (status, timings = sessionTimings.snapshot()) => Object.freeze({
    schemaVersion: 1, sessionId, startedAt: sessionStartedAt, status, timings,
    ...(browserCleanup ? { browserCleanup } : {})
  });
  let measure = (name, work) => sessionTimings.measure('lifecycle', name, work);
  let loaded = await measure('Load config', () => loadConfig(options.config, configOverrides(options)));
  let config = Object.freeze({ ...loaded, seed: loaded.seed ?? (loaded.random ? randomUUID() : null) });
  let browserPlan = options.manual ? null : await measure('Resolve browser', () => resolveSession(config.browser, { headless: !options.ui }));
  let cleanups = createCleanup();
  let cleanup = (name, work) => cleanups.add(() => sessionTimings.measure('lifecycle', name, work));
  let { promise: finished, resolve: complete, reject: failed } = Promise.withResolvers();
  finished.catch(() => {});
  let activeRun;
  let endingError;
  let watcher, gateway;
  let launchKey;
  let reporterAddress;
  let writer = createReportWriter(config.reportDir, {
    redact: (value) => (launchKey ? value.replaceAll(launchKey, '[private launch]') : value)
  });
  let savedRuns = 0;
  let saveRun = async (run) => {
    let result = await writer.save(run, sessionSnapshot('running'));
    savedRuns++;
    output.event({ type: 'report-saved', ...result });
  };
  let persistent = options.ui || options.manual || options.watch;
  let report = (event) => {
    if (event.type === 'capture')
      event = { ...event, reporterURL: `${reporterAddress}?run=${encodeURIComponent(event.runId)}` };
    if (event.type === 'capture' && (event.owned || event.previousRunId === activeRun || (!browserPlan && !activeRun)))
      activeRun = event.runId;
    if (event.runId === activeRun) watcher?.observe(event);
    output.event(event, { persistent });
    if (event.runId === activeRun && !persistent) {
      if (event.type === 'complete') complete(event);
      if (event.type === 'fatal') failed(new Error(event.error?.message ?? 'Browser runtime failed.'));
    }
  };
  let aborted = () => failed(runSignal.reason);
  runSignal.addEventListener('abort', aborted, { once: true });
  if (runSignal.aborted) aborted();
  try {
    let bundle = await measure('Bundle tests', () => buildSuite(config));
    runSignal.throwIfAborted();
    let pool = browserPlan
      ? await measure('Prepare browser', () => createBrowserPool(browserPlan, {
          signal: runSignal,
          onExit: failed,
          onDiagnostic: (event) => { if (!runSignal.aborted) output.event({ type: 'browser-diagnostic', ...event }); }
        }))
      : null;
    if (pool) cleanup('Stop browser', async () => {
      let result = await pool.stop();
      browserCleanup = result;
      output.event({ type: 'browser-stopped', sessionId, ...result });
    });
    let browser = pool ? await pool.createWorker('0', { viewport: config.viewport ?? defaultViewport }) : null;
    launchKey = browser ? randomUUID() : null;
    let setup;
    if (config.setup) {
      setup = await measure('Project setup', () => duringStartup(runSignal, async (startupSignal) => {
        let module = await import(pathToFileURL(config.setup).href);
        if (typeof module.default !== 'function') throw new Error('setup must export a function.');
        return module.default({ config, signal: startupSignal });
      }));
      if (typeof setup?.teardown === 'function') cleanup('Project teardown', setup.teardown);
      if (setup?.drain !== undefined && typeof setup.drain !== 'function')
        throw new Error('setup.drain must be a function.');
    }
    runSignal.throwIfAborted();
    let appServer;
    cleanup('Stop app server', () => appServer?.stop());
    gateway = await measure('Start gateway', () => createGateway(config, bundle, {
      fixtures: setup?.fixtures,
      onDrain: setup?.drain ? (context) => sessionTimings.measure('lifecycle',
        ('Project cleanup: ' + [...context.test.suites, context.test.name].join(' › ')).slice(0, 200),
        () => setup.drain(context), { signal: context.signal }) : undefined,
      interactive: Boolean(options.ui || options.manual),
      onEvent: report,
      onRun: saveRun,
      onError: (error) => {
        output.event({ type: 'error', phase: error.phase ?? 'report', message: error.message });
        failed(error);
      },
      rebuild: persistent ? () => buildSuite(config) : null
    }));
    cleanup('Save reports and close gateway', () => gateway.close({ error: endingError }));
    if (options.watch) {
      watcher = createWatchSession({
        config, inputs: bundle.inputs, signal: runSignal,
        onStatus: (event) => {
          output.event({ type: 'watch', ...event });
          if (activeRun) gateway.notify(activeRun, 'watch', event);
        },
        onError: failed,
        reload: () => {
          if (!activeRun) return false;
          gateway.reload(activeRun);
          return true;
        }
      });
      cleanup('Stop watching', () => watcher.close());
    }
    reporterAddress = gateway.origin + '/__dyno__/reporter';
    if (browser) gateway.attachSession(browser, launchKey);
    appServer = await measure('App server ready', () => duringStartup(runSignal, (startupSignal) => startWebServer(
      { ...config.webServer, env: { ...config.webServer.env, ...setup?.env, DYNO_URL: gateway.origin } },
      {
        signal: startupSignal,
        onReady: (headers) => gateway.setDocumentPolicy(headers),
        output: (message) => output.diagnostic(`[app] ${message}`)
      }
    )));
    let appExited = () => failed(appServer.failure ?? new Error('App server stopped.'));
    appServer.child?.once('exit', appExited);
    cleanups.add(async () => appServer.child?.removeListener('exit', appExited));
    if (appServer.failure) throw appServer.failure;
    runSignal.throwIfAborted();
    let captureURL = new URL(gateway.url);
    if (options.test) captureURL.searchParams.set('test', options.test);
    for (let key of ['id', 'file', 'suite'])
      for (let value of options[key] ?? []) captureURL.searchParams.append(key, value);
    let browserInfo = browserPlan
      ? { ...browser.identity, path: browserPlan.path, isolated: browserPlan.isolated }
      : null;
    output.event({
      type: 'ready', url: captureURL.href, appURL: config.webServer.url,
      files: bundle.files, browser: browserInfo, seed: config.seed
    });
    if (['0.0.0.0', '::'].includes(config.host) && !output.json) {
      for (let entries of Object.values(networkInterfaces()))
        for (let entry of entries ?? []) {
          if (!entry.internal && entry.family === 'IPv4')
            output.line(`Device: ${gateway.url.replace(/127\.0\.0\.1|\[::1\]/, entry.address)}`);
        }
    }
    let deadline = persistent ? null : AbortSignal.timeout(config.runTimeout);
    let expired = () => {
      let message = `No complete browser result within ${config.runTimeout} ms. The browser may be disconnected, blocked, or stuck.`;
      let output = browser?.logs?.trim();
      controller.abort(new Error(output ? `${message}\nBrowser output:\n${output}` : message));
    };
    deadline?.addEventListener('abort', expired, { once: true });
    try {
      if (browserPlan) {
        let ownedURL = new URL(captureURL);
        ownedURL.hash = new URLSearchParams({ launch: launchKey }).toString();
        await measure('Open browser', () => browser.open(ownedURL.href));
      }
      let summary = await sessionTimings.measure('lifecycle', 'Browser results', () => finished, { signal: runSignal });
      exitCode = summary.failed ? 1 : 0;
    } finally {
      deadline?.removeEventListener('abort', expired);
    }
  } catch (error) {
    endingError = error instanceof Error ? error : new Error(error?.message ?? String(error));
    if (launchKey) endingError.message = endingError.message.replaceAll(launchKey, '[private launch]');
  } finally {
    controller.abort(new Error('Dyno is shutting down.'));
    for (let error of await sessionTimings.measure('lifecycle', 'Cleanup', () => cleanups.run())) {
      output.event({ type: 'error', phase: 'cleanup', message: error.message });
      exitCode = 1;
    }
    let session = sessionSnapshot(exitCode ? 'failed' : signal.aborted ? 'interrupted' : endingError ? 'failed' : 'completed', sessionTimings.end());
    try { await writer.finishSession(session); }
    catch (error) {
      exitCode = 1;
      session = Object.freeze({ ...session, status: 'failed' });
      output.event({ type: 'error', phase: 'report', message: error.message });
    }
    output.event({ type: 'session-timing', ...session }, { savedRuns });
    runSignal.removeEventListener('abort', aborted);
  }
  if (endingError && !signal.aborted) throw endingError;
  if (exitCode) return exitCode;
  signal.throwIfAborted();
  return 0;
}
