import { createExecution, transition } from './execution.js';
import { normalizeViewport } from './viewport.js';
import { selectTests } from './suite-model.js';

let root = '/__dyno__/';
let id = () => [...crypto.getRandomValues(new Uint32Array(4))].join('-');
let serialized = (error) => ({
  message: error?.message ?? String(error),
  stack: error?.stack,
  phase: error?.phase ?? 'runtime'
});
let state = createExecution({ width: 1280, height: 800 });
let controller = new AbortController();
let runId, connectionKey, settings, resource, resume, stream, stoppingReason;
let contextSync = Promise.resolve();
let operationQueue = Promise.resolve();
let reporter = document.getElementById('reporter');
let execution = document.getElementById('execution');
let inspect = document.getElementById('inspect');
let latestView, publishing;
let post = async (route, input = {}, signal) => {
  let response = await fetch(root + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, connectionKey, ...input }),
    signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])])
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
let publish = () => {
  let view = {
    ...state,
    runId,
    hasApp: Boolean(resource?.frame.isConnected),
    identity: settings?.identity,
    capabilities: settings?.capabilities
  };
  reporter.contentWindow?.postMessage({ channel: 'dyno-reporter', kind: 'snapshot', runId, view }, location.origin);
  latestView = view;
  publishing ??= (async () => {
    try {
      while (latestView) {
        let view = latestView;
        latestView = undefined;
        await post('view', { view });
      }
    } catch (error) {
      console.error('Reporter connection:', error.message);
    } finally {
      publishing = undefined;
    }
  })();
};
let update = (event) => {
  state = transition(state, event);
  Object.assign(execution.style, {
    width: state.viewportMode === 'browser' ? '100vw' : `${state.viewport.width}px`,
    height: state.viewportMode === 'browser' ? '100vh' : `${state.viewport.height}px`
  });
  let active = ['connecting', 'discovering', 'running', 'pausing', 'resuming'].includes(state.phase);
  let visible = !active && state.presentation === 'reporter';
  let opening = reporter.hidden && visible;
  reporter.hidden = !visible;
  execution.inert = visible;
  execution.setAttribute('aria-hidden', String(visible));
  inspect.hidden = active || visible || !state.interactive;
  if (opening) reporter.contentWindow?.postMessage({ channel: 'dyno-reporter', kind: 'focus', runId }, location.origin);
  document.title = `${state.phase === 'completed' ? 'Test results' : state.phase === 'paused' ? 'Paused' : state.phase === 'pausing' ? 'Pausing after this test' : 'Running tests'} — Dyno`;
  if (runId) publish();
};
let paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
let context = (current) =>
  current
    ? { executionId: current.id, documentId: current.documentId, revision: state.revision, ...state.viewport }
    : null;
