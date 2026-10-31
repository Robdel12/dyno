import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { project } from '../helpers/project.js';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createGateway } from '../../src/server.js';
import { createBrowserPool, resolveSession } from '../../src/browser-session.js';

let browser = { name: process.env.DYNO_TEST_BROWSER ?? 'chromium' };

test('browser pool isolates simultaneous storage and retires documents without losing app storage', { timeout: 90000 }, async t => {
  let arrivals = new Map(), messages = [], errors = [];
  let oldRequests = Promise.withResolvers(), releaseOld = Promise.withResolvers();
  let oldCount = 0;
  t.after(() => releaseOld.resolve());
  let server = createServer(async (request, response) => {
    let url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/barrier') {
      arrivals.set(url.searchParams.get('worker'), response);
      if (arrivals.size === 2) for (let response of arrivals.values()) response.end('Both workers arrived');
    } else if (url.pathname === '/held-request') {
      if (++oldCount === 2) oldRequests.resolve();
      await releaseOld.promise;
      response.end('Old response');
    } else if (url.pathname === '/late-document-write') {
      messages.push(url.searchParams.get('owner'));
      response.end('recorded');
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><h1>Storage app</h1><button>Load saved message</button><script>
        document.querySelector('button').onclick = () => fetch('/held-request')
          .then(() => fetch('/late-document-write?owner=' + localStorage.getItem('owner')));
      </script>`);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  let appURL = `http://127.0.0.1:${server.address().port}`;
  let fixture = await project(t, {
    config: { webServer: { url: appURL } },
    source: `
    let storage = async (app, value) => {
      let opened = app.window.indexedDB.open('worker-storage', 1);
      opened.onupgradeneeded = () => opened.result.createObjectStore('values');
      let database = await new Promise((resolve, reject) => {
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      try {
        let transaction = database.transaction('values', value ? 'readwrite' : 'readonly');
        let completed = new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
        });
        let store = transaction.objectStore('values');
        if (value) store.put(value, 'owner');
        let request = store.get('owner');
        let result = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await completed;
        return result;
      } finally { database.close(); }
    };
    describe('Pool storage', () => {
      for (let owner of ['a', 'b']) test('worker ' + owner, async ({ app, I }) => {
        await app.goto('/');
        await I.find('Storage app').visible();
        await I.assert(() => app.window.localStorage.getItem('owner') === null);
        app.window.localStorage.setItem('owner', owner);
        app.window.sessionStorage.setItem('owner', owner);
        app.document.cookie = 'owner=' + owner + '; Path=/';
        await storage(app, owner);
        await app.request('/barrier?worker=' + owner);
        await I.assert(() => app.window.localStorage.getItem('owner') === owner);
        await I.assert(() => app.window.sessionStorage.getItem('owner') === owner);
        await I.assert(() => app.document.cookie === 'owner=' + owner);
        await I.assert(() => storage(app).then(value => value === owner));
        await I.click('Load saved message');
      });
      for (let owner of ['a', 'b']) test('retained ' + owner, async ({ app, I }) => {
        await app.goto('/');
        await I.find('Storage app').visible();
        await I.assert(() => app.window.localStorage.getItem('owner') === owner);
        await I.assert(() => app.window.sessionStorage.getItem('owner') === owner);
        await I.assert(() => app.document.cookie === 'owner=' + owner);
        await I.assert(() => storage(app).then(value => value === owner));
      });
    });`,
  });
  let config = await loadConfig(fixture.directory + '/dyno.config.js');
  let bundle = await buildSuite(config);
  let terminal = new Map(), waiters = new Map();
  let until = (count) => {
    if (terminal.size >= count) return Promise.resolve();
    let pending = Promise.withResolvers();
    waiters.set(count, pending);
    return pending.promise;
  };
  let gateway = await createGateway(config, bundle, {
    onEvent(event) {
      if (!['complete', 'fatal'].includes(event.type)) return;
      terminal.set(event.runId, event);
      for (let [count, pending] of waiters) if (terminal.size >= count) {
        waiters.delete(count); pending.resolve();
      }
    },
  });
  t.after(() => gateway.close());
  let pool = await createBrowserPool(await resolveSession(browser), { size: 2, signal: t.signal, onExit: error => errors.push(error.message) });
  t.after(pool.stop);
  let workers = await Promise.all(['a', 'b'].map(id => pool.createWorker(id, { viewport: { width: 800, height: 600 } })));
  await assert.rejects(pool.createWorker('a'), /unique/);
  await assert.rejects(pool.createWorker('c'), /capacity/);
  let run = (worker, name) => {
    let url = new URL(gateway.url);
    url.searchParams.set('test', name);
    return worker.open(url.href);
  };
  // Both real runtimes must reach the barrier at the same origin. A shared
  // context would overwrite their storage, and a global IPC queue would stall.
  await Promise.all(workers.map((worker, index) => run(worker, 'worker ' + ['a', 'b'][index])));
  await until(2);
  assert.equal([...terminal.values()].every(event => event.type === 'complete' && event.passed === 1), true, JSON.stringify([...terminal.values()]));
  await oldRequests.promise;
  await Promise.all(workers.map(worker => worker.retire(gateway.url + 'blank')));
  releaseOld.resolve();
  await Promise.all(workers.map((worker, index) => run(worker, 'retained ' + ['a', 'b'][index])));
  await until(4);
  assert.equal([...terminal.values()].every(event => event.type === 'complete' && event.passed === 1), true, JSON.stringify([...terminal.values()]));
  assert.deepEqual(messages, [], 'Retired app documents must not resume their held fetch continuations.');
  assert.deepEqual(errors, []);
  await workers[0].stop();
  await assert.rejects(workers[0].open(gateway.url), /closed/);
  await workers[1].open(gateway.url + 'blank');
});

test('a failed document retirement closes pool admission and its peer contexts', { timeout: 60000 }, async t => {
  let server = createServer((request, response) => {
    if (request.url === '/__dyno__/blank') request.socket.destroy();
    else response.end('<!doctype html><h1>App document</h1>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  let origin = `http://127.0.0.1:${server.address().port}`;
  let pool = await createBrowserPool(await resolveSession(browser), { size: 2, signal: t.signal });
  t.after(pool.stop);
  let workers = await Promise.all(['a', 'b'].map(id => pool.createWorker(id)));
  await Promise.all(workers.map(worker => worker.open(origin)));
  await assert.rejects(workers[0].retire(origin + '/__dyno__/blank'), /retire|net::|navigation|Load failed/i);
  await assert.rejects(workers[1].open(origin), /closed/);
  await assert.rejects(pool.createWorker('c'), /closed/);
  let result = await pool.stop();
  assert.equal(result.graceful, true);
});

test('cancelling queued viewport work closes the pool before it can be reused', { timeout: 60000 }, async t => {
  let arrived = Promise.withResolvers();
  let server = createServer((request, response) => {
    if (request.url === '/held') arrived.resolve();
    else response.end('<!doctype html><h1>App document</h1>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  let origin = `http://127.0.0.1:${server.address().port}`;
  let pool = await createBrowserPool(await resolveSession(browser), { size: 2, signal: t.signal });
  t.after(pool.stop);
  let workers = await Promise.all(['a', 'b'].map(id => pool.createWorker(id)));
  await Promise.all(workers.map(worker => worker.open(origin)));
  let opening = workers[0].open(origin + '/held');
  opening.catch(() => {});
  await arrived.promise;
  let cancel = new AbortController();
  let resizing = workers[0].resize({ width: 400, height: 300 }, cancel.signal);
  cancel.abort(new Error('Viewport request ended'));
  await assert.rejects(resizing, /cancelled/);
  await assert.rejects(opening);
  await assert.rejects(workers[1].open(origin), /closed/);
  await assert.rejects(pool.createWorker('c'), /closed/);
});
