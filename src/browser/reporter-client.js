import { createReporter, selectedTest, testOutput, reporterRoute } from './reporter.js';

let parameters = new URLSearchParams(location.search);
let runId = parameters.get('run');
let embedded = parameters.get('embedded') === '1' && parent !== window;
let state = {
  phase: 'connecting',
  tests: [],
  current: null,
  files: [],
  appHost: '',
  browser: '',
  query: '',
  filter: 'all',
  route: reporterRoute(location.hash),
  pauseOnFailure: false,
  interactive: false
};
let command = (command, extra = {}) => {
  let value = { channel: 'dyno-reporter', kind: 'command', runId, command, ...extra };
  if (embedded) parent.postMessage(value, location.origin);
  else
    void fetch('/__dyno__/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
      })
      .catch((error) => {
        state = { ...state, error: error.message };
        render(state);
      });
};
let update = (patch) => {
  state = Object.freeze({ ...state, ...patch });
  render(state);
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
  search: (query) => update({ query }),
  filter: (filter) => update({ filter }),
  pause: () => command('pause'),
  resume: () => command('continue'),
  stop: () => command('stop'),
  pauseOnFailure: (value) => command('pause-on-failure', { value }),
  viewport: (viewport) => command('viewport', { viewport }),
  showApp: () => command('show-app'),
  close: () => command('show-app'),
  copy: () => testOutput(selectedTest(state))
});
render(state);
window.addEventListener('hashchange', () => {
  let route = reporterRoute(location.hash);
  // Queued history events shouldn't steal focus from the current view.
  if (['page', 'index', 'tab'].every((key) => route[key] === state.route[key])) return;
  update({ route });
  document.getElementById('run-options').open = false;
  document.getElementById('main').focus();
  window.scrollTo(0, 0);
});
let receive = (view) => update({ ...view, query: state.query, filter: state.filter, route: state.route });
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
    if (message.kind === 'focus' && (!document.hasFocus() || document.activeElement === document.body))
      document.getElementById('main').focus();
  });
  parent.postMessage({ channel: 'dyno-reporter', kind: 'ready', runId }, location.origin);
} else if (runId) {
  let stream = new EventSource(`/__dyno__/stream?run=${encodeURIComponent(runId)}`);
  stream.addEventListener('snapshot', (event) => receive(JSON.parse(event.data)));
  stream.addEventListener('replacement', (event) => {
    let url = new URL(location.href);
    url.searchParams.set('run', JSON.parse(event.data).runId);
    location.replace(url);
  });
  stream.addEventListener('error', () => {
    document.getElementById('connection-state').textContent = 'Reporter disconnected. Reconnecting…';
  });
} else update({ phase: 'error', error: 'Open a reporter URL from an active Dyno run.' });
