import { access } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function defineConfig(config) { return config; }

export async function loadConfig(path = 'dyno.config.js') {
  let file = resolve(path);
  try { await access(file); } catch { throw new Error(`Config not found: ${file}. Run dyno init first.`); }
  // User-selected project configuration is loaded at this boundary.
  let { default: input } = await import(pathToFileURL(file).href);
  if (!input || typeof input !== 'object') throw new Error('Config must export a configuration object.');
  let root = dirname(file);
  let webServer = input.webServer;
  if (!webServer?.url) throw new Error('webServer.url is required.');
  let url = new URL(webServer.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('webServer.url must be an HTTP(S) origin, for example http://127.0.0.1:3000.');
  }
  let config = {
    root, file, testDir: resolve(root, input.testDir ?? 'tests/browser'),
    testMatch: input.testMatch ?? '**/*.test.{js,jsx,ts,tsx}',
    timeout: input.timeout ?? 10000, runTimeout: input.runTimeout ?? 60000,
    expectTimeout: input.expectTimeout ?? Math.min(2000, Math.floor((input.timeout ?? 10000) / 2)),
    port: input.port ?? 7357, host: input.host ?? '127.0.0.1',
    browser: input.browser ?? {},
    webServer: { ...webServer, url: url.origin, cwd: resolve(root, webServer.cwd ?? '.'), timeout: webServer.timeout ?? 30000 },
    setup: input.setup ? (isAbsolute(input.setup) ? input.setup : resolve(root, input.setup)) : null
  };
  for (let key of ['timeout', 'expectTimeout', 'runTimeout']) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) throw new Error(`${key} must be a positive integer in milliseconds.`);
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('port must be between 0 and 65535.');
  if (!Number.isInteger(config.webServer.timeout) || config.webServer.timeout <= 0) throw new Error('webServer.timeout must be a positive integer.');
  return config;
}
