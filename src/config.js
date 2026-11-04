/**
 * Define typed Node configuration. Paths resolve relative to the config file. A plain default-exported object works too; this helper gives JavaScript editors the same type hints.
 *
 * @api defineConfig
 */

/**
 * The project configuration. Supply a web-server origin and optionally its startup command. The configuration guide lists defaults, setup ownership and CLI overrides.
 *
 * @api Config
 */

/**
 * Paths are relative to the config file unless noted. See `dyno --help` for CLI overrides and [browser setup](browsers.md) for executable selection.
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
 * | `browser.deviceScaleFactor` | `1` | Playwright pixel ratio: 1, 2, or 3 |
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
 * ### Node setup
 *
 * The setup module exports an async function receiving `{ config, signal }`. Return `{ webServer, env, fixtures, drain, teardown }`: `webServer` can override the app configuration, `env` adds app environment values, `fixtures` provides JSON-safe browser data, and `teardown` releases the setup. Optional `drain` joins work between executions. Honor the signal during long work, and keep production secrets out of browser fixtures. Console messages go to stderr. If setup throws before returning, it must clean up resources it already created.
 *
 * Optional `drain({ runId, executionId, workerId, test, signal })` joins the project work an execution started. Before another test body, Dyno first removes the old runtime and app document, preserving the controller and browser storage. It then awaits `drain`. The callback also runs for the last non-skipped execution before terminal persistence, if it has not already drained; skipped tests do not invoke it. Each non-skipped execution drains once. Its named duration is included in CLI session timings. Honor the signal and keep this callback within `cleanupTimeout`. A failure or deadline ends the session, saves accepted results and leaves remaining tests unassigned.
 *
 * Keep scenario setup in project-owned factories: create fresh committed records, establish a real session and return only the IDs and paths the test needs. Exercise the UI, API or job itself when that behavior is under test. Reuse immutable fixture inputs rather than shared mutable records.
 *
 * Setup owns run-wide resources; `createWorker` owns private app resources; suite hooks prepare each scenario. Browser tests cannot import Node factories. When a scenario needs Node work, expose a finite, authenticated test-only API in your app server and call it through `app.request`; keep those endpoints out of the production server. There is no built-in Node task API.
 *
 * For apps with an API, web server and background workers, use one project command that starts the real stack and handles shutdown. Use real application states, held requests or external HTTP fixtures for failure paths. Keep map/image readiness in project Interactors, and publish captured PNGs to your visual service from Node. Dyno doesn't replace your factory, auth, queue or visual-comparison libraries.
 *
 * Navigation does not cancel server writes or service workers. Your project must close old admission, release fixture gates, join its requests/jobs and return resources ready for reuse. Keep database, queues, storage and session policy in the app. Use `teardown` to release the entire setup, including after failed draining.
 *
 * `cleanupTimeout` bounds Dyno's wait. A callback that ignores its signal can keep running in Node, so drains must stop touching project resources when aborted, and teardown must be safe after a drain timeout.
 *
 * @guide configuration Configuration
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
  keys(browser, ['name', 'path', 'args', 'deviceScaleFactor', 'locale', 'timezoneId'], 'browser');
  let name = overrides.browser ?? browser.name ?? 'chromium';
  if (!browserNames.includes(name))
    throw new Error(
      `Unknown managed browser "${name}". Choose ${browserNames.join(', ')} or use --manual for other browsers.`,
    );
  if (browser.deviceScaleFactor !== undefined && ![1, 2, 3].includes(browser.deviceScaleFactor))
    throw new Error('browser.deviceScaleFactor must be 1, 2, or 3.');
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
      ...(browser.deviceScaleFactor ? { deviceScaleFactor: browser.deviceScaleFactor } : {}),
      ...(browser.locale ? { locale: browser.locale } : {}),
      ...(browser.timezoneId ? { timezoneId: browser.timezoneId } : {}),
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
