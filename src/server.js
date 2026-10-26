import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { proxyRequest, proxyUpgrade } from './proxy.js';
import { mapStack } from './stack.js';

let prefix = '/__dyno__/';
let page = (title, body, script) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><link rel="stylesheet" href="${prefix}style.css"></head><body>${body}<script type="module" src="${prefix}${script}"></script></body></html>`;
let shell = page('Dyno', '<main><h1>Dyno</h1><p id="status">Discovering tests…</p><button id="rerun" type="button">Run again</button> <button id="all" type="button">All tests</button><ol id="results"></ol><div id="frame"></div></main>', 'shell.js');
let style = 'html,body{margin:0;min-height:100%;font:15px system-ui;color:#dce3ed;background:#11151d}main{padding:24px}h1{font-size:24px;margin:0 0 12px}button{font:inherit;padding:8px 16px}#results{padding-left:24px}li{padding:8px 0}li[data-status=passed]{color:#8ee4ba}li[data-status=failed]{color:#ff9e9e}pre{white-space:pre-wrap;font-size:12px}#frame>iframe{width:100%;height:760px;border:1px solid #465063}body>iframe{width:100%;height:100vh;border:0;display:block}';

export async function createGateway(config, bundle, { fixtures = {}, onEvent = () => {}, rebuild } = {}) {
  let runs = new Map();
  let bundles = new Map();
  let sockets = new Set();
  let origin;
  let server = http.createServer(async (request, response) => {
    try {
      let url = new URL(request.url, origin);
      if (!request.url.startsWith('/')) throw new Error('The test gateway accepts origin-relative request paths only.');
      if (!url.pathname.startsWith(prefix)) return proxyRequest(request, response, { target: config.webServer.url, gatewayOrigin: `http://${request.headers.host}` });
      response.setHeader('Cache-Control', 'no-store');
      let route = url.pathname.slice(prefix.length);
      let send = (type, content, status = 200) => { response.writeHead(status, { 'Content-Type': type }); response.end(content); };
      if (route === '' && request.method === 'GET') return send('text/html; charset=utf-8', shell);
      if (route === 'runtime' && request.method === 'GET') return send('text/html; charset=utf-8', page('Test runtime', '<script src="/__dyno__/guard.js"></script>', `suite.js?run=${encodeURIComponent(url.searchParams.get('run'))}`));
      if (route === 'style.css') return send('text/css', style);
      if (['suite.js', 'suite.js.map'].includes(route)) {
        let run = url.searchParams.get('run');
        let snapshot = bundles.get(run);
        if (!snapshot) throw new Error('Unknown test bundle. Reload the capture URL.');
        return route.endsWith('.map') ? send('application/json', JSON.stringify(snapshot.map)) : send('text/javascript', snapshot.code + `\n//# sourceMappingURL=suite.js.map?run=${encodeURIComponent(run)}`);
      }
      if (route === 'shell.js') return send('text/javascript', (await readFile(new URL('./browser/shell.js', import.meta.url), 'utf8')) + '\ndocument.querySelector("#rerun").addEventListener("click", () => location.reload());\ndocument.querySelector("#all").addEventListener("click", () => { location.href = location.pathname; });');
      if (route === 'bridge.js') return send('text/javascript', await readFile(new URL('./browser/bridge.js', import.meta.url), 'utf8'));
      if (route === 'guard.js') return send('text/javascript', await readFile(new URL('./browser/guard.js', import.meta.url), 'utf8'));
      if (route === 'settings') return send('application/json', JSON.stringify({ timeout: config.timeout, expectTimeout: config.expectTimeout, files: bundle.files, fixtures }));
      if (route === 'results' && request.method === 'GET') return send('application/json', JSON.stringify([...runs.values()]));
      if (['capture', 'events'].includes(route) && request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) throw new Error('Reporter requests must be same-origin.');
        if (route === 'capture') {
          let snapshot = rebuild ? await rebuild() : bundle;
          if (runs.size >= 20) { let oldest = runs.keys().next().value; runs.delete(oldest); bundles.delete(oldest); }
          let runId = randomUUID();
          runs.set(runId, { runId, status: 'captured', tests: [], outcomes: [] });
          bundles.set(runId, snapshot);
          onEvent({ type: 'capture', runId });
          return send('application/json', JSON.stringify({ runId }));
        }
        let body = '';
        for await (let chunk of request) { body += chunk; if (body.length > 1_000_000) throw new Error('Reporter event exceeds 1 MB.'); }
        let event = JSON.parse(body);
        let run = runs.get(event.runId);
        if (!run || ['completed', 'failed'].includes(run.status)) throw new Error('Unknown or finished run.');
        if (event.error?.stack) event.error.stack = mapStack(event.error.stack, bundles.get(event.runId)?.map, config.root);
        if (event.type === 'start') {
          if (run.status !== 'captured' || !Array.isArray(event.tests) || !event.tests.length || event.tests.some(name => typeof name !== 'string')) throw new Error('Invalid run start.');
          run.status = 'running'; run.tests = event.tests;
        } else if (event.type === 'test') {
          if (run.status !== 'running' || event.index !== run.outcomes.length || event.name !== run.tests[event.index] || !['passed', 'failed'].includes(event.status)) throw new Error('Unexpected or duplicate test result.');
          run.outcomes.push(event);
        } else if (event.type === 'complete') {
          if (run.status !== 'running' || run.outcomes.length !== run.tests.length) throw new Error('Run completed before all tests reported.');
          event.failed = run.outcomes.filter(item => item.status === 'failed').length;
          event.passed = run.outcomes.length - event.failed;
          run.status = 'completed'; run.summary = event;
        } else if (event.type === 'fatal') { run.status = 'failed'; }
        else throw new Error('Unknown reporter event.');
        send('application/json', JSON.stringify({ error: event.error }));
        onEvent(event);
        return;
      }
      send('text/plain', 'Unknown browser test route', 404);
    } catch (error) {
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end(error.message);
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => proxyUpgrade(request, socket, head, { target: config.webServer.url, gatewayOrigin: `http://${request.headers.host}` }));
  server.listen(config.port, config.host);
  await once(server, 'listening');
  let host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
  origin = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`;
  return {
    origin, url: origin + prefix,
    async close() {
      let closed = new Promise(resolve => server.close(resolve));
      for (let socket of sockets) socket.destroy();
      await closed;
    }
  };
}