let syncContext = (current) => {
  let value = context(current);
  contextSync = contextSync.catch(() => {}).then(() => post('context', { context: value }));
  return contextSync;
};
let assertCurrent = (current, documentId, revision, metrics) => {
  controller.signal.throwIfAborted();
  let app = current.frame.contentDocument?.querySelector('iframe');
  if (
    resource !== current ||
    current.finished ||
    !current.frame.isConnected ||
    app?.contentWindow.__browserTestBridge?.id !== documentId ||
    current.documentId !== documentId ||
    state.revision !== revision ||
    (metrics &&
      (innerWidth !== metrics.hostWidth ||
        innerHeight !== metrics.hostHeight ||
        devicePixelRatio !== metrics.pixelRatio))
  )
    throw new Error('App navigated or its viewport changed before screenshot completed. No attachment was accepted.');
  if (!reporter.hidden || !inspect.hidden) throw new Error('Close the reporter before taking a test screenshot.');
};
async function sizeViewport(viewport, current = resource, mode = 'fixed', signal) {
  current ??= null;
  let assertOwner = () => {
    controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    if ((resource ?? null) !== current || (current && !current.frame.isConnected))
      throw new Error('This inspection context has ended.');
  };
  assertOwner();
  viewport = mode === 'browser' ? Object.freeze({ ...viewport }) : normalizeViewport(viewport);
  if (settings.capabilities.hostViewport && (innerWidth !== viewport.width || innerHeight !== viewport.height)) {
    await post(
      'operations',
      { operation: 'resize', viewport, current: { width: innerWidth, height: innerHeight } },
      controller.signal
    );
    await paint();
    // Browser chrome can change height when the window crosses its minimum width.
    // Correct once from the observed viewport, rather than treating an OS rect as CSS size.
    if (innerWidth < viewport.width || innerHeight < viewport.height) {
      await post(
        'operations',
        { operation: 'resize', viewport, current: { width: innerWidth, height: innerHeight } },
        controller.signal
      );
      await paint();
    }
    if (innerWidth < viewport.width || innerHeight < viewport.height)
      throw new Error(
        `Browser viewport ${innerWidth} × ${innerHeight} cannot fit the requested ${viewport.width} × ${viewport.height} app viewport.`
      );
  }
  assertOwner();
  update({ type: 'viewport.changed', viewport, mode });
  await paint();
  assertOwner();
  await syncContext(current);
}
async function operate(current, message) {
  let result;
  let request = new AbortController();
  let signal = AbortSignal.any([controller.signal, request.signal]);
  current.operations.set(message.requestId, request);
  try {
    if (current.canceled.has(message.requestId)) request.abort(new Error('Operation cancelled.'));
    signal.throwIfAborted();
    if (resource !== current || current.finished || message.executionId !== current.id)
      throw new Error('This test execution has ended.');
    if (message.operation === 'viewport') {
      await sizeViewport(message.viewport, current, 'fixed', signal);
      result = { viewport: state.viewport, revision: state.revision };
    } else if (message.operation === 'screenshot') {
      await contextSync;
      let revision = state.revision;
      assertCurrent(current, message.documentId, revision);
      let app = current.frame.contentDocument.querySelector('iframe');
      let box = current.frame.getBoundingClientRect();
      if (
        box.x !== 0 ||
        box.y !== 0 ||
        box.width !== state.viewport.width ||
        box.height !== state.viewport.height ||
        app.contentWindow.innerWidth !== state.viewport.width ||
        app.contentWindow.innerHeight !== state.viewport.height
      )
        throw new Error('Screenshot requires the app at its unscaled viewport origin.');
      let metrics = { ...state.viewport, hostWidth: innerWidth, hostHeight: innerHeight, pixelRatio: devicePixelRatio };
      let staged;
      try {
        staged = await post(
          'operations',
          {
            operation: 'screenshot',
            requestId: message.requestId,
            name: message.name,
            optional: message.optional,
            context: context(current),
            metrics
          },
          signal
        );
        signal.throwIfAborted();
        assertCurrent(current, message.documentId, revision, metrics);
        result = staged.status === 'skipped' ? staged : await post('attachments/commit', { id: staged.id }, signal);
        signal.throwIfAborted();
        assertCurrent(current, message.documentId, revision, metrics);
      } catch (error) {
        if (staged?.id) await post('attachments/discard', { id: staged.id }).catch(() => {});
        throw error;
      }
    } else throw new Error('Unknown app operation.');
    signal.throwIfAborted();
    current.frame.contentWindow.postMessage(
      {
        channel: 'dyno',
        runId,
        kind: 'operation-result',
        executionId: current.id,
        requestId: message.requestId,
        result
      },
      location.origin
    );
  } catch (error) {
    current.frame.contentWindow?.postMessage(
      {
        channel: 'dyno',
        runId,
        kind: 'operation-result',
        executionId: current.id,
        requestId: message.requestId,
        error: serialized(error)
      },
      location.origin
    );
  } finally {
    current.operations.delete(message.requestId);
  }
}
let rerun = (ids) => {
  let url = new URL(location.href);
  url.search = '';
  url.hash = '';
  for (let id of ids) url.searchParams.append('id', id);
  history.replaceState(null, '', url);
  location.reload();
};
function command(input) {
  if (input.command === 'reload') location.reload();
  else if (input.command === 'stop') {
    stoppingReason ??= new Error('Run stopped from the reporter.');
    if (resource && !resource.finished && resource.ready) resource.cancel(stoppingReason);
    else controller.abort(stoppingReason);
  } else if (input.command === 'pause') update({ type: 'pause.requested' });
  else if (input.command === 'inspect') update({ type: 'reporter.requested' });
  else if (input.command === 'show-app') {
    update({ type: 'app.requested' });
    resource?.frame.contentDocument?.querySelector('iframe')?.contentWindow.focus();
  } else if (input.command === 'continue' && state.phase === 'debugging') {
    update({ type: 'debug.continued' });
    return paint().then(() => resource?.continueDebug());
  } else if (input.command === 'continue' && state.phase === 'paused') {
    let continuation = resume;
    update({ type: 'continue.requested' });
    operationQueue = operationQueue.then(() => {
      if (resume === continuation && state.phase === 'resuming') continuation?.();
    });
  } else if (input.command === 'rerun') rerun(input.ids);
  else if (input.command === 'pause-on-failure') {
    update({ type: 'preferences.changed', pauseOnFailure: Boolean(input.value) });
    try {
      localStorage.setItem('dyno:pause-on-failure', String(state.pauseOnFailure));
    } catch {}
  } else if (input.command === 'viewport' && ['paused', 'completed', 'debugging'].includes(state.phase)) {
    let current = resource;
    operationQueue = operationQueue.then(() => sizeViewport(input.viewport, current));
    let work = operationQueue;
    operationQueue = work.catch(() => {});
    return work;
  }
}
let dispatchCommand = async (input) => {
  let error;
  try {
    await command(input);
  } catch (failure) {
    error = serialized(failure);
  }
  let result = { requestId: input.requestId, error };
  reporter.contentWindow?.postMessage(
    { channel: 'dyno-reporter', kind: 'command-result', runId, ...result },
    location.origin
  );
  if (input.requestId) await post('command-result', result).catch(() => {});
};
window.addEventListener('message', (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== reporter.contentWindow ||
    event.data?.channel !== 'dyno-reporter'
  )
    return;
  if (event.data.kind === 'ready') {
    if (runId) publish();
    if (!reporter.hidden)
      reporter.contentWindow.postMessage({ channel: 'dyno-reporter', kind: 'focus', runId }, location.origin);
  }
  if (event.data.kind === 'command' && event.data.runId === runId) void dispatchCommand(event.data);
});
window.addEventListener('resize', () => {
  if (controller.signal.aborted) return;
  update({ type: 'browser.resized', viewport: { width: innerWidth, height: innerHeight } });
  if (runId) void syncContext(resource).catch((error) => console.error(error));
});
inspect.addEventListener('click', () => update({ type: 'reporter.requested' }));
window.addEventListener('hashchange', () => {
  if (location.hash === '#reporter') command({ command: 'inspect' });
});
window.addEventListener('pagehide', () => {
  if (runId && !['completed', 'stopped', 'error'].includes(state.phase))
    navigator.sendBeacon(
      root + 'events',
      JSON.stringify({
        runId,
        connectionKey,
        type: 'fatal',
        error: { message: 'Browser left the test run before completion.' }
      })
    );
});

