import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { collectBrowserCoverage } from './browser.js';

let directory = process.env.DYNO_SELF_COVERAGE_DIR;
if (!directory) throw new Error('Framework coverage needs its output directory.');
mkdirSync(directory, { recursive: true });
let baselineText = readFileSync(process.env.DYNO_SELF_COVERAGE_BASELINE, 'utf8');
let baseline = JSON.parse(baselineText);
let buildId = createHash('sha256').update(baselineText).digest('hex');
let instanceId = randomUUID();
let documents = new Map();
let errors = [];
let counters = input => Object.fromEntries(Object.entries(input).map(([path, file]) =>
  [path, { s: file.s, f: file.f, b: file.b }]));
let save = () => {
  let node = globalThis.__dynoSelfCoverage;
  if (node) writeFileSync(join(directory, `node-${process.pid}-${instanceId}.json`), JSON.stringify({ schemaVersion: 1, buildId, kind: 'node', id: instanceId, coverage: counters(node) }));
  for (let [id, coverage] of documents)
    writeFileSync(join(directory, `browser-${process.pid}-${id}.json`), JSON.stringify({ schemaVersion: 1, buildId, kind: 'browser', id, coverage }));
  if (errors.length) writeFileSync(join(directory, `errors-${process.pid}.json`), JSON.stringify(errors));
};
process.on('exit', save);
for (let signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  let received = () => {
    save();
    if (process.listenerCount(signal) === 1) {
      process.removeListener(signal, received);
      process.kill(process.pid, signal);
    }
  };
  process.on(signal, received);
}

function receive(serialized) {
  try {
    let packet = JSON.parse(serialized);
    if (packet.schemaVersion !== 1 || packet.buildId !== buildId) throw new Error('Framework coverage received another instrumented build.');
    if (!/^[a-f\d-]{36}$/.test(packet.id) || !Number.isSafeInteger(packet.sequence) || packet.sequence < 1)
      throw new Error('Invalid framework coverage document.');
    if (packet.errors) errors.push(...packet.errors);
    let document = documents.get(packet.id) ?? {};
    for (let [path, fields] of Object.entries(packet.coverage)) {
      let source = baseline[path];
      if (!source) throw new Error(`Framework coverage received an unknown source: ${path}`);
      if (source.hash && packet.hashes && packet.hashes[path] !== source.hash) throw new Error(`Framework coverage source changed: ${path}`);
      let target = document[path] ?? { s: {}, f: {}, b: {} };
      for (let field of ['s', 'f', 'b']) {
        for (let [key, value] of Object.entries(fields[field] ?? {})) {
          if (!Object.hasOwn(source[field], key)) throw new Error('Unknown framework coverage counter.');
          if (field === 'b') {
            target.b[key] ??= {};
            for (let [index, hit] of Object.entries(value)) {
              if (!Number.isSafeInteger(hit) || hit < 0 || index >= source.b[key].length) throw new Error('Invalid framework branch counter.');
              target.b[key][index] = Math.max(target.b[key][index] ?? 0, hit);
            }
          } else {
            if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid framework coverage counter.');
            target[field][key] = Math.max(target[field][key] ?? 0, value);
          }
        }
      }
      document[path] = target;
    }
    documents.set(packet.id, document);
  } catch (error) { errors.push(error.message); }
}

// Keep terminal beacons out of the app's own HTTP handler. Unlike browser bindings,
// this real HTTP request survives destruction of the sending execution context.
// Closing a browser while it still uploads a beacon cuts the upload off, so close
// waits for beacons that have already started.
let uploads = new Set();
let uploaded = () => Promise.all(uploads);
let dispatch = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event !== 'request' || args[0].url !== '/__dyno_self_coverage__') return dispatch.call(this, event, ...args);
  let [request, response] = args;
  let upload = Promise.withResolvers();
  uploads.add(upload.promise);
  upload.promise.then(() => uploads.delete(upload.promise));
  request.once('close', upload.resolve);
  let bytes = 0;
  let chunks = [];
  request.on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= 65536) chunks.push(chunk);
  });
  request.on('end', () => {
    if (bytes > 65536) errors.push('A framework coverage beacon exceeded 64 KiB.');
    else receive(Buffer.concat(chunks).toString());
    response.writeHead(204);
    response.end();
  });
  request.on('aborted', () => errors.push('A framework coverage beacon was interrupted.'));
  return true;
};

let contexts = new WeakSet();
async function prepareContext(context) {
  if (contexts.has(context)) return;
  contexts.add(context);
  await context.exposeBinding('__dynoSelfCoverageBinding', (source, serialized) => receive(serialized));
  await context.addInitScript(collectBrowserCoverage, { buildId });
  let close = context.close.bind(context);
  context.close = async (...args) => {
    await uploaded();
    let result = await close(...args);
    save();
    return result;
  };
}
let browsers = new WeakSet();
function prepareBrowser(browser) {
  if (browsers.has(browser)) return browser;
  browsers.add(browser);
  let newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    let context = await newContext(...args);
    await prepareContext(context);
    return context;
  };
  let newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    let page = await newPage(...args);
    await prepareContext(page.context());
    await page.evaluate(collectBrowserCoverage, { buildId });
    return page;
  };
  let close = browser.close.bind(browser);
  browser.close = async (...args) => {
    await uploaded();
    let result = await close(...args);
    save();
    return result;
  };
  return browser;
}
let types = new Set([chromium, firefox, webkit]);
// Package-install tests execute another SDK copy from their own project directory.
// Resolve that dependency at the process boundary instead of assuming one module cache.
for (let parent of [join(process.cwd(), 'package.json'), process.argv[1]].filter(Boolean)) {
  try {
    let entry = createRequire(parent).resolve('playwright-core');
    let installed = (await import(pathToFileURL(entry).href)).default;
    for (let name of ['chromium', 'firefox', 'webkit']) types.add(installed[name]);
  } catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
}
for (let type of types) {
  for (let method of ['launch', 'connect', 'connectOverCDP']) {
    if (!type[method]) continue;
    let original = type[method].bind(type);
    type[method] = async (...args) => prepareBrowser(await original(...args));
  }
}
