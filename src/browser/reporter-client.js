import { timingText } from './timing-format.js';
import { createReporter, selectedTest, testOutput, reporterRoute, reporterHref } from './reporter.js';

let parameters = new URLSearchParams(location.search);
let runId = parameters.get('run');
let embedded = parameters.get('embedded') === '1' && parent !== window;
let state = Object.freeze({
  phase: 'connecting',
  tests: [],
  current: null,
  files: [],
  appHost: '',
  browser: '',
  route: reporterRoute(location.hash),
  pauseOnFailure: false,
  interactive: false,
  connection: 'connecting',
  command: { status: 'idle' }
});
let pending;
let lastCommand;
let update = (patch) => {
  state = Object.freeze({ ...state, ...patch });
  render(state);
};
let acknowledge = (message) => {
  if (!pending || message.requestId !== pending.id) return;
  pending.detach();
  pending = undefined;
  update({ command: message.error ? { status: 'failed', message: message.error.message } : { status: 'idle' } });
};
let command = (name, extra = {}) => {
  if (pending) return;
  let requestId = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  let value = { channel: 'dyno-reporter', kind: 'command', runId, command: name, requestId, ...extra };
  lastCommand = { name, extra };
  let deadline = AbortSignal.timeout(10000);
  let expired = () =>
    acknowledge({
      requestId,
      error: { message: 'The test browser did not reply. Check its connection and try again.' }
    });
  pending = { id: requestId, detach: () => deadline.removeEventListener('abort', expired) };
  deadline.addEventListener('abort', expired, { once: true });
  update({ command: { status: 'pending', name } });
  if (embedded) parent.postMessage(value, location.origin);
  else
    void fetch('/__dyno__/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: deadline
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
      })
      .catch((error) => acknowledge({ requestId, error }));
};
let navigate = (patch, replace = false) => {
  let route = { ...state.route, ...patch };
  history[replace ? 'replaceState' : 'pushState'](null, '', reporterHref(route));
  update({ route: reporterRoute(location.hash) });
};
let render = createReporter({
  embedded,
  rerun: (ids) => command('rerun', { ids }),
  runFailed: () =>
    command('rerun', { ids: state.tests.filter((test) => test.status === 'failed').map((test) => test.id) }),
  runSelected: () => {
    let test = selectedTest(state);
    if (test) command('rerun', { ids: [test.id] });
  },
  runScope: (scope) =>
    command('rerun', {
      ids: state.tests
        .filter(
          (test) =>
            test.file === scope.file &&
            (!scope.suites || scope.suites.every((name, index) => test.suites[index] === name))
        )
        .map((test) => test.id)
    }),
  search: (query) => navigate({ query }, true),
  filter: (filter) => navigate({ filter }),
  retry: () => {
    if (lastCommand) command(lastCommand.name, lastCommand.extra);
  },
  pause: () => command('pause'),
  resume: () => command('continue'),
  stop: () => command('stop'),
  pauseOnFailure: (value) => command('pause-on-failure', { value }),
  viewport: (viewport) => command('viewport', { viewport }),
  showApp: () => command('show-app'),
  close: () => command('show-app'),
  copy: () => state.route.tab === 'timings' ? timingText(selectedTest(state)?.timings) : testOutput(selectedTest(state))
});
render(state);
window.addEventListener('hashchange', () => {
  let route = reporterRoute(location.hash);
  if (['page', 'id', 'tab', 'query', 'filter'].every((key) => route[key] === state.route[key])) return;
  update({ route });
  document.getElementById('run-options').open = false;
  document.getElementById('main').focus();
  window.scrollTo(0, 0);
});
let receive = (view) => update({ ...view, route: state.route, connection: 'connected', command: state.command });
if (embedded) {
  window.addEventListener('message', (event) => {
    let message = event.data;
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      message?.channel !== 'dyno-reporter' ||
      message.runId !== runId
    )
      return;
    if (message.kind === 'snapshot') receive(message.view);
    if (message.kind === 'command-result') acknowledge(message);
    if (message.kind === 'focus' && (!document.hasFocus() || document.activeElement === document.body))
      document.getElementById('main').focus();
  });
  parent.postMessage({ channel: 'dyno-reporter', kind: 'ready', runId }, location.origin);
} else if (runId) {
  let stream = new EventSource(`/__dyno__/stream?run=${encodeURIComponent(runId)}`);
  stream.addEventListener('open', () => update({ connection: 'connected' }));
  stream.addEventListener('snapshot', (event) => receive(JSON.parse(event.data)));
  stream.addEventListener('watch', (event) => update({ watch: JSON.parse(event.data) }));
  stream.addEventListener('host-status', (event) =>
    update({ connection: JSON.parse(event.data).connected ? 'connected' : 'closed' })
  );
  stream.addEventListener('command-result', (event) => acknowledge(JSON.parse(event.data)));
  stream.addEventListener('replacement', (event) => {
    let url = new URL(location.href);
    url.searchParams.set('run', JSON.parse(event.data).runId);
    location.replace(url);
  });
  stream.addEventListener('error', () =>
    update({ connection: stream.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting' })
  );
} else update({ phase: 'error', connection: 'closed', error: 'Open a reporter URL from an active Dyno run.' });
