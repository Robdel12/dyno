import { createReporter, selectedTest, testOutput } from './reporter.js';

let root = '/__dyno__/';
let serialized = error => ({ message: error?.message ?? String(error), stack: error?.stack });
let frames = new Map();
let controller = new AbortController();
let runId;
let resume;
let savedPause = false;
try { savedPause = localStorage.getItem('dyno:pause-on-failure') === 'true'; } catch {}
let state = Object.freeze({ phase: 'connecting', tests: [], current: null, selected: null, files: [], appHost: '', browser: '', query: '', filter: 'all', error: null, duration: null, interactive: false, pauseOnFailure: savedPause });
let pendingPaint;
let update = (patch, defer = false) => {
  state = Object.freeze({ ...state, ...patch });
  if (defer) {
    pendingPaint ??= requestAnimationFrame(() => { pendingPaint = undefined; render(state, frames); });
  } else {
    if (pendingPaint !== undefined) cancelAnimationFrame(pendingPaint);
    pendingPaint = undefined;
    render(state, frames);
  }
};
let updateTest = (index, patch, defer = false) => update({ tests: state.tests.map(test => test.index === index ? Object.freeze({ ...test, ...patch }) : test) }, defer);
let rerun = names => {
  let url = new URL(location.pathname, location.origin);
  for (let name of names) url.searchParams.append('test', name);
  location.href = url.href;
};
let render = createReporter({
  rerun,
  runFailed: () => rerun(state.tests.filter(test => test.status === 'failed').map(test => test.name)),
  runSelected: () => { let test = selectedTest(state); if (test) rerun([test.name]); },
  select: index => update({ selected: index }),
  search: query => update({ query }), filter: filter => update({ filter }),
  pause: () => update({ phase: state.phase === 'pausing' ? 'running' : 'pausing' }),
  resume: () => resume?.(),
  stop: () => controller.abort(new Error('Run stopped from the reporter.')),
  pauseOnFailure: pauseOnFailure => {
    update({ pauseOnFailure });
    try { localStorage.setItem('dyno:pause-on-failure', String(pauseOnFailure)); } catch {}
  },
  copy: () => testOutput(selectedTest(state))
});
render(state, frames);
window.addEventListener('pagehide', () => {
  if (runId && !['completed', 'stopped', 'error'].includes(state.phase)) navigator.sendBeacon(root + 'events', JSON.stringify({ runId, type: 'fatal', error: { message: 'Browser left the test run before completion.' } }));
});
let post = async event => {
  let response = await fetch(root + 'events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId, ...event }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Reporter failed: ${response.status} ${await response.text()}`);
  return response.json();
};

function runtime(mode, timeout, index) {
  let frame = document.createElement('iframe');
  frame.title = mode === 'discover' ? 'Discovering browser tests' : `Test runtime: ${state.tests.find(test => test.index === index)?.name}`;
  frame.hidden = mode === 'discover';
  let deadline = AbortSignal.timeout(timeout);
  let result = new Promise((resolve, reject) => {
    let finish = (error, value) => {
      window.removeEventListener('message', receive);
      deadline.removeEventListener('abort', expired);
      controller.signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve(value);
    };
    let receive = event => {
      let message = event.data;
      if (event.origin !== location.origin || event.source !== frame.contentWindow || message?.channel !== 'dyno' || message.runId !== runId) return;
      if (message.kind === 'output' && message.index === index) {
        let test = state.tests.find(test => test.index === index);
        if (test && test.output.length < 100) updateTest(index, { output: [...test.output, ...message.entries].slice(0, 100) }, true);
      }
      if (message.kind === 'location' && message.index === index) updateTest(index, { path: message.path });
      if (message.kind === 'fatal') {
        let error = new Error(message.error.message); error.stack = message.error.stack ?? error.stack;
        finish(error);
      }
      if (mode === 'discover' && message.kind === 'discovered') finish(null, message.tests);
      if (mode !== 'discover' && message.kind === 'result' && message.index === index) finish(null, message);
    };
    let expired = () => finish(new Error(`${mode === 'discover' ? 'Test discovery' : 'Test'} exceeded ${timeout} ms. Check app startup, blocked scripts, or unresolved async work.`));
    let aborted = () => finish(controller.signal.reason);
    window.addEventListener('message', receive);
    deadline.addEventListener('abort', expired, { once: true });
    controller.signal.addEventListener('abort', aborted, { once: true });
    if (controller.signal.aborted) aborted();
  });
  frame.src = `${root}runtime?run=${encodeURIComponent(runId)}&mode=${mode}${index === undefined ? '' : `&test=${index}`}`;
  document.querySelector('#frame').append(frame);
  return { frame, result, remove: () => frame.remove() };
}

function retain(index, runner) {
  // Moving on disposes the previous app, including its timers and pending work.
  for (let resource of frames.values()) resource.remove();
  frames.clear(); frames.set(index, runner);
}

async function paused() {
  let { promise, resolve, reject } = Promise.withResolvers();
  let aborted = () => reject(controller.signal.reason);
  resume = resolve;
  controller.signal.addEventListener('abort', aborted, { once: true });
  update({ phase: 'paused' });
  try { await promise; update({ phase: 'running', selected: null }); }
  finally { resume = undefined; controller.signal.removeEventListener('abort', aborted); }
}

try {
  if (typeof globalThis.AbortSignal?.timeout !== 'function' || typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('This browser needs AbortSignal.timeout and crypto.getRandomValues. Update the browser before running Dyno.');
  let capture = await fetch(root + 'capture', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
  if (!capture.ok) throw new Error(await capture.text());
  ({ runId } = await capture.json());
  let settings = await fetch(root + `settings?run=${encodeURIComponent(runId)}`, { signal: controller.signal }).then(response => response.json());
  let agent = navigator.userAgent.match(/(?:Edg|Firefox|Chrome)\/([\d.]+)/);
  let browser = agent ? `${agent[0].startsWith('Edg') ? 'Edge' : agent[0].split('/')[0]} ${agent[1]}` : navigator.userAgent;
  update({ phase: 'discovering', files: settings.files, interactive: settings.interactive, appHost: new URL(settings.appURL).host, browser });
  let discovery = runtime('discover', settings.timeout);
  let tests;
  try { tests = await discovery.result; } finally { discovery.remove(); }
  let selected = new URLSearchParams(location.search).getAll('test');
  if (selected.length) tests = tests.filter(test => selected.includes(test.name));
  if (!tests.length) throw new Error(selected.length ? `No test named "${selected.join('", "')}". --test uses an exact name.` : 'No tests registered. Use test(name, async ({ app }) => …).');
  await post({ type: 'start', tests: tests.map(test => test.name), userAgent: navigator.userAgent });
  update({ phase: 'running', tests: tests.map(test => Object.freeze({ ...test, status: 'pending', output: [] })) });
  let started = performance.now();
  for (let [position, test] of tests.entries()) {
    controller.signal.throwIfAborted();
    let runner = runtime('test', test.timeout ?? settings.timeout, test.index);
    retain(test.index, runner);
    update({ current: test.index }); updateTest(test.index, { status: 'running' });
    let outcome;
    try { outcome = await runner.result; }
    catch (error) {
      runner.remove(); frames.delete(test.index);
      controller.signal.throwIfAborted();
      outcome = { index: test.index, name: test.name, status: 'failed', error: serialized(error), output: state.tests.find(item => item.index === test.index).output };
    }
    let { status, error, duration, name, output = [] } = outcome;
    let reported = await post({ type: 'test', index: position, name, status, duration, error, output });
    updateTest(test.index, { status, error: reported.error ?? error, duration, output });
    controller.signal.throwIfAborted();
    if (state.interactive && position < tests.length - 1 && (state.phase === 'pausing' || (state.pauseOnFailure && status === 'failed'))) {
      update({ selected: test.index }); await paused();
    }
  }
  let failed = state.tests.filter(test => test.status === 'failed').length;
  let summary = { type: 'complete', passed: tests.length - failed, failed, duration: performance.now() - started };
  await post(summary);
  update({ phase: 'completed', duration: summary.duration });
  document.title = `${failed ? 'FAIL' : 'PASS'} — Dyno`;
} catch (error) {
  update({ phase: controller.signal.aborted ? 'stopped' : 'error', error: error.message, tests: state.tests.map(test => test.status === 'running' ? { ...test, status: 'stopped' } : test) });
  document.title = controller.signal.aborted ? 'Stopped — Dyno' : 'FAIL — Dyno';
  if (runId) await post({ type: 'fatal', error: serialized(error) }).catch(() => {});
}
