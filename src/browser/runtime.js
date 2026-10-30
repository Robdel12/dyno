import { getSuite } from './registry.js';
import { failureRecord, failureOutcome } from '../failures.js';
import { testDescriptor } from '../suite.js';
import { createApp } from './app.js';
import { createInteractor } from './interactor.js';
import { captureConsole } from './console.js';
import { createTimings } from './timings.js';

let serialize = (error) => ({ message: error?.message ?? String(error), stack: error?.stack });
export async function boot() {
  let parameters = new URLSearchParams(location.search);
  let runId = parameters.get('run');
  let executionId = parameters.get('execution');
  let send = (kind, data = {}) =>
    parent.postMessage({ channel: 'dyno', runId, executionId, kind, ...data }, location.origin);
  try {
    let settings = await fetch(`/__dyno__/settings?run=${encodeURIComponent(runId)}`).then(
      (response) => response.json(),
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
    if (test.skipReason)
      throw new Error(`Test selection changed after discovery: ${test.skipReason}`);
    let timings = createTimings();
    let steps = new Set();
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
      let failurePhase = kinds.get(error) ?? fallback;
      failurePhase =
        failurePhase === 'reset'
          ? 'beforeEach'
          : failurePhase === 'drain'
            ? 'cleanup'
            : failurePhase;
      failures = [...failures, failureRecord(error, failurePhase, location)];
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
    let appWindow = parent.opener;
    if (!appWindow || appWindow.closed || parent.__dynoController?.runId !== runId)
      throw new Error('The application window is unavailable. Reopen the Dyno execution URL.');
    window.__dynoRuntimeBinding = Object.freeze({ runId, executionId });
    parent.__dynoAppRuntime = window;
    let state = Object.freeze({ readyDocument: null, readyId: null, expectedName: null });
    let waiters = new Set();
    let fail = (error, kind = phase) => {
      if (finished || error === ended || (error && typeof error === 'object' && seen.has(error)))
        return;
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
      if (
        event.origin !== location.origin ||
        event.source !== appWindow ||
        message?.channel !== 'dyno'
      )
        return;
      if (
        message.runId !== runId ||
        message.executionId !== executionId ||
        message.name !== state.expectedName
      )
        return;
      if (message.kind === 'app-unloading') {
        if (message.id === state.readyId) {
          state = Object.freeze({ ...state, readyDocument: null });
          send('context', { documentId: null });
        }
        return;
      }
      if (appWindow.__browserTestBridge?.id !== message.id) return;
      if (message.kind === 'inspect') send('inspect');
      if (message.kind === 'app-output') record('app', message.entries);
      if (message.kind === 'app-error') {
        let error = new Error(message.error.message);
        error.stack = message.error.stack ?? error.stack;
        fail(error, 'app');
      }
      if (message.kind === 'app-ready' && appWindow.__browserTestBridge?.id === message.id) {
        state = Object.freeze({ ...state, readyDocument: appWindow.document, readyId: message.id });
        try {
          appWindow.focus();
        } catch {}
        send('context', { documentId: message.id });
        send('location', {
          index,
          path: appWindow.location.pathname + appWindow.location.search + appWindow.location.hash,
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
    let navigate = async (path, signal, internal = false) => {
      let target = new URL(path, location.origin);
      if (
        target.origin !== location.origin ||
        (!internal && target.pathname.startsWith('/__dyno__/'))
      )
        throw new Error('app.goto requires an app path on the gateway origin.');
      signal.throwIfAborted();
      let current;
      try {
        if (
          state.readyDocument === appWindow.document &&
          state.readyId === appWindow.__browserTestBridge?.id
        )
          current = new URL(appWindow.location.href);
      } catch {}
      if (
        current &&
        current.pathname === target.pathname &&
        current.search === target.search &&
        current.hash !== target.hash
      ) {
        let changed;
        let ready = new Promise((resolve) => {
          changed = (event) => {
            if (event.newURL === target.href) resolve();
          };
          appWindow.addEventListener('hashchange', changed);
        });
        try {
          appWindow.location.replace(target.href);
          await abortable(ready, signal);
          send('location', { index, path: target.pathname + target.search + target.hash });
        } finally {
          appWindow.removeEventListener('hashchange', changed);
        }
        return;
      }
      state = Object.freeze({
        readyDocument: null,
        readyId: null,
        expectedName: `dyno-${runId}-${index}-${[...crypto.getRandomValues(new Uint32Array(2))].join('-')}`,
      });
      send('context', { documentId: null });
      appWindow.name = JSON.stringify({
        dyno: 1,
        controller: parent.name,
        runId,
        executionId,
        appName: state.expectedName,
      });
      let resolveReady;
      let ready = new Promise((resolve) => {
        resolveReady = resolve;
        waiters.add(resolve);
      });
      send('location', { index, path: target.pathname + target.search + target.hash });
      if (current?.href === target.href) appWindow.location.reload();
      else appWindow.location.replace(target.href);
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
        request.reject(
          Object.assign(new Error(message.error.message), { stack: message.error.stack }),
        );
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
        detach: () => signal.removeEventListener('abort', aborted),
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
      if ([...steps].some((step) => step.signal === signal))
        throw new Error('Await step() before finishing a test or hook.');
      if (debugResume) throw new Error('Await app.pause() before finishing the test.');
      if ([...pending.values()].some((request) => request.signal === signal))
        throw new Error(
          'Await app.screenshot(), app.setViewport(), and native browser operations before finishing a test or hook.',
        );
    };
    let debugResume;
    let executionDeadline;
    let budgetEnds;
    let pause = async (message = 'Inspect the application, then continue.') => {
      if (phase === 'afterEach')
        throw new Error('app.pause() is available during setup or the test, before cleanup.');
      controller.signal.throwIfAborted();
      if (debugResume) throw new Error('Await app.pause() before pausing again.');
      if (!settings.interactive)
        throw new Error('app.pause() requires --ui or --manual. Remove it from headless tests.');
      if (typeof message !== 'string') throw new Error('app.pause() needs a message string.');
      let remaining = Math.max(1, budgetEnds - performance.now());
      executionDeadline.removeEventListener('abort', executionExpired);
      let continuation = Promise.withResolvers();
      debugResume = continuation.resolve;
      send('debug-paused', { message, remaining });
      try {
        await abortable(continuation.promise, controller.signal);
      } finally {
        debugResume = undefined;
        if (!controller.signal.aborted) armDeadline(remaining);
      }
    };
    window.addEventListener('message', (event) => {
      let message = event.data;
      if (
        event.origin === location.origin &&
        event.source === parent &&
        message?.channel === 'dyno' &&
        message.runId === runId &&
        message.executionId === executionId &&
        message.kind === 'debug-continue'
      )
        debugResume?.();
    });
    let contextFor = (signal) => {
      let app = createApp(
        appWindow,
        () => state,
        signal,
        (path) => navigate(path, signal),
        (input, prepare, select) => operation(input, prepare, select, signal),
        pause,
        Boolean(parent.__dynoController?.capabilities?.screenshot),
        (kind, name, work) => timings.measure(kind, name, work, { signal, phase }),
        parent.__dynoController?.capabilities?.native,
      );
      let step = (name, work) => {
        signal.throwIfAborted();
        if (
          typeof name !== 'string' ||
          !name.trim() ||
          name.length > 200 ||
          typeof work !== 'function'
        )
          throw new Error('step() needs a name (1–200 characters) and a callback.');
        let running = { signal };
        steps.add(running);
        let result = timings.measure(
          'step',
          name,
          () => {
            let value = work();
            if (value && typeof value.next === 'function')
              throw new Error(
                'step() callbacks must use ordinary or async functions, not generators.',
              );
            return value;
          },
          { signal, phase },
        );
        result.then(
          () => steps.delete(running),
          () => steps.delete(running),
        );
        return result;
      };
      return Object.freeze({
        app,
        step,
        I: createInteractor(app, signal, settings.expectTimeout),
        signal,
        fixtures: settings.fixtures,
        test: testDescriptor(test),
      });
    };
    let invoke = async (run, context) => {
      context.signal.throwIfAborted();
      let result = run(context);
      if (result && typeof result.next === 'function')
        throw new Error(
          'Test callbacks and hooks must use ordinary or async functions, not generators.',
        );
      await abortable(result, context.signal);
      requireFinishedOperations(context.signal);
      context.signal.throwIfAborted();
    };
    let entered = [];
    let beforeEachNumber = 0;
    let afterEachNumber = 0;
    let context = contextFor(controller.signal);
    let remaining = Number(parameters.get('deadline')) - Date.now();

    let executionExpired = () => {
      let error = new Error(
        `Test exceeded ${test.timeout ?? settings.timeout} ms. Check blocked scripts, application startup, or unresolved test work.`,
      );
      kinds.set(error, 'timeout');
      controller.abort(error);
    };
    let armDeadline = (remaining) => {
      budgetEnds = performance.now() + remaining;
      executionDeadline = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
      executionDeadline.addEventListener('abort', executionExpired, { once: true });
    };
    armDeadline(remaining);
    if (remaining <= 0) executionExpired();
    send('runtime-ready');
    try {
      phase = 'reset';
      await timings.measure(
        'reset',
        'Fresh app document',
        () => navigate('/__dyno__/blank', controller.signal, true),
        { signal: controller.signal },
      );
      for (let scope of test.scopes) {
        entered.push(scope);
        for (let hook of scope.beforeEach) {
          phase = 'beforeEach';
          declaration = hook.declaration;
          await timings.measure(
            'beforeEach',
            `${hook.run.name || 'beforeEach'} #${++beforeEachNumber}`,
            () => invoke(hook.run, context),
            { signal: controller.signal, phase },
          );
        }
      }
      phase = 'test';
      declaration = test.declaration;
      await timings.measure('test', 'Test body', () => invoke(test.run, context), {
        signal: controller.signal,
      });
    } catch (error) {
      recordFailure(error);
    } finally {
      executionDeadline.removeEventListener('abort', executionExpired);
      controller.abort(ended);
      let cleanup = new AbortController();
      let cleanupDeadline = AbortSignal.timeout(settings.cleanupTimeout);
      let cleanupExpired = () => {
        let error = new Error(
          `Cleanup exceeded ${settings.cleanupTimeout} ms. Remaining hooks were not invoked.`,
        );
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
            await timings.measure(
              'afterEach',
              `${hook.run.name || 'afterEach'} #${++afterEachNumber}`,
              () => invoke(hook.run, contextFor(signal)),
              { signal, phase },
            );
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
        phase = 'drain';
        await timings.measure('drain', 'Deliver queued app errors', () => checkpoint(), {
          signal: AbortSignal.any([cleanup.signal, drain.signal]),
        });
        if (drain.signal.aborted) throw drain.signal.reason;
      } catch (error) {
        recordFailure(error, 'cleanup');
      }
      cleanupDeadline.removeEventListener('abort', cleanupExpired);
      finished = true;
      drain.abort(ended);
      restoreConsole();
      try {
        appWindow.__browserTestBridge?.stopOutput?.();
      } catch {}
      try {
        let location = appWindow.location;
        send('location', { index, path: location.pathname + location.search + location.hash });
      } catch {}
      collectingOutput = false;
      waiters.clear();
    }
    let measured = timings.end();
    send('result', {
      index,
      testId: test.id,
      name: test.name,
      duration: measured.duration,
      timings: measured,
      ...failureOutcome(failures),
      output,
    });
  } catch (error) {
    send('fatal', { error: serialize(error) });
  }
}
