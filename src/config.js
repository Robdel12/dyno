/**
 * @api defineConfig
 * Get type hints for your Node config. Paths resolve relative to the config file. A plain default-exported object works too.
 */

/**
 * @api Config
 * Set your app server and test-run options. Start with the app URL and, if Dyno should start it, a command. The configuration guide lists defaults and setup examples.
 */

/**
 * @guide configuration Configure your project
 * Start with your app's command and URL. Paths are relative to `dyno.config.js`.
 *
 * ```js
 * import { defineConfig } from 'dyno/config';
 *
 * export default defineConfig({
 *   testDir: 'tests/browser',
 *   webServer: {
 *     command: 'npm run dev',
 *     url: 'http://127.0.0.1:3000',
 *   },
 * });
 * ```
 *
 * Dyno gives each test 10 seconds, including hooks and document startup. Interactor assertions get up to 2 seconds. Change `timeout` or `expectTimeout` when the workflow needs it; use [timings](guide.md#understand-where-time-goes) to find out why.
 *
 * <details>
 * <summary>All options and defaults</summary>
 *
 * | Option | Default | Purpose |
 * | --- | --- | --- |
 * | `testDir` | `tests/browser` | Test directory |
 * | `testMatch` | `**\/*.test.{js,jsx,ts,tsx}` | File pattern |
 * | `timeout` | `10000` | Test deadline, including runtime startup and hooks |
 * | `cleanupTimeout` | `5000` | Total budget for cleanup after execution ends |
 * | `expectTimeout` | `min(2000, timeout / 2)`, rounded down | Interactor assertion timeout |
 * | `runTimeout` | `60000` | Headless browser opening and results deadline, after app readiness |
 * | `host`, `port` | `127.0.0.1`, `7357` | Gateway address; port 0 chooses a free port |
 * | `browser.name`, `path`, `args` | `chromium`, Playwright build, `[]` | Managed target, optional executable, and launch arguments |
 * | `browser.deviceScaleFactor` | `1` | Playwright pixel ratio from 1 to 3 |
 * | `browser.isMobile`, `browser.hasTouch` | `false` | Emulate mobile viewport behavior and touch input |
 * | `browser.userAgent` | Browser default | Override the managed browser user agent |
 * | `viewport` | Browser size; managed: 1280 × 800 | Required app viewport dimensions |
 * | `reportDir` | `.dyno/reports` | Saved JSON, JUnit, HTML, and copied images per browser run |
 * | `artifactsDir` | `.dyno/artifacts` | PNG output directory |
 * | `webServer.url` | Required | HTTP(S) origin without a path |
 * | `webServer.command` | None | App startup command |
 * | `webServer.cwd`, `env` | Config directory, inherited env | App process settings |
 * | `webServer.ready` | Any process output | Ready-message string or RegExp |
 * | `webServer.timeout` | `30000` | App startup deadline |
 * | `webServer.reuseExistingServer` | `false` | Reuse a responding server |
 * | `setup` | None | Node setup module |
 * | `seed`, `random` | None, `false` | Repeatable randomized priority or a generated seed |
 * | `workers` | `1` | Managed worker count, from 1 to 32; concurrent runs need project worker setup |
 * | `forbidOnly` | Whether `CI` is set | Reject focused test/suite definitions |
 *
 * </details>
 *
 * ## Set up real app data
 *
 * Point `setup` at a Node module. Its async default export receives `{ config, session, signal, onCleanup }` and returns the resources your tests need:
 *
 * ```js
 * import { startTestProject } from './support/project.js';
 *
 * export default async function setup({ session, signal, onCleanup }) {
 *   return startTestProject({ session, signal, onCleanup });
 * }
 * ```
 *
 * `startTestProject` is your helper. Return `webServer` overrides, app `env`, JSON-safe `fixtures` for tests, and a `teardown` function. Keep credentials out of browser fixtures. Register owned releases with `onCleanup` as resources are acquired. They run even if setup throws before returning. Setup messages go to stderr.
 *
 * Use project factories to create committed records and real sessions. Return the IDs and paths a scenario needs, then exercise the behavior through the app. Share immutable fixture inputs rather than mutable records. For concurrent runs, [give each worker its own resources](guide.md#concurrent-runs).
 *
 * Use [named app fixtures](guide.md#named-app-fixtures) to call your real factories through `app.fixture`. Keep that test control outside production entrypoints. Operations receive explicit app dependencies; Dyno handles execution ownership and transport, while your app owns factories, auth, queues and visual comparison.
 *
 * ## Finish work before reusing resources
 *
 * A fresh page doesn't stop server writes, background jobs, or service workers. Return `drain` when your project needs to join that work between tests. Close admission for the old scenario, release any held requests, and leave its resources ready for reuse.
 *
 * Between tests Dyno retires the old document, then calls `drain({ runId, executionId, workerId, test, signal })`. It runs once per non-skipped execution, including the last one before results are saved. The final successful document can remain for inspection, so its backend admission still needs to close during drain. Its duration appears in session timings.
 *
 * Keep draining within `cleanupTimeout` and honor its signal. A failure ends the session and saves accepted results; remaining tests stay unassigned. Callbacks must honor cancellation. Dyno retains their original promises until settlement before resource destruction; uncooperative Node work can delay shutdown. Make teardown safe after a drain failure.
 *
 * Setup owns CLI-session resources, worker setup owns private resources, and optional `beforeExecution` resets or binds each scenario before browser hooks. Preparation uses the selected test timeout, leaving the remaining budget for browser work. Timings distinguish preparation from execution cleanup. For a multi-process app, use one project command to start the real stack and handle shutdown.
 */

