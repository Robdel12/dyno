#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadConfig } from '../src/config.js';
import { buildSuite } from '../src/build.js';
import { startWebServer } from '../src/process.js';
import { createGateway } from '../src/server.js';
import { launchBrowser } from '../src/launcher.js';

let usage = `dyno [run] [--config path] [--ui | --manual] [--test "test name"] [--port number] [--host address] [--json]
dyno init

  run        Start the app, bundle tests, launch headless Chrome, and exit 0/1.
  --ui       Launch visible Chrome; keep the app and capture URL available for reruns.
  --manual   Print the capture URL; use your own browser or device, Ctrl-C to stop.
  --test     Run one test by its exact name.
  --json     Print structured lifecycle events instead of the concise reporter.

Tests execute in the browser. Chrome is only launched at the capture URL.
`;

async function main() {
  let { values, positionals } = parseArgs({ options: {
    config: { type: 'string', short: 'c' }, ui: { type: 'boolean' }, manual: { type: 'boolean' },
    port: { type: 'string' }, host: { type: 'string' }, test: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  }, allowPositionals: true });
  if (values.help) { console.log(usage); return; }
  if (positionals[0] === 'init') {
    let config = `export default {\n  testDir: 'tests/browser',\n  webServer: {\n    command: 'npm run dev',\n    url: 'http://127.0.0.1:3000',\n    reuseExistingServer: !process.env.CI\n  }\n};\n`;
    await writeFile('dyno.config.js', config, { flag: 'wx' });
    await mkdir('tests/browser', { recursive: true });
    await writeFile('tests/browser/home.test.js', `import { test } from 'dyno';\n\ntest('opens the application', async ({ app, I }) => {\n  await app.goto('/');\n  await I.find('Welcome').visible();\n});\n`, { flag: 'wx' });
    console.log('Created dyno.config.js and tests/browser/home.test.js. Set your app command/URL and update the example assertion, then run dyno.');
    return;
  }
  if (positionals.length > 1 || (positionals[0] && positionals[0] !== 'run')) throw new Error(usage);
  if (values.ui && values.manual) throw new Error('Choose --ui or --manual.');
  let config = await loadConfig(values.config);
  if (values.port !== undefined) { config.port = Number(values.port); if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('--port must be between 0 and 65535.'); }
  if (values.host) config.host = values.host;
  let bundle = await buildSuite(config);
  let controller = new AbortController();
  let stop = signal => controller.abort(new Error(`Stopped by ${signal}`));
  let interrupt = () => stop('SIGINT');
  let terminate = () => stop('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  let appServer;
  let gateway;
  let browser;
  let setup;
  let activeRun;
  let complete;
  let failed;
  let finished = new Promise((resolve, reject) => { complete = resolve; failed = reject; });
  // Install the rejection handler immediately, including during startup.
  finished.catch(() => {});
  let persistent = values.ui || values.manual;
  let report = event => {
    if (!activeRun && event.type === 'capture') activeRun = event.runId;
    if (values.json) console.log(JSON.stringify(event));
    else if (event.type === 'start') console.log(`\nRunning ${event.tests.length} browser tests`);
    else if (event.type === 'test') {
      console.log(`${event.status === 'passed' ? '✓' : '✗'} ${event.name}${event.duration === undefined ? '' : ` (${Math.round(event.duration)} ms)`}`);
      if (event.error) console.error(event.error.stack ?? event.error.message);
    } else if (event.type === 'complete') console.log(`\n${event.passed} passed, ${event.failed} failed (${Math.round(event.duration)} ms)`);
    if (event.runId === activeRun && !persistent) {
      if (event.type === 'complete') complete(event);
      if (event.type === 'fatal') failed(new Error(event.error?.message ?? 'Browser runtime failed.'));
    }
  };
  let aborted = () => failed(controller.signal.reason);
  controller.signal.addEventListener('abort', aborted, { once: true });
  let cleanups = [];
  try {
    if (config.setup) {
      let module = await import(pathToFileURL(config.setup).href);
      setup = await module.default({ config, signal: controller.signal });
      if (setup?.teardown) cleanups.push(setup.teardown);
    }
    controller.signal.throwIfAborted();
    gateway = await createGateway(config, bundle, { fixtures: setup?.fixtures, onEvent: report, rebuild: persistent ? () => buildSuite(config) : null });
    cleanups.push(() => gateway.close());
    appServer = await startWebServer({ ...config.webServer, env: { ...config.webServer.env, ...setup?.env, DYNO_URL: gateway.origin } }, {
      signal: controller.signal,
      output: message => { if (!values.json) process.stderr.write(`[app] ${message}`); }
    });
    cleanups.push(() => appServer.stop());
    let appExited = () => failed(appServer.failure ?? new Error('App server stopped.'));
    appServer.child?.once('exit', appExited);
    cleanups.push(async () => appServer.child?.removeListener('exit', appExited));
    let captureURL = new URL(gateway.url);
    if (values.test) captureURL.searchParams.set('test', values.test);
    console.log(values.json ? JSON.stringify({ type: 'ready', url: captureURL.href, appURL: config.webServer.url, files: bundle.files }) : `\nDyno: ${captureURL.href}\nApp: ${config.webServer.url}\n${bundle.files.length} test file(s) bundled`);
    if (config.host === '0.0.0.0' && !values.json) {
      for (let entries of Object.values(networkInterfaces())) for (let entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) console.log(`Device: ${gateway.url.replace('127.0.0.1', entry.address)}`);
      }
    }
    if (!values.manual) {
      browser = await launchBrowser(captureURL.href, { ...config.browser, headless: !values.ui, onExit: failed });
      cleanups.push(() => browser.stop());
    }
    let deadline = persistent ? null : AbortSignal.timeout(config.runTimeout);
    let expired = () => failed(new Error(`No complete browser result within ${config.runTimeout} ms. The browser may be disconnected, blocked, or stuck.`));
    deadline?.addEventListener('abort', expired, { once: true });
    try { let summary = await finished; process.exitCode = summary.failed ? 1 : 0; }
    finally { deadline?.removeEventListener('abort', expired); }
  } catch (error) {
    if (controller.signal.aborted) { process.exitCode = 130; }
    else throw error;
  } finally {
    for (let cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    controller.signal.removeEventListener('abort', aborted);
  }
}

try { await main(); }
catch (error) { console.error(`dyno: ${error.message}`); process.exitCode = 1; }
