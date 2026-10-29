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
  for (let key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} option: ${key}.`);
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
      'reportDir'
    ],
    'config'
  );
  if (input.forbidOnly !== undefined && typeof input.forbidOnly !== 'boolean')
    throw new Error('forbidOnly must be a boolean.');
  let root = dirname(file);
  let webServer = input.webServer;
  keys(webServer, ['url', 'command', 'cwd', 'env', 'ready', 'timeout', 'reuseExistingServer'], 'webServer');
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
  if (webServer.ready !== undefined && !text(webServer.ready) && !(webServer.ready instanceof RegExp))
    throw new Error('webServer.ready must be a non-empty string or RegExp.');
  if (webServer.reuseExistingServer !== undefined && typeof webServer.reuseExistingServer !== 'boolean')
    throw new Error('webServer.reuseExistingServer must be a boolean.');
  for (let key of ['testDir', 'testMatch', 'setup'])
    if (input[key] !== undefined && !text(input[key])) throw new Error(`${key} must be a non-empty string.`);
  if (webServer.cwd !== undefined && !text(webServer.cwd)) throw new Error('webServer.cwd must be a non-empty string.');
  if (webServer.env !== undefined) {
    if (!record(webServer.env) || Object.values(webServer.env).some((value) => typeof value !== 'string'))
      throw new Error('webServer.env must contain string values.');
  }
  let browser = input.browser ?? {};
  keys(browser, ['name', 'path', 'args', 'provider', 'deviceScaleFactor'], 'browser');
  let provider = overrides.provider ?? browser.provider ?? 'native';
  if (!['native', 'playwright', 'webdriver'].includes(provider))
    throw new Error('browser.provider must be native, playwright, or webdriver.');
  let name = overrides.browser ?? browser.name ?? 'chrome';
  if (!browserNames.includes(name)) throw new Error(`Unknown browser "${name}". Choose ${browserNames.join(', ')}.`);
  if (name === 'webkit' && provider !== 'playwright')
    throw new Error('WebKit requires browser.provider: "playwright". Safari is a separate browser.');
  if (name === 'safari' && provider === 'playwright')
    throw new Error('Playwright cannot launch Safari. Choose webkit or the webdriver provider.');
  if (
    browser.deviceScaleFactor !== undefined &&
    (provider !== 'playwright' || ![1, 2, 3].includes(browser.deviceScaleFactor))
  )
    throw new Error('browser.deviceScaleFactor requires Playwright and must be 1, 2, or 3.');
  let viewport = null;
  if (input.viewport !== undefined) {
    keys(input.viewport, ['width', 'height'], 'viewport');
    viewport = normalizeViewport(input.viewport);
  }
  if (input.reportDir !== undefined && !text(input.reportDir)) throw new Error('reportDir must be a non-empty path.');
  if (input.artifactsDir !== undefined && !text(input.artifactsDir))
    throw new Error('artifactsDir must be a non-empty path.');
  let path = overrides.browserPath ?? browser.path;
  if (path !== undefined && !text(path)) throw new Error('browser.path must be a non-empty executable path.');
  if (
    browser.args !== undefined &&
    (!Array.isArray(browser.args) || browser.args.some((arg) => typeof arg !== 'string'))
  )
    throw new Error('browser.args must be an array of strings.');
  if (
    browser.args?.some((arg) =>
      /^(--?(user-data-dir|profile|profilemanager|no-remote|new-instance)|-P)(=|$)/i.test(arg)
    )
  )
    throw new Error('Dyno owns the browser profile. Remove profile and instance flags from browser.args.');
  let config = {
    root,
    file,
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
      provider,
      ...(path ? { path } : {}),
      ...(browser.deviceScaleFactor ? { deviceScaleFactor: browser.deviceScaleFactor } : {}),
      args: Object.freeze([...(browser.args ?? [])])
    }),
    viewport,
    reportDir: resolve(root, overrides.reportDir ?? input.reportDir ?? '.dyno/reports'),
    artifactsDir: resolve(root, input.artifactsDir ?? '.dyno/artifacts'),
    webServer: Object.freeze({
      ...webServer,
      url: url.origin,
      cwd: resolve(root, webServer.cwd ?? '.'),
      timeout: webServer.timeout ?? 30000,
      ...(Array.isArray(webServer.command) ? { command: Object.freeze([...webServer.command]) } : {}),
      env: Object.freeze({ ...webServer.env })
    }),
    setup: input.setup ? (isAbsolute(input.setup) ? input.setup : resolve(root, input.setup)) : null
  };
  for (let [key, value] of Object.entries({
    timeout: config.timeout,
    cleanupTimeout: config.cleanupTimeout,
    expectTimeout: config.expectTimeout,
    runTimeout: config.runTimeout,
    'webServer.timeout': config.webServer.timeout
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
