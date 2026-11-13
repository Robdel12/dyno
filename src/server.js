import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { proxyRequest, proxyUpgrade } from './proxy.js';
import { createCoordinator } from './coordinator.js';
import { defaultViewport } from './browser/viewport.js';
import { createBrowserControl } from './browser-control.js';
import { wordmark } from './browser/markup.js';

let prefix = '/__dyno__/';
let favicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#141f2a"/><circle cx="20" cy="20" r="12.5" fill="none" stroke="#ffc629" stroke-width="5"/><circle cx="20" cy="20" r="3.5" fill="#ffc629"/></svg>')}`;
let archivo = readFile(new URL('./browser/fonts/archivo.woff2', import.meta.url));
let withWordmark = (html) => html.replace('<!-- wordmark -->', wordmark);
let page = (title, body, script, stylesheet = 'runtime.css') =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="${favicon}"><title>${title}</title><link rel="stylesheet" href="${prefix}${stylesheet}"></head><body>${body}<script type="module" src="${prefix}${script}"></script></body></html>`;

async function reporterInput(request, limit = 1_000_000) {
  let chunks = [];
  let size = 0;
  for await (let chunk of request) {
    size += chunk.length;
    // Drain oversized requests without retaining their bodies, so the caller
    // receives an HTTP error instead of a reset connection. requestTimeout bounds this.
    chunks = size <= limit ? [...chunks, chunk] : [];
  }
  if (size > limit)
    throw Object.assign(new Error(`Reporter event exceeds ${limit / 1_000_000} MB.`), {
      status: 413,
    });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('Reporter body must contain valid JSON.');
  }
}

export async function createGateway(
  config,
  bundle,
  {
    fixtures = {},
    onEvent = () => {},
    onRun = async () => {},
    onError = () => {},
    onDrain,
    beforeExecution,
    rebuild,
    interactive = false,
    releaseFinal = false,
    coordinator,
    workerId = '0',
  } = {},
) {
  let shell = page(
    'Dyno',
    withWordmark(await readFile(new URL('./browser/host.html', import.meta.url), 'utf8')),
    'shell.js',
    'host.css',
  );
  let start = page(
    'Dyno',
    `<main class="control-room">${wordmark}<h1>Start a test run</h1><p id="start-status">Connecting tests…</p><button id="start" hidden>Start tests</button></main>`,
    'bootstrap.js',
    'host.css',
  );
  let reporter = page(
    'Dyno results',
    withWordmark(await readFile(new URL('./browser/reporter.html', import.meta.url), 'utf8')),
    'reporter-client.js',
    'reporter.css',
  );
  let documentPolicy = Object.freeze({});
  coordinator ??= createCoordinator(config, bundle, { onEvent, onRun, onError, rebuild });
  let sockets = new Set();
  let stopping = false;
  let requireOpen = () => {
    coordinator.requireOpen();
    if (stopping) throw Object.assign(new Error('Dyno is shutting down.'), { status: 503 });
  };
  let control = createBrowserControl({
    workerId,
    artifactsDir: config.artifactsDir,
    onConnection: event => { if (!stopping) coordinator.connection(workerId, event); },
    getRun: coordinator.get,
    getView: coordinator.view,
    getAttachment: coordinator.attachment,
    onView: (runId, change) => coordinator.progress(workerId, runId, change),
    onReplaced: coordinator.replaced,
    onCommand: input => coordinator.command(input, workerId),
    onCommandResult: input => coordinator.commandResult(workerId, input),
  });
  coordinator.register(workerId, control, onDrain, beforeExecution, fixtures);
  let origin;
  let allowedHosts;
  let settings = {
    forbidOnly: config.forbidOnly,
    seed: config.seed,
    cleanupTimeout: config.cleanupTimeout,
    timeout: config.timeout,
    expectTimeout: config.expectTimeout,
    files: bundle.files,
    fixtures,
    interactive,
    releaseFinal,
    appURL: config.webServer.url,
    viewport: config.viewport,
    managedViewport: defaultViewport,
  };
  let server = http.createServer(
    { requestTimeout: 15000, headersTimeout: 10000 },
    async (request, response) => {
      try {
        if (request.method !== 'GET') requireOpen();
        if (!allowedHosts.has(request.headers.host?.toLowerCase())) {
          response.writeHead(421);
          response.end('Unrecognized Dyno gateway host.');
          return;
        }
        let url = new URL(request.url, origin);
        if (!request.url.startsWith('/') || url.origin !== origin)
          throw new Error('The test gateway accepts origin-relative request paths only.');
        if (!url.pathname.startsWith(prefix))
          return proxyRequest(request, response, {
            target: config.webServer.url,
            gatewayOrigin: `http://${request.headers.host}`,
          });
        for (let [name, value] of Object.entries(documentPolicy)) response.setHeader(name, value);
        response.setHeader('Cache-Control', 'no-store');
        let route = url.pathname.slice(prefix.length);
        let send = (type, content, status = 200) => {
          response.writeHead(status, { 'Content-Type': type });
          response.end(content);
        };
        if (route === '' && request.method === 'GET')
          return send('text/html; charset=utf-8', start);
        if (route === 'controller' && request.method === 'GET')
          return send('text/html; charset=utf-8', shell);
        if (route === 'blank' && request.method === 'GET')
          return send(
            'text/html; charset=utf-8',
            '<!doctype html><html><head><meta name="viewport" content="width=device-width"><script src="/__dyno__/bridge.js"></script></head><body></body></html>',
          );
        if (route === 'park' && request.method === 'GET')
          return send('text/html; charset=utf-8', page('Ready for the next test', '', 'park.js'));
        if (route === 'reporter' && request.method === 'GET')
          return send('text/html; charset=utf-8', reporter);
        if (
          [
            'view',
            'control',
            'command-result',
            'connection-status',
            'context',
            'operations',
            'operations/cancel',
            'attachments/commit',
            'attachments/discard',
          ].includes(route) &&
          request.method === 'POST'
        ) {
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
            throw new Error('Browser commands must be same-origin.');
          let input = await reporterInput(request);
          requireOpen();
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error('Browser commands must be objects.');
          if (['view', 'control'].includes(route)) {
            await coordinator.serialize(input.runId, () => {
              requireOpen();
              return control.handle(route, url, request, response, input);
            });
            return;
          }
          if (await control.handle(route, url, request, response, input)) return;
        }
        if (await control.handle(route, url, request, response)) return;
        if (route === 'runtime' && request.method === 'GET')
          return send(
            'text/html; charset=utf-8',
            page(
              'Test runtime',
              '<script src="/__dyno__/guard.js"></script>',
              `suite.js?run=${encodeURIComponent(url.searchParams.get('run'))}`,
            ),
          );
        if (
          [
            'reporter.css',
            'runtime.css',
            'host.css',
            'reporter.js',
            'dyno-chart.js',
            'markup.js',
            'timings.js',
            'timing-format.js',
            'reporter-client.js',
            'execution.js',
            'reporting.js',
            'viewport.js',
            'shell.js',
            'bootstrap.js',
            'guard.js',
            'park.js',
            'companion.js',
          ].includes(route)
        )
          return send(
            route.endsWith('.css') ? 'text/css' : 'text/javascript',
            await readFile(new URL(`./browser/${route}`, import.meta.url), 'utf8'),
          );
        if (route === 'archivo.woff2' && request.method === 'GET') {
          response.setHeader('Cache-Control', 'public, max-age=86400');
          return send('font/woff2', await archivo);
        }
        if (route === 'suite-model.js')
          return send(
            'text/javascript',
            await readFile(new URL('./suite.js', import.meta.url), 'utf8'),
          );
        if (['suite.js', 'suite.js.map'].includes(route)) {
          let run = url.searchParams.get('run');
          let snapshot = coordinator.bundle(run);
          if (!snapshot) throw new Error('Unknown test bundle. Reload the capture URL.');
          response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
          return route.endsWith('.map')
            ? send('application/json', JSON.stringify(snapshot.map))
            : send(
                'text/javascript',
                snapshot.code +
                  `\n//# sourceMappingURL=suite.js.map?run=${encodeURIComponent(run)}`,
              );
        }
        if (route === 'bridge.js') return send('text/javascript', bundle.bridge);
        if (route === 'settings') {
          let run = coordinator.get(url.searchParams.get('run'));
          return send(
            'application/json',
            JSON.stringify({
              ...settings,
              ...(run ? { seed: run.seed } : {}),
              releaseFinal: releaseFinal && Boolean(run?.managed),
              files: coordinator.bundle(url.searchParams.get('run'))?.files ?? bundle.files,
            }),
          );
        }
        if (route === 'results' && request.method === 'GET')
          return send('application/json', JSON.stringify(coordinator.values()));
        if (['assignment', 'released'].includes(route) && request.method === 'POST') {
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
            throw new Error('Assignments must be same-origin.');
          let input = await reporterInput(request);
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid assignment request.');
          if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 256)
            throw new Error('Assignments require a request ID.');
          let controller = new AbortController();
          let disconnected = () => { if (!response.writableEnded) controller.abort(new Error('Assignment connection closed.')); };
          response.once('close', disconnected);
          try {
            let reply = route === 'assignment'
              ? await coordinator.assignment(workerId, input, controller.signal)
              : await coordinator.release(workerId, input);
            send('application/json', reply);
          } finally { response.removeListener('close', disconnected); }
          return;
        }
        if (['capture', 'events'].includes(route) && request.method === 'POST') {
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
            throw new Error('Reporter requests must be same-origin.');
          let input = await reporterInput(request);
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error('Reporter event must be an object.');
          if (route === 'capture') {
            let joined = await coordinator.capture(workerId, input);
            return send('application/json', JSON.stringify(joined));
          }
          send('application/json', await coordinator.event(workerId, input));
          return;
        }
        send('text/plain', 'Unknown browser test route', 404);
      } catch (error) {
        if (!response.headersSent)
          response.writeHead(error.status ?? 400, { 'Content-Type': 'text/plain' });
        response.end(error.message);
      }
    },
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    let gatewayOrigin = `http://${request.headers.host}`;
    if (
      !allowedHosts.has(request.headers.host?.toLowerCase()) ||
      (request.headers.origin && request.headers.origin !== gatewayOrigin)
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    try {
      proxyUpgrade(request, socket, head, { target: config.webServer.url, gatewayOrigin });
    } catch {
      socket.destroy();
    }
  });
  // Keep localhost's browser origin while avoiding different address-family
  // choices between Node clients and the listener on the same machine.
  server.listen(config.port, config.host === 'localhost' ? '127.0.0.1' : config.host);
  try {
    await once(server, 'listening');
  } catch (error) {
    throw new Error(
      `Cannot listen on ${config.host}:${config.port}: ${error.code ?? error.message}`,
      {
        cause: error,
      },
    );
  }
  let host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
  origin = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`;
  let hosts = [host];
  if (['127.0.0.1', '::1', 'localhost'].includes(host))
    hosts = [...hosts, '127.0.0.1', '::1', 'localhost'];
  if (['0.0.0.0', '::'].includes(config.host))
    hosts = [
      ...hosts,
      ...Object.values(networkInterfaces())
        .flat()
        .map((entry) => entry.address),
    ];
  allowedHosts = new Set(
    hosts.map((host) =>
      `${host.includes(':') ? `[${host}]` : host}:${server.address().port}`.toLowerCase(),
    ),
  );
  let closing;
  return {
    origin,
    url: origin + prefix,
    setDocumentPolicy(headers) {
      requireOpen();
      if (coordinator.values().length) throw new Error('App document policy must be known before a browser joins.');
      let names = [
        'cross-origin-opener-policy',
        'cross-origin-embedder-policy',
        'origin-agent-cluster',
      ];
      documentPolicy = Object.freeze(
        Object.fromEntries(
          names.filter((name) => headers[name]).map((name) => [name, headers[name]]),
        ),
      );
    },
    attachSession(browser, key) {
      control.attach(browser, key);
      coordinator.lifecycle(workerId, {
        async retire() {
          try { await browser.retire(origin + prefix + 'blank'); }
          catch (error) { await browser.stop(); throw error; }
        },
        open() {
          let url = new URL(origin + prefix);
          url.hash = new URLSearchParams({ launch: key }).toString();
          return browser.open(url.href);
        },
      });
    },
    reload: control.reload,
    notify: control.notify,
    close({ error } = {}) {
      stopping = true;
      closing ??= (async () => {
        let failures = [];
        try { await coordinator.close({ error }); }
        catch (error) { failures.push(error); }
        try {
          await control.close();
        } catch (error) {
          failures.push(error);
        } finally {
          await new Promise((resolve) => {
            server.close(resolve);
            for (let socket of sockets) socket.destroy();
          });
        }
        if (failures.length)
          throw new AggregateError(failures, 'Could not finish Dyno reports and cleanup.');
      })();
      return closing;
    },
  };
}
