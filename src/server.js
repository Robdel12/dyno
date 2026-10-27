import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { proxyRequest, proxyUpgrade } from './proxy.js';
import { mapStack, sourceContext } from './stack.js';
import { createRun, acceptEvent } from './run.js';

let prefix = '/__dyno__/';
let page = (title, body, script, stylesheet = 'runtime.css') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><link rel="stylesheet" href="${prefix}${stylesheet}"></head><body>${body}<script type="module" src="${prefix}${script}"></script></body></html>`;

async function reporterInput(request) {
  let chunks = [];
  let size = 0;
  for await (let chunk of request) {
    size += chunk.length;
    // Drain oversized requests without retaining their bodies, so the caller
    // receives an HTTP error instead of a reset connection. requestTimeout bounds this.
    chunks = size <= 1_000_000 ? [...chunks, chunk] : [];
  }
  if (size > 1_000_000) throw Object.assign(new Error('Reporter event exceeds 1 MB.'), { status: 413 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Reporter body must contain valid JSON.'); }
}

export async function createGateway(config, bundle, { fixtures = {}, onEvent = () => {}, rebuild, interactive = false } = {}) {
  let shell = page('Dyno', await readFile(new URL('./browser/reporter.html', import.meta.url), 'utf8'), 'shell.js', 'reporter.css');
  let runs = new Map();
  let bundles = new Map();
  let sockets = new Set();
  let origin;
  let allowedHosts;
  let settings = { timeout: config.timeout, expectTimeout: config.expectTimeout, files: bundle.files, fixtures, interactive, appURL: config.webServer.url };
  let server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    try {
      if (!allowedHosts.has(request.headers.host?.toLowerCase())) { response.writeHead(421); response.end('Unrecognized Dyno gateway host.'); return; }
      let url = new URL(request.url, origin);
      if (!request.url.startsWith('/') || url.origin !== origin) throw new Error('The test gateway accepts origin-relative request paths only.');
      if (!url.pathname.startsWith(prefix)) return proxyRequest(request, response, { target: config.webServer.url, gatewayOrigin: `http://${request.headers.host}` });
      response.setHeader('Cache-Control', 'no-store');
      let route = url.pathname.slice(prefix.length);
      let send = (type, content, status = 200) => { response.writeHead(status, { 'Content-Type': type }); response.end(content); };
      if (route === '' && request.method === 'GET') return send('text/html; charset=utf-8', shell);
      if (route === 'runtime' && request.method === 'GET') return send('text/html; charset=utf-8', page('Test runtime', '<script src="/__dyno__/guard.js"></script>', `suite.js?run=${encodeURIComponent(url.searchParams.get('run'))}`));
      if (['reporter.css', 'runtime.css', 'reporter.js', 'shell.js', 'guard.js'].includes(route)) return send(route.endsWith('.css') ? 'text/css' : 'text/javascript', await readFile(new URL(`./browser/${route}`, import.meta.url), 'utf8'));
      if (['suite.js', 'suite.js.map'].includes(route)) {
        let run = url.searchParams.get('run');
        let snapshot = bundles.get(run);
        if (!snapshot) throw new Error('Unknown test bundle. Reload the capture URL.');
        return route.endsWith('.map') ? send('application/json', JSON.stringify(snapshot.map)) : send('text/javascript', snapshot.code + `\n//# sourceMappingURL=suite.js.map?run=${encodeURIComponent(run)}`);
      }
      if (route === 'bridge.js') return send('text/javascript', bundle.bridge);
      if (route === 'settings') return send('application/json', JSON.stringify({ ...settings, files: bundles.get(url.searchParams.get('run'))?.files ?? bundle.files }));
      if (route === 'results' && request.method === 'GET') return send('application/json', JSON.stringify([...runs.values()]));
      if (['capture', 'events'].includes(route) && request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) throw new Error('Reporter requests must be same-origin.');
        if (route === 'capture') {
          let snapshot = rebuild ? await rebuild() : bundle;
          while (runs.size >= 20) {
            let finished = [...runs.values()].find(run => ['completed', 'failed'].includes(run.status));
            if (!finished) { send('text/plain', 'Dyno already has 20 active browser runs. Finish or close one before joining again.', 429); return; }
            runs.delete(finished.runId);
            bundles.delete(finished.runId);
          }
          let runId = randomUUID();
          runs.set(runId, createRun(runId));
          bundles.set(runId, snapshot);
          onEvent({ type: 'capture', runId });
          return send('application/json', JSON.stringify({ runId }));
        }
        let input = await reporterInput(request);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Reporter event must be an object.');
        let eventInput = input;
        if (input.error) {
          let stack = typeof input.error.stack === 'string' ? mapStack(input.error.stack, bundles.get(input.runId)?.map, config.root) : undefined;
          let declaration = typeof input.error.declaration === 'string' ? mapStack(input.error.declaration, bundles.get(input.runId)?.map, config.root) : undefined;
          if (declaration && !stack?.includes(config.testDir)) stack = `${stack ?? input.error.message}\nTest declared at:\n${declaration}`;
          let mapped = { ...input.error, ...(stack ? { stack } : {}), ...(declaration ? { declaration } : {}) };
          eventInput = { ...input, error: { ...mapped, source: sourceContext(mapped, bundles.get(input.runId), config.root) } };
        }
        let { run, event } = acceptEvent(runs.get(input.runId), eventInput);
        runs.set(run.runId, run);
        send('application/json', JSON.stringify({ error: event.error }));
        onEvent(event);
        return;
      }
      send('text/plain', 'Unknown browser test route', 404);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.status ?? 400, { 'Content-Type': 'text/plain' });
      response.end(error.message);
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => {
    let gatewayOrigin = `http://${request.headers.host}`;
    if (!allowedHosts.has(request.headers.host?.toLowerCase()) || (request.headers.origin && request.headers.origin !== gatewayOrigin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    try { proxyUpgrade(request, socket, head, { target: config.webServer.url, gatewayOrigin }); }
    catch { socket.destroy(); }
  });
  server.listen(config.port, config.host);
  try { await once(server, 'listening'); }
  catch (error) { throw new Error(`Cannot listen on ${config.host}:${config.port}: ${error.code ?? error.message}`, { cause: error }); }
  let host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
  origin = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`;
  let hosts = [host];
  if (['127.0.0.1', '::1', 'localhost'].includes(host)) hosts = [...hosts, '127.0.0.1', '::1', 'localhost'];
  if (['0.0.0.0', '::'].includes(config.host)) hosts = [...hosts, ...Object.values(networkInterfaces()).flat().map(entry => entry.address)];
  allowedHosts = new Set(hosts.map(host => `${host.includes(':') ? `[${host}]` : host}:${server.address().port}`.toLowerCase()));
  let closing;
  return {
    origin, url: origin + prefix,
    close() {
      closing ??= new Promise(resolve => {
        server.close(resolve);
        for (let socket of sockets) socket.destroy();
      });
      return closing;
    }
  };
}