async function runtime(mode, timeout, index, testId) {
  let frame = document.createElement('iframe');
  frame.title =
    mode === 'discover'
      ? 'Discovering browser tests'
      : `Test runtime: ${state.tests.find((test) => test.index === index)?.name}`;
  frame.hidden = mode === 'discover';
  frame.tabIndex = mode === 'discover' ? -1 : 0;
  let current = {
    frame,
    id: id(),
    documentId: null,
    finished: false,
    ready: false,
    operations: new Map(),
    canceled: new Set(),
    remove: () => frame.remove()
  };
  current.cancel = (error) => {
    if (state.phase === 'debugging') current.watchdog(settings.cleanupTimeout + 1000);
    frame.contentWindow.postMessage(
      { channel: 'dyno', kind: 'cancel', runId, executionId: current.id, error: serialized(error) },
      location.origin
    );
  };
  let executionDeadline = Date.now() + timeout;
  let startup = AbortSignal.timeout(timeout);
  // Allow the runtime to deliver its result after exhausting both execution and cleanup budgets.
  let deadline = AbortSignal.timeout(
    Math.min(2147483647, timeout + (mode === 'test' ? settings.cleanupTimeout + 1000 : 0))
  );
  current.result = new Promise((resolve, reject) => {
    let finish = (error, value) => {
      if (current.finished) return;
      current.finished = true;
      window.removeEventListener('message', receive);
      deadline.removeEventListener('abort', expired);
      startup.removeEventListener('abort', startupExpired);
      controller.signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve(value);
    };
    current.watchdog = (ms) => {
      deadline.removeEventListener('abort', expired);
      deadline = AbortSignal.timeout(Math.min(2147483647, Math.ceil(ms)));
      deadline.addEventListener('abort', expired, { once: true });
    };
    current.continueDebug = () => {
      current.watchdog(current.debugRemaining + settings.cleanupTimeout + 1000);
      frame.contentWindow.postMessage(
        { channel: 'dyno', kind: 'debug-continue', runId, executionId: current.id },
        location.origin
      );
    };
    let receive = (event) => {
      let message = event.data;
      if (
        event.origin !== location.origin ||
        event.source !== frame.contentWindow ||
        message?.channel !== 'dyno' ||
        message.runId !== runId ||
        message.executionId !== current.id
      )
        return;
      if (message.kind === 'output' && message.index === index)
        update({ type: 'test.output', index, entries: message.entries });
      if (message.kind === 'location' && message.index === index)
        update({ type: 'test.location', index, path: message.path });
      if (message.kind === 'context') {
        current.documentId = message.documentId;
        void syncContext(current).catch(() => {});
      }
      if (message.kind === 'runtime-ready') {
        current.ready = true;
        startup.removeEventListener('abort', startupExpired);
      }
      if (message.kind === 'debug-paused') {
        current.debugRemaining = message.remaining;
        deadline.removeEventListener('abort', expired);
        update({ type: 'debug.paused', message: message.message });
      }
      if (message.kind === 'operation-cancel') {
        current.canceled.add(message.requestId);
        current.operations.get(message.requestId)?.abort(new Error('Operation cancelled.'));
        let cancellation = post('operations/cancel', { executionId: current.id, requestId: message.requestId }).catch(
          () => {}
        );
        operationQueue = operationQueue.then(() => cancellation);
      }
      if (message.kind === 'inspect') command({ command: 'inspect' });
      if (message.kind === 'operation') operationQueue = operationQueue.then(() => operate(current, message));
      if (message.kind === 'fatal') {
        let error = new Error(message.error.message);
        error.stack = message.error.stack;
        finish(error);
      }
      if (mode === 'discover' && message.kind === 'discovered') finish(null, message.tests);
      if (mode !== 'discover' && message.kind === 'result') {
        if (message.testId !== testId) finish(new Error('The runtime reported a different test identity.'));
        else {
          if (state.phase === 'debugging') update({ type: 'debug.continued' });
          finish(null, message);
        }
      }
    };
    let expired = () =>
      finish(
        Object.assign(
          new Error(
            `${mode === 'discover' ? 'Test discovery' : 'Test'} exceeded ${timeout} ms. Check app startup, blocked scripts, or unresolved async work. Cleanup did not finish within its budget.`
          ),
          { phase: 'timeout' }
        )
      );
    let startupExpired = () => {
      if (!current.ready) expired();
    };
    let aborted = () => finish(controller.signal.reason);
    window.addEventListener('message', receive);
    deadline.addEventListener('abort', expired, { once: true });
    startup.addEventListener('abort', startupExpired, { once: true });
    controller.signal.addEventListener('abort', aborted, { once: true });
    if (controller.signal.aborted) aborted();
  });
  current.result.catch(() => {});
  resource?.remove();
  resource = current;
  await syncContext(current);
  frame.src = `${root}runtime?run=${encodeURIComponent(runId)}&execution=${current.id}&mode=${mode}&deadline=${executionDeadline}${index === undefined ? '' : `&test=${index}&id=${encodeURIComponent(testId)}`}`;
  execution.append(frame);
  return current;
}
async function paused() {
  let pending = Promise.withResolvers();
  resume = pending.resolve;
  let abort = () => pending.reject(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  update({ type: 'paused' });
  try {
    await pending.promise;
    await paint();
    update({ type: 'continued' });
  } finally {
    resume = undefined;
    controller.signal.removeEventListener('abort', abort);
  }
}
try {
  if (typeof globalThis.AbortSignal?.timeout !== 'function' || typeof globalThis.crypto?.getRandomValues !== 'function')
    throw new Error(
      'This browser needs AbortSignal.timeout and crypto.getRandomValues. Update the browser before running Dyno.'
    );
  let launchKey, previous;
  try {
    let incoming = new URLSearchParams(location.hash.slice(1)).get('launch');
    if (incoming) {
      sessionStorage.setItem('dyno:launch', incoming);
      history.replaceState(null, '', location.pathname + location.search);
    }
    launchKey = sessionStorage.getItem('dyno:launch');
    previous = JSON.parse(sessionStorage.getItem('dyno:previous') ?? 'null');
  } catch {}
  let joined = await post('capture', { launchKey, previous }, controller.signal);
  ({ runId, connectionKey } = joined);
  try {
    sessionStorage.setItem('dyno:previous', JSON.stringify({ runId, connectionKey }));
  } catch {}
  settings = {
    ...(await fetch(root + `settings?run=${encodeURIComponent(runId)}`, { signal: controller.signal }).then(
      (response) => response.json()
    )),
    ...joined
  };
  let viewportMode = settings.viewport || settings.capabilities.hostViewport ? 'fixed' : 'browser';
  let initialViewport =
    settings.viewport ??
    (settings.capabilities.hostViewport ? settings.managedViewport : { width: innerWidth, height: innerHeight });
  let pauseOnFailure = false;
  try {
    pauseOnFailure = localStorage.getItem('dyno:pause-on-failure') === 'true';
  } catch {}
  let identity = settings.identity;
  update({
    type: 'connected',
    settings: {
      files: settings.files,
      interactive: settings.interactive,
      pauseOnFailure,
      appHost: new URL(settings.appURL).host,
      browser: identity
        ? `${identity.name} ${identity.version ?? ''} · ${identity.provider}${identity.build === 'playwright' ? ' build' : ''}`.trim()
        : navigator.userAgent,
      viewport: Object.freeze({ ...initialViewport }),
      viewportMode
    }
  });
  reporter.src = `${root}reporter?run=${encodeURIComponent(runId)}&embedded=1`;
  stream = new EventSource(root + `stream?run=${encodeURIComponent(runId)}&role=host`);
  stream.addEventListener('watch', (event) => update({ type: 'watch.changed', watch: JSON.parse(event.data) }));
  stream.addEventListener('command', (event) => void dispatchCommand(JSON.parse(event.data)));
  let discovery = await runtime('discover', settings.timeout);
  let tests;
  try {
    tests = await discovery.result;
  } finally {
    discovery.remove();
    resource = undefined;
  }
  let selection = new URLSearchParams(location.search);
  if (!tests.length) throw new Error('No tests registered. Use test(name, async ({ app }) => …).');
  tests = selectTests(tests, {
    ids: selection.getAll('id'),
    names: selection.getAll('test'),
    files: selection.getAll('file'),
    suites: selection.getAll('suite')
  });
  await post('events', { type: 'start', tests, userAgent: navigator.userAgent });
  update({ type: 'started', tests });
  let started = performance.now();
  for (let [position, test] of tests.entries()) {
    controller.signal.throwIfAborted();
    if (test.skipReason) {
      let outcome = { status: 'skipped', skipReason: test.skipReason, duration: 0, output: [] };
      await post('events', { type: 'test', testId: test.id, index: position, name: test.name, ...outcome });
      update({ type: 'test.finished', index: test.index, outcome });
      continue;
    }
    resource?.remove();
    resource = undefined;
    await sizeViewport(
      settings.viewport ??
        (settings.capabilities.hostViewport ? settings.managedViewport : { width: innerWidth, height: innerHeight }),
      null,
      viewportMode
    );
    let runner = await runtime('test', test.timeout ?? settings.timeout, test.index, test.id);
    update({ type: 'test.started', index: test.index });
    let outcome;
    try {
      outcome = await runner.result;
    } catch (error) {
      runner.remove();
      controller.signal.throwIfAborted();
      outcome = {
        status: 'failed',
        error: serialized(error),
        output: state.tests.find((item) => item.index === test.index).output
      };
    }
    await operationQueue;
    await syncContext(null);
    let { status, error, additionalErrors = [], duration, output = [] } = outcome;
    let reported = await post('events', {
      type: 'test',
      executionId: runner.id,
      testId: test.id,
      index: position,
      name: test.name,
      status,
      duration,
      error,
      additionalErrors,
      output
    });
    update({
      type: 'test.finished',
      index: test.index,
      outcome: {
        status,
        error: reported.error ?? error,
        additionalErrors: reported.additionalErrors ?? additionalErrors,
        duration,
        output: Object.freeze(output),
        attachments: Object.freeze(reported.attachments ?? [])
      }
    });
    if (stoppingReason) controller.abort(stoppingReason);
    controller.signal.throwIfAborted();
    if (
      state.interactive &&
      position < tests.length - 1 &&
      (state.phase === 'pausing' || (state.pauseOnFailure && status === 'failed'))
    )
      await paused();
  }
  let failed = state.tests.filter((test) => test.status === 'failed').length;
  let skipped = state.tests.filter((test) => test.status === 'skipped').length;
  let duration = performance.now() - started;
  await post('events', { type: 'complete', passed: tests.length - failed - skipped, failed, skipped, duration });
  update({ type: 'completed', duration });
} catch (error) {
  update({ type: 'failed', stopped: controller.signal.aborted, error: error.message });
  await syncContext(null).catch(() => {});
  if (controller.signal.aborted) resource?.remove();
  if (runId) await post('events', { type: 'fatal', error: serialized(error) }).catch(() => {});
  if (!reporter.getAttribute('src')) {
    let notice = document.getElementById('host-error');
    notice.hidden = false;
    notice.textContent = error.message;
  }
}
