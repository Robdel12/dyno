import { getSuite } from './registry.js';
import { failureRecord, failureOutcome } from '../failures.js';
import { testDescriptor } from '../suite.js';
import { createApp } from './app.js';
import { createInteractor } from './interactor.js';
import { captureConsole } from './console.js';

let serialize = (error) => ({ message: error?.message ?? String(error), stack: error?.stack });
export async function boot() {
  let parameters = new URLSearchParams(location.search);
  let runId = parameters.get('run');
  let executionId = parameters.get('execution');
  let send = (kind, data = {}) =>
    parent.postMessage({ channel: 'dyno', runId, executionId, kind, ...data }, location.origin);
  try {
    let settings = await fetch(`/__dyno__/settings?run=${encodeURIComponent(runId)}`).then((response) =>
      response.json()
    );
    let tests = getSuite({ forbidOnly: settings.forbidOnly });
    if (parameters.get('mode') === 'discover') {
      send('discovered', { tests: tests.map(testDescriptor) });
      return;
    }
    let index = Number(parameters.get('test'));
    let selectedId = parameters.get('id');
    let test = tests.find((test) => test.id === selectedId);
    if (!test) throw new Error(`Test definition disappeared after discovery: ${selectedId}`);
    if (test.skipReason) throw new Error(`Test selection changed after discovery: ${test.skipReason}`);
    let controller = new AbortController();
    let activeController = controller;
    let failures = [];
    let seen = new WeakSet();
    let kinds = new WeakMap();
    let phase = 'beforeEach';
    let declaration = test.declaration;
    let finished = false;
    let ended = new Error('Test execution ended');
    let recordFailure = (error, fallback = phase, location = declaration) => {
      if (error && typeof error === 'object') {
        if (seen.has(error)) return;
        seen.add(error);
      }
      failures = [...failures, failureRecord(error, kinds.get(error) ?? fallback, location)];
    };
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
    let fail = (error, kind = phase) => {
      if (finished || error === ended || (error && typeof error === 'object' && seen.has(error))) return;
      if (!error || typeof error !== 'object') error = new Error(String(error));
      kinds.set(error, kind);
      if (!activeController.signal.aborted) activeController.abort(error);
    };
    window.__dynoRuntimeFailure = fail;
    window.addEventListener('message', (event) => {
      let message = event.data;
      if (
        event.source === parent &&
        event.origin === location.origin &&
        message?.channel === 'dyno' &&
        message.runId === runId &&
        message.executionId === executionId &&
        message.kind === 'cancel'
      )
        fail(new Error(message.error.message), 'runtime');
    });
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
        fail(error, 'app');
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
        for (let resolve of waiters) resolve();
      }
    };
    window.addEventListener('message', receive);
    let abortable = (promise, signal) =>
      new Promise((resolve, reject) => {
        let aborted = () => reject(signal.reason);
        if (signal.aborted) aborted();
        else signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve(promise)
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', aborted));
      });
    let navigate = async (path, signal) => {
      let target = new URL(path, location.origin);
      if (target.origin !== location.origin || target.pathname.startsWith('/__dyno__/'))
        throw new Error('app.goto requires an app path on the gateway origin.');
      signal.throwIfAborted();
      state = Object.freeze({
        readyDocument: null,
        readyId: null,
        expectedName: `dyno-${runId}-${index}-${[...crypto.getRandomValues(new Uint32Array(2))].join('-')}`
      });
      send('context', { documentId: null });
      frame.name = state.expectedName;
      frame.contentWindow.name = state.expectedName;
      let resolveReady;
      let ready = new Promise((resolve) => {
        resolveReady = resolve;
        waiters.add(resolve);
      });
      send('location', { index, path: target.pathname + target.search + target.hash });
      frame.src = target.href;
      try {
        await abortable(ready, signal);
      } finally {
        waiters.delete(resolveReady);
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
      request.detach();
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
    let operation = (input, prepare = () => ({}), select = (value) => value, signal) => {
      signal.throwIfAborted();
      let requestId = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
      let aborted = () => {
        pending.delete(requestId);
        send('operation-cancel', { requestId });
        request.reject(signal.reason);
      };
      let request = {
        ...Promise.withResolvers(),
        select,
        signal,
        detach: () => signal.removeEventListener('abort', aborted)
      };
      pending.set(requestId, request);
      signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve()
        .then(prepare)
        .then((prepared) => {
          signal.throwIfAborted();
          send('operation', { requestId, documentId: state.readyId, ...input, ...prepared });
        })
        .catch((error) => {
          pending.delete(requestId);
          request.detach();
          request.reject(error);
        });
      return request.promise;
    };
    let requireFinishedOperations = (signal) => {
      if ([...pending.values()].some((request) => request.signal === signal))
        throw new Error('Await app.screenshot() and app.setViewport() before finishing a test or hook.');
    };
    let contextFor = (signal) => {
      let app = createApp(
        frame,
        () => state,
        signal,
        (path) => navigate(path, signal),
        (input, prepare, select) => operation(input, prepare, select, signal)
      );
      return Object.freeze({
        app,
        I: createInteractor(app, signal, settings.expectTimeout),
        signal,
        fixtures: settings.fixtures,
        test: testDescriptor(test)
      });
    };
    let invoke = async (run, context) => {
      context.signal.throwIfAborted();
      let result = run(context);
      if (result && typeof result.next === 'function')
        throw new Error('Test callbacks and hooks must use ordinary or async functions, not generators.');
      await abortable(result, context.signal);
      requireFinishedOperations(context.signal);
      context.signal.throwIfAborted();
    };
    let entered = [];
    let context = contextFor(controller.signal);
    let started = performance.now();
    let remaining = Number(parameters.get('deadline')) - Date.now();
    let executionDeadline = AbortSignal.timeout(Math.max(1, remaining));
    let executionExpired = () => {
      let error = new Error(
        `Test exceeded ${test.timeout ?? settings.timeout} ms. Check blocked scripts, application startup, or unresolved test work.`
      );
      kinds.set(error, 'timeout');
      controller.abort(error);
    };
    executionDeadline.addEventListener('abort', executionExpired, { once: true });
    if (remaining <= 0) executionExpired();
    send('runtime-ready');
    try {
      for (let scope of test.scopes) {
        entered.push(scope);
        for (let hook of scope.beforeEach) {
          phase = 'beforeEach';
          declaration = hook.declaration;
          await invoke(hook.run, context);
        }
      }
      phase = 'test';
      declaration = test.declaration;
      await invoke(test.run, context);
    } catch (error) {
      recordFailure(error);
    } finally {
      executionDeadline.removeEventListener('abort', executionExpired);
      controller.abort(ended);
      let cleanup = new AbortController();
      let cleanupDeadline = AbortSignal.timeout(settings.cleanupTimeout);
      let cleanupExpired = () => {
        let error = new Error(`Cleanup exceeded ${settings.cleanupTimeout} ms. Remaining hooks were not invoked.`);
        kinds.set(error, 'cleanup');
        cleanup.abort(error);
        activeController.abort(error);
      };
      cleanupDeadline.addEventListener('abort', cleanupExpired, { once: true });
      for (let scope of [...entered].reverse()) {
        if (cleanup.signal.aborted) break;
        for (let hook of scope.afterEach) {
          if (cleanup.signal.aborted) break;
          let hookController = new AbortController();
          activeController = hookController;
          let signal = AbortSignal.any([hookController.signal, cleanup.signal]);
          phase = 'afterEach';
          declaration = hook.declaration;
          try {
            await invoke(hook.run, contextFor(signal));
          } catch (error) {
            recordFailure(error);
          } finally {
            hookController.abort(ended);
          }
        }
      }
      let drain = new AbortController();
      activeController = drain;
      try {
        await abortable(checkpoint(), AbortSignal.any([cleanup.signal, drain.signal]));
        if (drain.signal.aborted) throw drain.signal.reason;
      } catch (error) {
        recordFailure(error, 'cleanup');
      }
      cleanupDeadline.removeEventListener('abort', cleanupExpired);
      finished = true;
      drain.abort(ended);
      restoreConsole();
      try {
        frame.contentWindow.__browserTestBridge?.stopOutput?.();
      } catch {}
      try {
        let location = frame.contentWindow.location;
        send('location', { index, path: location.pathname + location.search + location.hash });
      } catch {}
      collectingOutput = false;
      waiters.clear();
    }
    send('result', {
      index,
      testId: test.id,
      name: test.name,
      duration: performance.now() - started,
      ...failureOutcome(failures),
      output
    });
  } catch (error) {
    send('fatal', { error: serialize(error) });
  }
}
