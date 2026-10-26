import { access } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function defineConfig(config) { return config; }

export function normalizeConfig(input, file, overrides = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Config must export a configuration object.');
  let root = dirname(file);
  let webServer = input.webServer;
  if (!webServer?.url) throw new Error('webServer.url is required.');
  let url = new URL(webServer.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('webServer.url must be an HTTP(S) origin, for example http://127.0.0.1:3000.');
  if (webServer.command !== undefined && !(typeof webServer.command === 'string' || (Array.isArray(webServer.command) && webServer.command.length && webServer.command.every(arg => typeof arg === 'string')))) throw new Error('webServer.command must be a shell string or an argv array.');
  if (webServer.ready !== undefined && typeof webServer.ready !== 'string' && !(webServer.ready instanceof RegExp)) throw new Error('webServer.ready must be a string or RegExp.');
  let browser = input.browser ?? {};
  if (browser.args !== undefined && (!Array.isArray(browser.args) || browser.args.some(arg => typeof arg !== 'string'))) throw new Error('browser.args must be an array of strings.');
  let config = {
    root, file, testDir: resolve(root, input.testDir ?? 'tests/browser'),
    testMatch: input.testMatch ?? '**/*.test.{js,jsx,ts,tsx}',
    timeout: input.timeout ?? 10000, runTimeout: input.runTimeout ?? 60000,
    expectTimeout: input.expectTimeout ?? Math.min(2000, Math.floor((input.timeout ?? 10000) / 2)),
    port: overrides.port ?? input.port ?? 7357, host: overrides.host ?? input.host ?? '127.0.0.1',
    browser: Object.freeze({ ...browser, args: Object.freeze([...(browser.args ?? [])]) }),
    webServer: Object.freeze({
      ...webServer, url: url.origin, cwd: resolve(root, webServer.cwd ?? '.'), timeout: webServer.timeout ?? 30000,
      ...(Array.isArray(webServer.command) ? { command: Object.freeze([...webServer.command]) } : {}),
      env: Object.freeze({ ...webServer.env })
    }),
    setup: input.setup ? (isAbsolute(input.setup) ? input.setup : resolve(root, input.setup)) : null
  };
  for (let key of ['timeout', 'expectTimeout', 'runTimeout']) if (!Number.isInteger(config[key]) || config[key] <= 0) throw new Error(`${key} must be a positive integer in milliseconds.`);
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('port must be between 0 and 65535.');
  if (typeof config.host !== 'string' || !config.host.trim()) throw new Error('host must be a non-empty string.');
  if (!Number.isInteger(config.webServer.timeout) || config.webServer.timeout <= 0) throw new Error('webServer.timeout must be a positive integer.');
  return Object.freeze(config);
}

export async function loadConfig(path = 'dyno.config.js', overrides = {}) {
  let file = resolve(path);
  try { await access(file); } catch { throw new Error(`Config not found: ${file}. Run dyno init first.`); }
  // User-selected configuration is loaded at the filesystem boundary.
  let { default: input } = await import(pathToFileURL(file).href);
  return normalizeConfig(input, file, overrides);
}
