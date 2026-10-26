import { suite, createApp } from './index.js';
import { createInteractor } from './interactor.js';

let serialize = error => ({ message: error?.message ?? String(error), stack: error?.stack });
export async function boot() {
  let parameters = new URLSearchParams(location.search);
  let runId = parameters.get('run');
  let send = (kind, data = {}) => parent.postMessage({ channel: 'dyno', runId, kind, ...data }, location.origin);
  try {
    if (parameters.get('mode') === 'discover') {
      send('discovered', { tests: suite.tests.map(({ name, timeout }, index) => ({ name, timeout, index })) });
      return;
    }
    let index = Number(parameters.get('test'));
    let test = suite.tests[index];
    if (!test) throw new Error(`Unknown test index ${index}`);
    let settings = await fetch('/__dyno__/settings').then(response => response.json());
    let controller = new AbortController();
    let frame = document.createElement('iframe');
    frame.title = 'App under test';
    document.body.append(frame);
    let state = { readyDocument: null, readyId: null, expectedName: null };
    let waiters = new Set();
    let fail = error => { if (!controller.signal.aborted) controller.abort(error); };
    let checkpoint = () => new Promise(resolve => {
      let marker = `${runId}-${index}-completion`;
      let receive = event => {
        if (event.source !== window || event.data?.checkpoint !== marker) return;
        window.removeEventListener('message', receive);
        resolve();
      };
      window.addEventListener('message', receive);
      // Cross one posted-message turn so already queued app errors reach the runner.
      window.postMessage({ checkpoint: marker }, location.origin);
    });
    let receive = event => {
      let message = event.data;
      if (event.origin !== location.origin || event.source !== frame.contentWindow || message?.channel !== 'dyno') return;
      if (message.name !== state.expectedName) return;
      if (message.kind === 'app-unloading') {
        if (message.id === state.readyId) state.readyDocument = null;
        return;
      }
      if (frame.contentWindow.__browserTestBridge?.id !== message.id) return;
      if (message.kind === 'app-error') {
        let error = new Error(message.error.message);
        error.stack = message.error.stack ?? error.stack;
        fail(error);
      }
      if (message.kind === 'app-ready' && frame.contentWindow.__browserTestBridge?.id === message.id) {
        state.readyDocument = frame.contentDocument;
        state.readyId = message.id;
        frame.contentWindow.addEventListener('error', event => fail(event.error ?? new Error(event.message)));
        frame.contentWindow.addEventListener('unhandledrejection', event => fail(event.reason ?? new Error('Unhandled app rejection')));
        for (let resolve of waiters) resolve();
      }
    };
    window.addEventListener('message', receive);
    window.addEventListener('error', event => fail(event.error ?? new Error(event.message)));
    window.addEventListener('unhandledrejection', event => fail(event.reason ?? new Error('Unhandled rejection')));
    let abortable = promise => new Promise((resolve, reject) => {
      let aborted = () => reject(controller.signal.reason);
      if (controller.signal.aborted) return aborted();
      controller.signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
    });
    let navigate = async path => {
      let target = new URL(path, location.origin);
      if (target.origin !== location.origin || target.pathname.startsWith('/__dyno__/')) throw new Error('app.goto requires an app path on the gateway origin.');
      controller.signal.throwIfAborted();
      state.readyDocument = null;
      state.readyId = null;
      state.expectedName = `dyno-${runId}-${index}-${[...crypto.getRandomValues(new Uint32Array(2))].join('-')}`;
      frame.name = state.expectedName;
      frame.contentWindow.name = state.expectedName;
      let ready = new Promise(resolve => waiters.add(resolve));
      frame.src = target.href;
      try { await abortable(ready); } finally { waiters.clear(); }
    };
    let app = createApp(frame, state, controller.signal, navigate);
    let I = createInteractor(app, controller.signal, settings.expectTimeout);
    let context = { app, I, signal: controller.signal, fixtures: settings.fixtures };
    let started = performance.now();
    let outcome;
    try {
      for (let hook of suite.beforeEach) await abortable(hook(context));
      await abortable(test.run(context));
      controller.signal.throwIfAborted();
      outcome = { status: 'passed' };
    } catch (error) { outcome = { status: 'failed', error: serialize(error) }; }
    finally {
      for (let hook of suite.afterEach) {
        try { await abortable(hook(context)); }
        catch (error) { outcome = { status: 'failed', error: serialize(error) }; }
      }
      try {
        await abortable(checkpoint());
        controller.signal.throwIfAborted();
      } catch (error) { if (outcome.status === 'passed') outcome = { status: 'failed', error: serialize(error) }; }
      controller.abort(new Error('Test finished'));
      waiters.clear();
    }
    send('result', { index, name: test.name, duration: performance.now() - started, ...outcome });
  } catch (error) { send('fatal', { error: serialize(error) }); }
}
