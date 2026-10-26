let root = '/__dyno__/';
let status = document.querySelector('#status');
let list = document.querySelector('#results');
let area = document.querySelector('#frame');
let serialized = error => ({ message: error?.message ?? String(error), stack: error?.stack });
let runId;
let events = [];
let post = async event => {
  let response = await fetch(root + 'events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId, ...event }) });
  if (!response.ok) throw new Error(`Reporter failed: ${response.status} ${await response.text()}`);
  return response.json();
};
function runtime(mode, timeout, index) {
  let frame = document.createElement('iframe');
  frame.title = mode === 'discover' ? 'Discovering browser tests' : 'Dyno test runtime';
  let deadline = AbortSignal.timeout(timeout);
  let result = new Promise((resolve, reject) => {
    let finish = (error, value) => {
      window.removeEventListener('message', receive);
      deadline.removeEventListener('abort', expired);
      error ? reject(error) : resolve(value);
    };
    let receive = event => {
      let message = event.data;
      if (event.origin !== location.origin || event.source !== frame.contentWindow || message?.channel !== 'dyno' || message.runId !== runId) return;
      if (message.kind === 'fatal') {
        let error = new Error(message.error.message);
        error.stack = message.error.stack ?? error.stack;
        finish(error);
      }
      if (mode === 'discover' && message.kind === 'discovered') finish(null, message.tests);
      if (mode !== 'discover' && message.kind === 'result' && message.index === index) finish(null, message);
    };
    let expired = () => finish(new Error(`${mode === 'discover' ? 'Test discovery' : 'Test'} exceeded ${timeout} ms. Check app startup, blocked scripts, or unresolved async work.`));
    window.addEventListener('message', receive);
    deadline.addEventListener('abort', expired, { once: true });
  });
  frame.src = `${root}runtime?run=${encodeURIComponent(runId)}&mode=${mode}${index === undefined ? '' : `&test=${index}`}`;
  area.replaceChildren(frame);
  return { result, remove: () => frame.remove() };
}
try {
  if (typeof AbortSignal.timeout !== 'function' || typeof crypto?.getRandomValues !== 'function') throw new Error('This browser needs AbortSignal.timeout and crypto.getRandomValues to run this framework.');
  let settings = await fetch(root + 'settings').then(response => response.json());
  let capture = await fetch(root + 'capture', { method: 'POST' });
  if (!capture.ok) throw new Error(await capture.text());
  ({ runId } = await capture.json());
  let discovery = runtime('discover', settings.timeout);
  let tests;
  try { tests = await discovery.result; } finally { discovery.remove(); }
  let selected = new URLSearchParams(location.search).get('test');
  if (selected) tests = tests.filter(test => test.name === selected);
  if (!tests.length) throw new Error('No tests registered. Use test(name, async ({ app }) => …).');
  await post({ type: 'start', tests: tests.map(test => test.name), userAgent: navigator.userAgent });
  let started = performance.now();
  for (let test of tests) {
    status.textContent = `Running ${events.length + 1}/${tests.length}: ${test.name}`;
    let node = document.createElement('li');
    node.textContent = test.name;
    list.append(node);
    let runner = runtime('test', test.timeout ?? settings.timeout, test.index);
    let outcome;
    let received = false;
    try { outcome = await runner.result; received = true; }
    catch (error) { outcome = { index: test.index, name: test.name, status: 'failed', error: serialized(error) }; }
    finally { if (!received || events.length < tests.length - 1) runner.remove(); }
    let { status: resultStatus, error, duration, name } = outcome;
    let index = events.length;
    let event = { type: 'test', index, name, status: resultStatus, duration, error };
    events = [...events, event];
    node.dataset.status = resultStatus;
    node.textContent = `${resultStatus === 'passed' ? '✓' : '✗'} ${name}${duration === undefined ? '' : ` (${Math.round(duration)} ms)`}`;
    let detail;
    if (error) {
      detail = document.createElement('pre');
      detail.textContent = error.stack ?? error.message;
      node.append(detail);
    }
    let again = document.createElement('button');
    again.textContent = 'Run test';
    again.addEventListener('click', () => { let url = new URL(location.href); url.searchParams.set('test', test.name); location.href = url.href; });
    node.append(' ', again);
    // Results are reported after each test; queries and actions never leave the browser.
    let reported = await post(event);
    if (detail && reported.error) detail.textContent = reported.error.stack ?? reported.error.message;
  }
  let failed = events.filter(event => event.status === 'failed').length;
  let summary = { type: 'complete', passed: events.length - failed, failed, duration: performance.now() - started };
  status.textContent = `${summary.passed} passed, ${failed} failed (${Math.round(summary.duration)} ms)`;
  document.title = `${failed ? 'FAIL' : 'PASS'} — Dyno`;
  await post(summary);
} catch (error) {
  status.textContent = `Run failed: ${error.message}`;
  if (runId) await post({ type: 'fatal', error: serialized(error) }).catch(() => {});
}
