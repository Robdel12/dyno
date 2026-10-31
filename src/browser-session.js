import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { startProcess } from './process.js';
import { browserNames, browserEngine, browserChannel } from './browsers.js';
import { nativeCapabilities } from './native.js';

export async function resolveSession(browser, { headless = true } = {}) {
  let name = browser.name ?? 'chromium';
  if (!browserNames.includes(name))
    throw new Error(
      `Unknown browser "${name}". Choose ${browserNames.join(', ')} or use --manual.`,
    );
  let path = browser.path;
  if (path) {
    path = resolve(path);
    try {
      await access(path, constants.X_OK);
    } catch {
      throw new Error(`Browser executable is missing or not executable: ${path}`);
    }
  }
  return Object.freeze({
    ...browser,
    name,
    ...(path ? { path } : {}),
    provider: 'playwright',
    headless,
    isolated: true,
  });
}

async function closeBrowser(server) {
  let deadline = AbortSignal.timeout(5000);
  let expired = Promise.withResolvers();
  let abort = () => expired.reject(new Error('Browser shutdown exceeded 5000 ms.'));
  deadline.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([server.close(), expired.promise]);
    return true;
  } catch {
    await server.kill();
    return false;
  } finally { deadline.removeEventListener('abort', abort); }
}

export async function createBrowserPool(plan, { size = 1, signal, onExit = () => {}, onDiagnostic = () => {} } = {}) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 32)
    throw new Error('Browser pool size must be between 1 and 32.');
  signal?.throwIfAborted();
  let server;
  try { server = await browserEngine(plan.name).launchServer({
    headless: plan.headless,
    args: plan.args,
    timeout: 30000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    ...(plan.name === 'firefox' ? {
      firefoxUserPrefs: {
        'dom.min_background_timeout_value': 0,
        'dom.min_background_timeout_value_without_budget_throttling': 0,
        'dom.timeout.enable_budget_timer_throttling': false,
      },
    } : {}),
    ...(plan.path ? { executablePath: plan.path } :
      browserChannel(plan.name) ? { channel: browserChannel(plan.name) } : {}),
  }); } catch (error) {
    let help = !plan.path && /executable.*doesn.t exist/i.test(error.message)
      ? ` Install its Playwright build with dyno install --browser ${plan.name}.` : '';
    throw new Error(error.message + help, { cause: error });
  }
  if (signal?.aborted) {
    await closeBrowser(server);
    signal.throwIfAborted();
  }
  let owned = startProcess(process.execPath, {
    shell: false, ipc: true,
    args: [fileURLToPath(new URL('./providers/worker.js', import.meta.url))],
  });
  let requests = new Map();
  let workerIds = new Set();
  let stopping;
  let disconnected = false;
  let fail = (error) => {
    if (stopping || disconnected) return;
    disconnected = true;
    onExit(error);
  };
  server.on('close', () => fail(new Error('The managed browser disconnected.')));
  owned.child.on('message', (message) => {
    if (message.kind === 'diagnostic') {
      onDiagnostic({ workerId: message.workerId, message: message.message });
      return;
    }
    if (message.kind === 'disconnected') {
      fail(new Error(`Managed browser worker ${message.workerId} lost its application page.`));
      return;
    }
    let pending = requests.get(message.id);
    if (!pending) return;
    requests.delete(message.id);
    message.error ? pending.reject(new Error(message.error.replaceAll(server.wsEndpoint(), '[private browser connection]'))) : pending.resolve(message.value);
  });
  owned.child.once('exit', () => {
    let error = new Error(`The Playwright browser worker disconnected. ${owned.logs}`.trim());
    for (let pending of requests.values()) pending.reject(error);
    requests.clear();
    fail(error);
  });
  let invoke = async (method, input = {}, operationSignal, workerId) => {
    let id = randomUUID();
    let request = Promise.withResolvers();
    requests.set(id, request);
    let deadline = AbortSignal.any([
      AbortSignal.timeout(['initialize', 'create', 'open'].includes(method) ? 35000 : method === 'stop' ? 3000 : method === 'retire' ? 20000 : 15000),
      ...(signal && !['stop', 'resetNative', 'dispose'].includes(method) ? [signal] : []),
      ...(operationSignal ? [operationSignal] : []),
    ]);
    let sendFailed = (error) => request.reject(new Error(`Browser IPC ${method} failed: ${error.message}`, { cause: error }));
    let submitted = false;
    let abort = () => {
      if (submitted && owned.child.connected) {
        try { owned.child.send({ kind: 'cancel-operation', id, workerId, method, input }, () => {}); }
        catch { /* Channel closure still rejects and removes this request below. */ }
      }
      requests.delete(id);
      request.reject(new Error(`Browser ${method} cancelled or exceeded its deadline.`, { cause: deadline.reason }));
    };
    deadline.addEventListener('abort', abort, { once: true });
    try {
      if (deadline.aborted) abort();
      else {
        submitted = true;
        try {
          owned.child.send({ id, method, workerId, input }, (error) => { if (error) sendFailed(error); });
        } catch (error) { sendFailed(error); }
      }
      return await request.promise;
    } finally {
      requests.delete(id);
      deadline.removeEventListener('abort', abort);
    }
  };
  let stop = () => (stopping ??= (async () => {
    let graceful = true;
    try {
      if (owned.child.connected) await invoke('stop');
      else graceful = false;
    } catch { graceful = false; }
    finally {
      try { if (!await closeBrowser(server)) graceful = false; }
      finally { await owned.stop(); }
    }
    return Object.freeze({ graceful });
  })());
  try {
    await owned.ready;
    await invoke('initialize', { endpoint: server.wsEndpoint(), name: plan.name });
    signal?.throwIfAborted();
    return Object.freeze({
      async createWorker(workerId, { viewport } = {}) {
        if (stopping || disconnected) throw new Error('This browser pool is closed.');
        if (typeof workerId !== 'string' || !workerId || workerIds.has(workerId))
          throw new Error('Browser workers need a unique, non-empty ID.');
        // Reserve before awaiting creation so concurrent callers cannot reuse an ID.
        if (workerIds.size >= size) throw new Error(`Browser pool capacity is ${size} workers.`);
        workerIds.add(workerId);
        try {
          let identity = Object.freeze(await invoke('create', { plan, viewport }, undefined, workerId));
          if (stopping || disconnected) throw new Error('The browser pool closed during worker creation.');
          let disposed;
          let call = async (method, input, operationSignal) => {
            if (disposed || stopping || disconnected) throw new Error(`Browser worker ${workerId} is closed.`);
            try { return await invoke(method, input, operationSignal, workerId); }
            catch (error) {
              // These operations can change document or viewport state even
              // after a caller stops waiting. Close before any handoff.
              if (['open', 'activate', 'resize', 'retire'].includes(method)) {
                fail(error);
                await stop();
              }
              throw error;
            }
          };
          let worker = Object.freeze({
            identity,
            capabilities: Object.freeze({ screenshot: true, fullPage: true, hostViewport: true, native: nativeCapabilities(plan.name) }),
            open: (url) => call('open', { url }),
            activate: () => call('activate'),
            retire: (url) => call('retire', { url }),
            resize: (size, operationSignal) => call('resize', size, operationSignal),
            capture: async (options, operationSignal) => Buffer.from(await call('capture', options, operationSignal), 'base64'),
            native: (input, operationSignal) => call('native', input, operationSignal),
            resetNative: async (input, operationSignal) => {
              try { await call('resetNative', input, operationSignal); }
              catch (error) { fail(error); await stop(); throw error; }
            },
            stop: () => stopping ?? (disposed ??= (async () => {
              try { await invoke('dispose', {}, undefined, workerId); }
              catch (error) { fail(error); await stop(); throw error; }
            })()),
            get logs() { return owned.logs; },
          });
          return worker;
        } catch (error) {
          await stop();
          throw error;
        }
      },
      stop,
      get logs() { return owned.logs; },
    });
  } catch (error) {
    await stop();
    throw error;
  }
}
