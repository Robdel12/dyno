import { getSuite } from './registry.js';
import { createApp } from './app.js';
import { createInteractor } from './interactor.js';
import { captureConsole } from './console.js';

let serialize = (error) => ({ message: error?.message ?? String(error), stack: error?.stack });
export async function boot() {
  let suite = getSuite();
  let parameters = new URLSearchParams(location.search);
  let runId = parameters.get('run');
  let executionId = parameters.get('execution');
  let send = (kind, data = {}) =>
    parent.postMessage({ channel: 'dyno', runId, executionId, kind, ...data }, location.origin);
  try {
    if (parameters.get('mode') === 'discover') {
      send('discovered', { tests: suite.tests.map(({ name, timeout }, index) => ({ name, timeout, index })) });
      return;
    }
    let index = Number(parameters.get('test'));
    let test = suite.tests[index];
    if (!test) throw new Error(`Unknown test index ${index}`);
    let settings = await fetch(`/__dyno__/settings?run=${encodeURIComponent(runId)}`).then((response) =>
      response.json()
    );
    let controller = new AbortController();
    let outputStarted = performance.now();
    let output = [];
    let collectingOutput = true;
    let record = (source, entries) => {
      if (!collectingOutput || output.length >= 100) return;
      let messages = entries
        .slice(0, 100 - output.length)
        .map((entry) => ({ ...entry, source, elapsed: performance.now() - outputStarted }));
      output = [...output, ...messages];
      send('output', { index, entries: messages });
    };
    let restoreConsole = captureConsole(console, (entries) => record('test', entries));
    let frame = document.createElement('iframe');
    frame.title = 'App under test';
    document.body.append(frame);
    let state = Object.freeze({ readyDocument: null, readyId: null, expectedName: null });
    let waiters = new Set();
    let fail = (error) => {
      if (!controller.signal.aborted) controller.abort(error);
    };
    let checkpoint = () =>
      new Promise((resolve) => {
        let marker = `${runId}-${index}-completion`;
        let receive = (event) => {
          if (event.source !== window || event.data?.checkpoint !== marker) return;
          window.removeEventListener('message', receive);
          resolve();
        };
        window.addEventListener('message', receive);
        // Cross one posted-message turn so already queued app errors reach the runner.
        window.postMessage({ checkpoint: marker }, location.origin);
      });
    let receive = (event) => {
      let message = event.data;
      if (event.origin !== location.origin || event.source !== frame.contentWindow || message?.channel !== 'dyno')
        return;
      if (message.name !== state.expectedName) return;
      if (message.kind === 'app-unloading') {
        if (message.id === state.readyId) {
          state = Object.freeze({ ...state, readyDocument: null });
          send('context', { documentId: null });
        }
        return;
      }
      if (frame.contentWindow.__browserTestBridge?.id !== message.id) return;
      if (message.kind === 'inspect') send('inspect');
      if (message.kind === 'app-output') record('app', message.entries);
      if (message.kind === 'app-error') {
        let error = new Error(message.error.message);
        error.stack = message.error.stack ?? error.stack;
        fail(error);
      }
      if (message.kind === 'app-ready' && frame.contentWindow.__browserTestBridge?.id === message.id) {
        state = Object.freeze({ ...state, readyDocument: frame.contentDocument, readyId: message.id });
        send('context', { documentId: message.id });
        send('location', {
          index,
          path:
            frame.contentWindow.location.pathname +
            frame.contentWindow.location.search +
            frame.contentWindow.location.hash
        });
        frame.contentWindow.addEventListener('error', (event) => fail(event.error ?? new Error(event.message)));
        frame.contentWindow.addEventListener('unhandledrejection', (event) =>
          fail(event.reason ?? new Error('Unhandled app rejection'))
        );
        for (let resolve of waiters) resolve();
      }
    };
    window.addEventListener('message', receive);
    window.addEventListener('error', (event) => fail(event.error ?? new Error(event.message)));
    window.addEventListener('unhandledrejection', (event) => fail(event.reason ?? new Error('Unhandled rejection')));
    let abortable = (promise) =>
      new Promise((resolve, reject) => {
        let aborted = () => reject(controller.signal.reason);
        if (controller.signal.aborted) return aborted();
        controller.signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve(promise)
          .then(resolve, reject)
          .finally(() => controller.signal.removeEventListener('abort', aborted));
      });
    let navigate = async (path) => {
      let target = new URL(path, location.origin);
      if (target.origin !== location.origin || target.pathname.startsWith('/__dyno__/'))
        throw new Error('app.goto requires an app path on the gateway origin.');
      controller.signal.throwIfAborted();
      state = Object.freeze({
        readyDocument: null,
        readyId: null,
        expectedName: `dyno-${runId}-${index}-${[...crypto.getRandomValues(new Uint32Array(2))].join('-')}`
      });
      send('context', { documentId: null });
      frame.name = state.expectedName;
      frame.contentWindow.name = state.expectedName;
      let ready = new Promise((resolve) => waiters.add(resolve));
      send('location', { index, path: target.pathname + target.search + target.hash });
      frame.src = target.href;
      try {
        await abortable(ready);
      } finally {
        waiters.clear();
      }
    };
    let pending = new Map();
    let receiveOperation = (event) => {
      let message = event.data;
      if (
        event.origin !== location.origin ||
        event.source !== parent ||
        message?.channel !== 'dyno' ||
        message.runId !== runId ||
        message.executionId !== executionId ||
        message.kind !== 'operation-result'
      )
        return;
      let request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.error)
        request.reject(Object.assign(new Error(message.error.message), { stack: message.error.stack }));
      else {
        try {
          request.resolve(request.select(message.result));
        } catch (error) {
          request.reject(error);
        }
      }
    };
    window.addEventListener('message', receiveOperation);
    controller.signal.addEventListener(
      'abort',
      () => {
        for (let request of pending.values()) request.reject(controller.signal.reason);
        pending.clear();
      },
      { once: true }
    );
    let operation = (input, prepare = () => ({}), select = (value) => value) => {
      controller.signal.throwIfAborted();
      let requestId = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
      let request = { ...Promise.withResolvers(), select };
      pending.set(requestId, request);
      Promise.resolve()
        .then(prepare)
        .then((prepared) => {
          controller.signal.throwIfAborted();
          send('operation', { requestId, documentId: state.readyId, ...input, ...prepared });
        })
        .catch((error) => {
          pending.delete(requestId);
          request.reject(error);
        });
      return request.promise;
    };
    let requireFinishedOperations = () => {
      if (pending.size)
        throw new Error('Await app.screenshot() and app.setViewport() before finishing a test or hook.');
    };
    let app = createApp(frame, () => state, controller.signal, navigate, operation);
    let I = createInteractor(app, controller.signal, settings.expectTimeout);
    let context = Object.freeze({ app, I, signal: controller.signal, fixtures: settings.fixtures });
    let started = performance.now();
    let outcome;
    try {
      for (let hook of suite.beforeEach) await abortable(hook(context));
      await abortable(test.run(context));
      requireFinishedOperations();
      controller.signal.throwIfAborted();
      outcome = { status: 'passed' };
    } catch (error) {
      outcome = { status: 'failed', error: { ...serialize(error), declaration: test.declaration } };
    } finally {
      for (let hook of suite.afterEach) {
        try {
          await abortable(hook(context));
        } catch (error) {
          outcome = { status: 'failed', error: { ...serialize(error), declaration: test.declaration } };
        }
      }
      try {
        requireFinishedOperations();
      } catch (error) {
        if (outcome.status === 'passed')
          outcome = { status: 'failed', error: { ...serialize(error), declaration: test.declaration } };
      }
      restoreConsole();
      try {
        frame.contentWindow.__browserTestBridge?.stopOutput?.();
      } catch {}
      try {
        await checkpoint();
        controller.signal.throwIfAborted();
      } catch (error) {
        if (outcome.status === 'passed')
          outcome = { status: 'failed', error: { ...serialize(error), declaration: test.declaration } };
      }
      try {
        let location = frame.contentWindow.location;
        send('location', { index, path: location.pathname + location.search + location.hash });
      } catch {}
      collectingOutput = false;
      controller.abort(new Error('Test finished'));
      waiters.clear();
    }
    send('result', { index, name: test.name, duration: performance.now() - started, ...outcome, output });
  } catch (error) {
    send('fatal', { error: serialize(error) });
  }
}
