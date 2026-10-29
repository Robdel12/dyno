#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import metadata from '../package.json' with { type: 'json' };
import { parseCLI, usage } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import { buildSuite } from '../src/build.js';
import { startProcess, startWebServer } from '../src/process.js';
import { createGateway } from '../src/server.js';
import { installedBrowsers } from '../src/launcher.js';
import { resolveSession, createBrowserSession } from '../src/browser-session.js';
import { createCleanup } from '../src/cleanup.js';
import { defaultViewport } from '../src/browser/viewport.js';
import { testTitle } from '../src/suite.js';
import { createTestWatcher, createWatchState, watchTransition } from '../src/watch.js';
import { diagnose } from '../src/doctor.js';
import { initializeProject } from '../src/init.js';

let json = process.argv.slice(2).includes('--json');
let outputClosed = false;
let emit = (event) => {
  if (!outputClosed) process.stdout.write(JSON.stringify(event) + '\n');
};
let log = (message) => process.stderr.write(message + '\n');

async function main() {
  let options = parseCLI(process.argv.slice(2));
  if (options.help) {
    json ? emit({ type: 'help', text: usage }) : console.log(usage);
    return;
  }
  if (options.version) {
    json ? emit({ type: 'version', version: metadata.version }) : console.log(metadata.version);
    return;
  }
  if (options.command === 'install') {
    if (options.provider && options.provider !== 'playwright')
      throw new Error(
        'dyno install downloads Playwright engine builds. WebDriver uses installed browsers and resolves their matching drivers.'
      );
    let name = options.browser ?? 'chromium';
    if (!['chromium', 'firefox', 'webkit'].includes(name))
      throw new Error('Choose chromium, firefox, or webkit. Install branded browsers through their vendor.');
    let executable;
    try {
      executable = fileURLToPath(import.meta.resolve('playwright-core/cli'));
    } catch {
      throw new Error('Install the optional provider first: npm install --save-dev playwright-core');
    }
    let installation = startProcess(process.execPath, {
      shell: false,
      args: [executable, 'install', name],
      output: (message) => process.stderr.write(message)
    });
    try {
      await installation.ready;
      let result = await installation.closed;
      if (result.code !== 0) throw new Error(`Browser installation failed: ${installation.logs}`);
    } finally {
      await installation.stop();
    }
    if (json) emit({ type: 'installed', provider: 'playwright', browser: name });
    return;
  }
  if (options.command === 'browsers') {
    let browsers = await installedBrowsers();
    if (json) emit({ type: 'browsers', browsers });
    else
      for (let browser of browsers)
        console.log(
          `${browser.name.padEnd(10)} ${browser.installed ? browser.path : 'not installed'}${browser.name === 'safari' ? ' (headed handoff; shared profile)' : ''}`
        );
    return;
  }
  if (options.command === 'init') {
    await initializeProject(process.cwd());
    let message =
      'Created dyno.config.js and tests/browser/home.test.js. Set your app command/URL and update the example assertion, then run dyno.';
    json ? emit({ type: 'initialized', message }) : console.log(message);
    return;
  }
  let config = await loadConfig(options.config, {
    port: options.port === undefined ? undefined : Number(options.port),
    host: options.host,
    browser: options.browser,
    browserPath: options['browser-path'],
    provider: options.provider
  });
  if (options.command === 'doctor') {
    let result = await diagnose(config, { manual: options.manual });
    if (json) emit({ type: 'diagnosis', ...result });
    else
      for (let check of result.checks)
        console.log(
          `${check.status === 'passed' ? '✓' : check.status === 'failed' ? '✗' : '−'} ${check.name}: ${check.message}`
        );
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  let browserPlan = options.manual ? null : await resolveSession(config.browser, { headless: !options.ui });
  let controller = new AbortController();
  let interruptCode;
  let stop = (name, code) => {
    interruptCode ??= code;
    controller.abort(new Error(`Stopped by ${name}`));
  };
  let interrupt = () => stop('SIGINT', 130);
  let terminate = () => stop('SIGTERM', 143);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  let cleanups = createCleanup();
  let { promise: finished, resolve: complete, reject: failed } = Promise.withResolvers();
  finished.catch(() => {});
  let activeRun;
  let watcher, gateway;
  let watching = createWatchState();
  let watchEvent = (event) => {
    if (json) emit({ type: 'watch', ...event });
    else log(`Watch: ${event.message ?? event.status}`);
    if (activeRun) gateway?.notify(activeRun, 'watch', event);
  };
  let rebuildWatch = async () => {
    if (
      !watcher ||
      watching.run !== 'idle' ||
      watching.build !== 'idle' ||
      watching.revision === watching.published ||
      controller.signal.aborted
    )
      return;
    watching = watchTransition(watching, { type: 'building' });
    let attempted = watching.revision;
    try {
      do {
        let revision = watching.revision;
        attempted = revision;
        watchEvent({ status: 'building', revision });
        let updated = await buildSuite(config);
        controller.signal.throwIfAborted();
        watcher.track(updated.inputs);
        watching = watchTransition(watching, { type: 'built', revision });
        if (watching.revision !== revision) watching = watchTransition(watching, { type: 'building' });
      } while (watching.build === 'building');
      if (controller.signal.aborted) return;
      if (watching.run === 'running') {
        watchEvent({ status: 'queued', message: 'Test edits queued until this run finishes.' });
        return;
      }
      watching = watchTransition(watching, { type: 'scheduled', revision: attempted });
      if (activeRun) {
        watching = watchTransition(watching, { type: 'running' });
        gateway.reload(activeRun);
      }
      watchEvent({
        status: 'watching',
        message: activeRun ? 'Running updated tests' : 'Tests updated. Open the test browser URL.'
      });
    } catch (error) {
      watching = watchTransition(watching, { type: 'failed', revision: attempted });
      watchEvent({ status: 'error', message: error.message });
      void rebuildWatch();
    }
  };
  let launchKey;
  let reporterAddress;
  let persistent = options.ui || options.manual || options.watch;
  let report = (event) => {
    if (event.type === 'capture')
      event = { ...event, reporterURL: `${reporterAddress}?run=${encodeURIComponent(event.runId)}` };
    if (event.type === 'capture' && (event.owned || event.previousRunId === activeRun || (!browserPlan && !activeRun)))
      activeRun = event.runId;
    if (options.watch && event.runId === activeRun) {
      if (event.type === 'capture') watching = watchTransition(watching, { type: 'running' });
      if (['complete', 'fatal'].includes(event.type)) {
        watching = watchTransition(watching, { type: 'finished' });
        void rebuildWatch();
      }
    }
    if (json) emit(event);
    else if (event.type === 'capture' && persistent) console.log(`Reporter: ${event.reporterURL}`);
    else if (event.type === 'start') console.log(`\nRunning ${event.tests.length} browser tests`);
    else if (event.type === 'test') {
      console.log(
        `${event.status === 'passed' ? '✓' : event.status === 'skipped' ? '−' : '✗'} ${testTitle(event)}${event.duration === undefined ? '' : ` (${Math.round(event.duration)} ms)`}`
      );
      for (let error of [event.error, ...(event.additionalErrors ?? [])].filter(Boolean))
        log(`[${error.phase ?? 'test'}] ${error.stack ?? error.message}`);
    } else if (event.type === 'attachment')
      console.log(
        event.attachment.status === 'captured'
          ? `Screenshot: ${event.attachment.path}`
          : `Image skipped: ${event.attachment.name} (${event.attachment.reason})`
      );
    else if (event.type === 'complete')
      console.log(
        `\n${event.passed} passed, ${event.failed} failed, ${event.skipped} skipped (${Math.round(event.duration)} ms)`
      );
    else if (event.type === 'fatal') log(`Browser run failed: ${event.error?.message ?? 'Unknown error'}`);
    if (event.runId === activeRun && !persistent) {
      if (event.type === 'complete') complete(event);
      if (event.type === 'fatal') failed(new Error(event.error?.message ?? 'Browser runtime failed.'));
    }
  };
  let aborted = () => failed(controller.signal.reason);
  controller.signal.addEventListener('abort', aborted, { once: true });
  try {
    let bundle = await buildSuite(config);
    controller.signal.throwIfAborted();
    let browser = browserPlan
      ? await createBrowserSession(browserPlan, {
          viewport: config.viewport ?? defaultViewport,
          signal: controller.signal,
          onExit: failed
        })
      : null;
    if (browser) cleanups.add(browser.stop);
    launchKey = browser ? randomUUID() : null;
    let setup;
    if (config.setup) {
      let module = await import(pathToFileURL(config.setup).href);
      if (typeof module.default !== 'function') throw new Error('setup must export a function.');
      setup = await module.default({ config, signal: controller.signal });
      if (typeof setup?.teardown === 'function') cleanups.add(setup.teardown);
    }
    controller.signal.throwIfAborted();
    gateway = await createGateway(config, bundle, {
      fixtures: setup?.fixtures,
      interactive: Boolean(options.ui || options.manual),
      onEvent: report,
      rebuild: persistent ? () => buildSuite(config) : null
    });
    cleanups.add(() => gateway.close());
    if (options.watch) {
      watcher = createTestWatcher({
        root: config.root,
        testDir: config.testDir,
        onError: (error) => {
          watchEvent({ status: 'error', message: error.message });
          failed(error);
        },
        onChange: () => {
          watching = watchTransition(watching, { type: 'changed' });
          watchEvent({
            status: watching.run === 'running' ? 'queued' : 'changed',
            revision: watching.revision,
            message: watching.run === 'running' ? 'Test edits queued until this run finishes.' : 'Test files changed.'
          });
          void rebuildWatch();
        }
      });
      cleanups.add(() => watcher.close());
      watcher.track(bundle.inputs);
      watchEvent({ status: 'watching', message: 'Watching tests and imported project helpers.' });
    }
    reporterAddress = gateway.origin + '/__dyno__/reporter';
    if (browser) gateway.attachSession(browser, launchKey);
    let appServer = await startWebServer(
      { ...config.webServer, env: { ...config.webServer.env, ...setup?.env, DYNO_URL: gateway.origin } },
      {
        signal: controller.signal,
        output: (message) => process.stderr.write(`[app] ${message}`)
      }
    );
    cleanups.add(() => appServer.stop());
    let appExited = () => failed(appServer.failure ?? new Error('App server stopped.'));
    appServer.child?.once('exit', appExited);
    cleanups.add(async () => appServer.child?.removeListener('exit', appExited));
    if (appServer.failure) throw appServer.failure;
    controller.signal.throwIfAborted();
    let captureURL = new URL(gateway.url);
    if (options.test) captureURL.searchParams.set('test', options.test);
    for (let key of ['id', 'file', 'suite'])
      for (let value of options[key] ?? []) captureURL.searchParams.append(key, value);
    let browserInfo = browserPlan
      ? { ...browser.identity, path: browserPlan.path, isolated: browserPlan.isolated }
      : null;
    json
      ? emit({
          type: 'ready',
          url: captureURL.href,
          appURL: config.webServer.url,
          files: bundle.files,
          browser: browserInfo
        })
      : console.log(
          `\nDyno: ${captureURL.href}\nApp: ${config.webServer.url}\n${bundle.files.length} test file(s) bundled`
        );
    if (!browserPlan?.isolated && browserPlan)
      log('Safari opens in your existing browser session. Its tabs and storage remain yours to manage.');
    if (['0.0.0.0', '::'].includes(config.host) && !json) {
      for (let entries of Object.values(networkInterfaces()))
        for (let entry of entries ?? []) {
          if (!entry.internal && entry.family === 'IPv4')
            console.log(`Device: ${gateway.url.replace(/127\.0\.0\.1|\[::1\]/, entry.address)}`);
        }
    }
    let deadline = persistent ? null : AbortSignal.timeout(config.runTimeout);
    let expired = () => {
      let message = `No complete browser result within ${config.runTimeout} ms. The browser may be disconnected, blocked, or stuck.`;
      let output = browser?.logs?.trim();
      failed(new Error(output ? `${message}\nBrowser output:\n${output}` : message));
    };
    deadline?.addEventListener('abort', expired, { once: true });
    try {
      if (browserPlan) {
        let ownedURL = new URL(captureURL);
        ownedURL.hash = new URLSearchParams({ launch: launchKey }).toString();
        await browser.open(ownedURL.href);
      }
      let summary = await finished;
      process.exitCode = summary.failed ? 1 : 0;
    } finally {
      deadline?.removeEventListener('abort', expired);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      process.exitCode = interruptCode;
      if (json) emit({ type: 'stopped', signal: interruptCode === 130 ? 'SIGINT' : 'SIGTERM' });
    } else {
      let failure = error instanceof Error ? error : new Error(error?.message ?? String(error));
      if (launchKey) failure.message = failure.message.replaceAll(launchKey, '[private launch]');
      throw failure;
    }
  } finally {
    controller.abort(new Error('Dyno is shutting down.'));
    for (let error of await cleanups.run()) {
      json
        ? emit({ type: 'error', phase: 'cleanup', message: error.message })
        : log(`Cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    controller.signal.removeEventListener('abort', aborted);
  }
}

// A closed stdout pipe is a normal CLI consumer disconnect, not an uncaught error.
process.stdout.on('error', (error) => {
  if (error.code !== 'EPIPE') throw error;
  if (outputClosed) return;
  outputClosed = true;
  process.kill(process.pid, 'SIGTERM');
});
try {
  await main();
} catch (error) {
  if (json) emit({ type: 'error', message: error.message });
  log(`dyno: ${error.message}`);
  process.exitCode = 1;
}