import { access } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserNames } from './browsers.js';
import { normalizeViewport } from './browser/viewport.js';

export function defineConfig(config) {
  return config;
}
let text = (value) => typeof value === 'string' && value.trim().length > 0;
let record = (value) => value && typeof value === 'object' && !Array.isArray(value);
function keys(input, allowed, label) {
  if (!record(input)) throw new Error(`${label} must be an object.`);
  for (let key of Object.keys(input))
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} option: ${key}.`);
}

export function normalizeConfig(input, file, overrides = {}) {
  keys(
    input,
    [
      'testDir',
      'testMatch',
      'timeout',
      'runTimeout',
      'expectTimeout',
      'host',
      'port',
      'browser',
      'viewport',
      'artifactsDir',
      'webServer',
      'setup',
      'forbidOnly',
      'cleanupTimeout',
      'reportDir',
      'seed',
      'random',
      'workers',
    ],
    'config',
  );
  if (input.random !== undefined && typeof input.random !== 'boolean') throw new Error('random must be a boolean.');
  if (input.seed !== undefined && (typeof input.seed !== 'string' || !input.seed.trim() || input.seed.length > 256))
    throw new Error('seed must be a non-empty string of at most 256 characters.');
  if (input.forbidOnly !== undefined && typeof input.forbidOnly !== 'boolean')
    throw new Error('forbidOnly must be a boolean.');
  let root = dirname(file);
  let webServer = input.webServer;
  keys(
    webServer,
    ['url', 'command', 'cwd', 'env', 'ready', 'timeout', 'reuseExistingServer'],
    'webServer',
  );
  if (!text(webServer.url)) throw new Error('webServer.url is required.');
  let url = new URL(webServer.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('webServer.url must be an HTTP(S) origin, for example http://127.0.0.1:3000.');
  if (
    webServer.command !== undefined &&
    !(
      text(webServer.command) ||
      (Array.isArray(webServer.command) &&
        webServer.command.length &&
        webServer.command.every((arg) => typeof arg === 'string') &&
        text(webServer.command[0]))
    )
  )
    throw new Error('webServer.command must be a non-empty shell string or argv array.');
  if (
    webServer.ready !== undefined &&
    !text(webServer.ready) &&
    !(webServer.ready instanceof RegExp)
  )
    throw new Error('webServer.ready must be a non-empty string or RegExp.');
  if (
    webServer.reuseExistingServer !== undefined &&
    typeof webServer.reuseExistingServer !== 'boolean'
  )
    throw new Error('webServer.reuseExistingServer must be a boolean.');
  for (let key of ['testDir', 'testMatch', 'setup'])
    if (input[key] !== undefined && !text(input[key]))
      throw new Error(`${key} must be a non-empty string.`);
  if (webServer.cwd !== undefined && !text(webServer.cwd))
    throw new Error('webServer.cwd must be a non-empty string.');
  if (webServer.env !== undefined) {
    if (
      !record(webServer.env) ||
      Object.values(webServer.env).some((value) => typeof value !== 'string')
    )
      throw new Error('webServer.env must contain string values.');
  }
  let browser = input.browser ?? {};
  keys(
    browser,
    [
      'name',
      'path',
      'args',
      'deviceScaleFactor',
      'locale',
      'timezoneId',
      'isMobile',
      'hasTouch',
      'userAgent',
    ],
    'browser',
  );
  let name = overrides.browser ?? browser.name ?? 'chromium';
  if (!browserNames.includes(name))
    throw new Error(
      `Unknown managed browser "${name}". Choose ${browserNames.join(', ')} or use --manual for other browsers.`,
    );
  if (
    browser.deviceScaleFactor !== undefined &&
    (!Number.isFinite(browser.deviceScaleFactor) ||
      browser.deviceScaleFactor < 1 ||
      browser.deviceScaleFactor > 3)
  )
    throw new Error('browser.deviceScaleFactor must be a finite number from 1 to 3.');
  for (let key of ['isMobile', 'hasTouch'])
    if (browser[key] !== undefined && typeof browser[key] !== 'boolean')
      throw new Error(`browser.${key} must be a boolean.`);
  if (browser.isMobile === true && name === 'firefox')
    throw new Error('browser.isMobile is not supported with Firefox.');
  if (
    browser.userAgent !== undefined &&
    (!text(browser.userAgent) ||
      browser.userAgent.length > 1000 ||
      /[\r\n]/.test(browser.userAgent))
  )
    throw new Error(
      'browser.userAgent must be a non-empty string of at most 1000 characters without line breaks.',
    );
  if (browser.locale !== undefined) {
    try {
      if (!text(browser.locale)) throw new Error();
      Intl.getCanonicalLocales(browser.locale);
    } catch {
      throw new Error('browser.locale must be a valid locale, such as en-US.');
    }
  }
  if (browser.timezoneId !== undefined) {
    try {
      if (!text(browser.timezoneId)) throw new Error();
      new Intl.DateTimeFormat('en', { timeZone: browser.timezoneId });
    } catch {
      throw new Error('browser.timezoneId must be a valid time zone, such as UTC.');
    }
  }
  let viewport = null;
  if (input.viewport !== undefined) {
    keys(input.viewport, ['width', 'height'], 'viewport');
    viewport = normalizeViewport(input.viewport);
  }
  if (input.reportDir !== undefined && !text(input.reportDir))
    throw new Error('reportDir must be a non-empty path.');
  if (input.artifactsDir !== undefined && !text(input.artifactsDir))
    throw new Error('artifactsDir must be a non-empty path.');
  let path = overrides.browserPath ?? browser.path;
  if (path !== undefined && !text(path))
    throw new Error('browser.path must be a non-empty executable path.');
  if (
    browser.args !== undefined &&
    (!Array.isArray(browser.args) || browser.args.some((arg) => typeof arg !== 'string'))
  )
    throw new Error('browser.args must be an array of strings.');
  if (
    browser.args?.some((arg) =>
      /^(--?(user-data-dir|profile|profilemanager|no-remote|new-instance)|-P)(=|$)/i.test(arg),
    )
  )
    throw new Error(
      'Dyno owns the browser profile. Remove profile and instance flags from browser.args.',
    );
  let config = {
    root,
    file,
    workers: overrides.workers ?? input.workers ?? 1,
    seed: overrides.random ? null : overrides.seed ?? input.seed ?? null,
    random: overrides.random ?? input.random ?? false,
    forbidOnly: input.forbidOnly ?? Boolean(process.env.CI),
    testDir: resolve(root, input.testDir ?? 'tests/browser'),
    testMatch: input.testMatch ?? '**/*.test.{js,jsx,ts,tsx}',
    timeout: input.timeout ?? 10000,
    cleanupTimeout: input.cleanupTimeout ?? 5000,
    runTimeout: input.runTimeout ?? 60000,
    expectTimeout: input.expectTimeout ?? Math.min(2000, Math.floor((input.timeout ?? 10000) / 2)),
    port: overrides.port ?? input.port ?? 7357,
    host: overrides.host ?? input.host ?? '127.0.0.1',
    browser: Object.freeze({
      name,
      ...(path ? { path } : {}),
      ...(browser.deviceScaleFactor !== undefined
        ? { deviceScaleFactor: browser.deviceScaleFactor }
        : {}),
      ...(browser.locale ? { locale: browser.locale } : {}),
      ...(browser.timezoneId ? { timezoneId: browser.timezoneId } : {}),
      ...(browser.isMobile !== undefined ? { isMobile: browser.isMobile } : {}),
      ...(browser.hasTouch !== undefined ? { hasTouch: browser.hasTouch } : {}),
      ...(browser.userAgent !== undefined ? { userAgent: browser.userAgent } : {}),
      args: Object.freeze([...(browser.args ?? [])]),
    }),
    viewport,
    reportDir: resolve(root, overrides.reportDir ?? input.reportDir ?? '.dyno/reports'),
    artifactsDir: resolve(root, input.artifactsDir ?? '.dyno/artifacts'),
    webServer: Object.freeze({
      ...webServer,
      url: url.origin,
      cwd: resolve(root, webServer.cwd ?? '.'),
      timeout: webServer.timeout ?? 30000,
      ...(Array.isArray(webServer.command)
        ? { command: Object.freeze([...webServer.command]) }
        : {}),
      env: Object.freeze({ ...webServer.env }),
    }),
    setup: input.setup
      ? isAbsolute(input.setup)
        ? input.setup
        : resolve(root, input.setup)
      : null,
  };
  if (config.seed !== null && (typeof config.seed !== 'string' || !config.seed.trim() || config.seed.length > 256))
    throw new Error('seed must be a non-empty string of at most 256 characters.');
  if (!Number.isSafeInteger(config.workers) || config.workers < 1 || config.workers > 32)
    throw new Error('workers must be a whole number between 1 and 32.');
  for (let [key, value] of Object.entries({
    timeout: config.timeout,
    cleanupTimeout: config.cleanupTimeout,
    expectTimeout: config.expectTimeout,
    runTimeout: config.runTimeout,
    'webServer.timeout': config.webServer.timeout,
  })) {
    if (!Number.isInteger(value) || value <= 0 || value > 2147483647)
      throw new Error(`${key} must be a positive integer in milliseconds, at most 2147483647.`);
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)
    throw new Error('port must be between 0 and 65535.');
  if (!text(config.host) || /[\s/\\?#]/.test(config.host))
    throw new Error('host must be a hostname or IP address without a scheme or path.');
  return Object.freeze(config);
}

export async function loadConfig(path = 'dyno.config.js', overrides = {}) {
  let file = resolve(path);
  try {
    await access(file);
  } catch {
    throw new Error(`Config not found: ${file}. Run dyno init first.`);
  }
  // User-selected configuration is loaded at the filesystem boundary.
  let { default: input } = await import(pathToFileURL(file).href);
  return normalizeConfig(input, file, overrides);
}
