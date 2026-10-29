import { slowestTests } from './timings.js';
import { timingDuration, timingLabels, timingPhases, timingOperations, timingText } from './timing-format.js';

export function duration(value) {
  if (value === undefined || value === null) return '';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

let filters = ['all', 'failed', 'passed', 'skipped', 'pending'];
export function reporterRoute(hash) {
  let [path, search = ''] = (hash || '#/').split('?');
  let params = new URLSearchParams(search);
  let view = {
    query: params.get('q') ?? '',
    filter: filters.includes(params.get('status')) ? params.get('status') : 'all'
  };
  if (!path || path === '#/') return Object.freeze({ ...view, page: 'overview' });
  let match = /^#\/tests\/([^/]+)\/(output|app|timings)$/.exec(path);
  try {
    return Object.freeze(
      match ? { ...view, page: 'test', id: decodeURIComponent(match[1]), tab: match[2] } : { ...view, page: 'missing' }
    );
  } catch {
    return Object.freeze({ ...view, page: 'missing' });
  }
}
export function reporterHref(route) {
  let path = route.page === 'test' ? `#/tests/${encodeURIComponent(route.id)}/${route.tab ?? 'output'}` : '#/';
  let params = new URLSearchParams();
  if (route.query) params.set('q', route.query);
  if (route.filter && route.filter !== 'all') params.set('status', route.filter);
  return path + (params.size ? '?' + params.toString() : '');
}
export function selectedTest(state) {
  return state.tests.find((test) => test.id === state.route.id);
}
export function reporterGroups(tests) {
  let files = [...new Set(tests.map((test) => test.file))];
  return Object.freeze(
    files.map((file) => {
      let entries = tests.filter((test) => test.file === file);
      let paths = [...new Set(entries.map((test) => JSON.stringify(test.suites)))];
      return Object.freeze({
        file,
        tests: Object.freeze(entries),
        suites: Object.freeze(
          paths.map((path) =>
            Object.freeze({
              path: Object.freeze(JSON.parse(path)),
              tests: Object.freeze(entries.filter((test) => JSON.stringify(test.suites) === path))
            })
          )
        )
      });
    })
  );
}

export function testOutput(test) {
  if (!test) return '';
  return [
    `${test.name} — ${test.status}${duration(test.duration) ? ` (${duration(test.duration)})` : ''}`,
    ...[test.error, ...(test.additionalErrors ?? [])]
      .filter(Boolean)
      .map((error) => `[${error.phase ?? 'test'}] ${error.stack ?? error.message}`),
    test.error?.source
      ? `${test.error.source.file}:${test.error.source.line}:${test.error.source.column}\n${test.error.source.code}`
      : '',
    ...(test.timings ? [timingText(test.timings)] : []),
    ...test.output.map((entry) => `[${duration(entry.elapsed)}] ${entry.source} ${entry.level}: ${entry.text}`)
  ]
    .filter(Boolean)
    .join('\n');
}

let write = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
let element = (tag, className, text) => {
  let node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let symbols = { pending: '○', running: '◌', passed: '✓', failed: '×', stopped: '■', skipped: '−' };
let names = {
  pending: 'Pending',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped'
};

export function createReporter(actions) {
  let get = (id) => document.getElementById(id);
  write(get('close-reporter'), 'Show app');
  get('close-reporter').title = actions.embedded
    ? 'Close the reporter and show the application'
    : 'Show the application in the test browser; this observer stays open';
  write(get('show-app'), actions.embedded ? 'Show application' : 'Show app in test browser');
  let rows = new Map();
  let groups = new Map();
  let suites = new Map();
  let outputKey;
  let outputTest;
  let outputStatus;
  let logList;
  let logCount = 0;
  let view = 'overview';
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    get('main').focus();
  });
  get('rerun').addEventListener('click', () => (view === 'test' ? actions.runSelected() : actions.rerun([])));
  get('run-failed').addEventListener('click', actions.runFailed);
  get('retry-command').addEventListener('click', actions.retry);
  let closeOptions = () => {
    let options = get('run-options');
    if (options.open) {
      options.open = false;
      options.querySelector('summary').focus();
    }
  };
  get('pause').addEventListener('click', () => {
    actions.pause();
    closeOptions();
  });
  get('continue').addEventListener('click', actions.resume);
  get('stop').addEventListener('click', actions.stop);
  get('test-search').addEventListener('input', (event) => actions.search(event.target.value));
  get('pause-on-failure').addEventListener('change', (event) => actions.pauseOnFailure(event.target.checked));
  for (let button of document.querySelectorAll('[data-filter]'))
    button.addEventListener('click', () => actions.filter(button.dataset.filter));
  get('viewport').addEventListener('change', () => {
    let [width, height] = get('viewport').value.split('x').map(Number);
    actions.viewport({ width, height });
  });
  get('show-app').addEventListener('click', actions.showApp);
  get('close-reporter').addEventListener('click', actions.close);
  get('copy-output').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(actions.copy());
      write(get('copy-output'), 'Copied');
      write(get('copy-status'), 'Test output copied.');
    } catch {
      write(get('copy-status'), 'Could not copy. Select the output and copy it with your browser.');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      view === 'overview' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.target.closest('input,textarea,select,[contenteditable=true]')
    ) {
      event.preventDefault();
      get('test-search').focus();
    }
    if (event.key === 'Escape') {
      if (get('run-options').open) closeOptions();
      else if (actions.embedded) actions.close();
    }
  });
  document.addEventListener('click', (event) => {
    if (!get('run-options').contains(event.target)) get('run-options').open = false;
  });

  function logRow(entry) {
    let row = element('li', 'log-entry');
    row.dataset.level = entry.level;
    row.append(
      element('span', 'log-time', duration(entry.elapsed)),
      element('span', 'log-source', entry.source),
      element('span', 'log-level', entry.level),
      element('pre', 'log-text', entry.text)
    );
    return row;
  }

  function renderOutput(test, fatal) {
    let key = JSON.stringify([
      test?.index,
      test?.status,
      test?.error,
      test?.additionalErrors,
      test?.output.length,
      test?.attachments,
      fatal
    ]);
    if (key === outputKey) return;
    let append = outputTest === test?.id && outputStatus === test?.status && test?.status === 'running';
    if (outputTest !== test?.id) {
      write(get('copy-status'), '');
      write(get('copy-output'), 'Copy output');
    }
    outputTest = test?.id;
    outputStatus = test?.status;
    outputKey = key;
    let container = get('output');
    let atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
    if (append && logList?.isConnected && test.output.length >= logCount) {
      logList.append(...test.output.slice(logCount).map(logRow));
      if (test.output.length === 100 && logCount < 100)
        container.append(element('p', 'output-notice', 'Showing the first 100 console messages for this test.'));
      logCount = test.output.length;
      if (atBottom) container.scrollTop = container.scrollHeight;
      return;
    }
    let content = [];
    logList = undefined;
    logCount = 0;
    let error = fatal ? { message: fatal } : test?.error;
    for (let failureError of [error, ...(test?.additionalErrors ?? [])].filter(Boolean)) {
      let error = failureError;
      let failure = element('div', 'failure');
      if (error.phase)
        failure.append(
          element(
            'p',
            'failure-location',
            {
              test: 'Test',
              beforeEach: 'Setup · beforeEach',
              afterEach: 'Cleanup · afterEach',
              app: 'Application',
              timeout: 'Test timeout',
              cleanup: 'Cleanup timeout',
              runtime: 'Test runtime'
            }[error.phase] ?? error.phase
          )
        );
      failure.append(element('h2', '', error.message));
      if (error.source) {
        let source = error.source;
        failure.append(element('p', 'failure-location', `${source.file}:${source.line}:${source.column}`));
        let excerpt = element('pre', 'source-excerpt');
        for (let [offset, text] of source.code.split('\n').entries()) {
          let line = element('span', 'source-line');
          line.dataset.active = String(source.startLine + offset === source.line);
          line.append(
            element('span', 'line-number', String(source.startLine + offset)),
            element('code', 'source-text', text || ' ')
          );
          excerpt.append(line);
        }
        failure.append(excerpt);
      }
      if (error.stack) {
        let detail = document.createElement('details');
        detail.open = false;
        detail.append(element('summary', '', 'Stack trace'), element('pre', '', error.stack));
        failure.append(detail);
      }
      content.push(failure);
    }
    if (test?.output.length) {
      let logs = element('ol', 'console-output');
      logs.setAttribute('aria-label', 'Console output');
      logs.append(...test.output.map(logRow));
      logList = logs;
      logCount = test.output.length;
      content.push(element('h2', 'console-heading', 'Console'), logs);
      if (test.output.length === 100)
        content.push(element('p', 'output-notice', 'Showing the first 100 console messages for this test.'));
    } else if (!error)
      content.push(
        element(
          'p',
          'output-empty',
          test?.status === 'running'
            ? 'Waiting for console output…'
            : test
              ? 'No console output for this test.'
              : 'Select a test to see its output.'
        )
      );
    if (test?.status === 'skipped') content.push(element('p', 'output-notice', `Skipped: ${test.skipReason}`));
    for (let attachment of test?.attachments ?? []) {
      let figure = element('figure', 'screenshot');
      if (attachment.status === 'captured') {
        let link = element('a');
        link.href = attachment.url;
        link.target = '_blank';
        link.rel = 'noopener';
        let image = element('img');
        image.src = attachment.url;
        image.alt = `${attachment.name} — application screenshot`;
        image.loading = 'lazy';
        link.append(image);
        figure.append(link);
        figure.append(
          element(
            'figcaption',
            '',
            `${attachment.name} · ${attachment.width} × ${attachment.height} · ${attachment.browser.name}`
          )
        );
      } else figure.append(element('figcaption', '', `${attachment.name} · Image skipped: ${attachment.reason}`));
      content.push(figure);
    }
    container.replaceChildren(...content);
    if (append && atBottom) container.scrollTop = container.scrollHeight;
    else if (!append) container.scrollTop = 0;
  }

  let timingKey;
  let slowKey;
  function renderTimings(test) {
    let key = test?.timings ?? `${test?.id}:${test?.status}`;
    if (timingKey === key && get('timings').childElementCount) return;
    timingKey = key;
    let container = get('timings');
    if (!test?.timings) {
      container.replaceChildren(element('p', 'output-empty', test?.status === 'running'
        ? 'Timing details appear when this test finishes.' : 'Timing details are unavailable for this test.'));
      return;
    }
    let timings = test.timings;
    let phases = element('dl', 'timing-phases');
    for (let entry of timingPhases(timings)) {
      let group = element('div');
      group.append(element('dt', '', entry.name), element('dd', '', timingDuration(entry.duration)));
      phases.append(group);
    }
    let table = element('table', 'timings-table');
    table.setAttribute('aria-label', 'Hooks, operations, and steps, slowest first');
    let heading = element('tr');
    for (let label of ['Work', 'Started', 'Duration']) {
      let cell = element('th', '', label); cell.scope = 'col'; heading.append(cell);
    }
    let head = element('thead'); head.append(heading); table.append(head);
    let body = element('tbody');
    for (let entry of timingOperations(timings)) {
      let row = element('tr');
      let name = element('td');
      name.append(element('strong', '', entry.name), element('span', 'timing-kind',
        `${timingLabels[entry.kind]} · ${entry.phase ?? 'test'} · ${entry.status}`));
      row.append(name, element('td', '', timingDuration(entry.start)), element('td', '', timingDuration(entry.duration)));
      body.append(row);
    }
    table.append(body);
    container.replaceChildren(element('h2', '', 'Phases'), phases,
      element('p', 'output-notice', 'Times include waiting. Steps can contain operations and overlap; do not add these rows together. Debug pauses are included.'),
      element('h2', '', 'Hooks, operations, and steps'), body.childElementCount ? table : element('p', '', 'No app operations or named steps were recorded.'));
    if (timings.truncated) container.append(element('p', 'output-notice', `${timings.truncated} additional timings were not recorded.`));
  }

  return function render(state) {
    let passed = state.tests.filter((test) => test.status === 'passed').length;
    let failed = state.tests.filter((test) => test.status === 'failed').length;
    let total = state.tests.length;
    let href = (patch) => reporterHref({ ...state.route, ...patch });
    for (let id of [
      'rerun',
      'run-failed',
      'pause',
      'continue',
      'stop',
      'viewport',
      'close-reporter',
      'show-app',
      'pause-on-failure'
    ])
      get(id).disabled = false;
    let unavailable = state.connection !== 'connected' || state.command?.status === 'pending';
    get('command-notice').hidden = !state.command || state.command.status === 'idle';
    write(
      get('command-status'),
      state.command?.status === 'pending' ? `Sending ${state.command.name}…` : (state.command?.message ?? '')
    );
    get('retry-command').hidden = state.command?.status !== 'failed';
    get('retry-command').disabled = state.connection !== 'connected';
    write(
      get('connection-state'),
      state.connection === 'connected'
        ? 'Connected to test browser'
        : state.connection === 'closed'
          ? 'Test browser disconnected. Reopen its execution URL.'
          : 'Connecting to test browser…'
    );
    get('connection-state').dataset.connection = state.connection;
    write(
      get('capabilities'),
      state.capabilities?.screenshot ? 'Screenshots available' : 'Screenshots unavailable · URL-only browser'
    );
    for (let link of document.querySelectorAll('.back-link,.brand')) link.href = href({ page: 'overview' });
    if (get('test-search').value !== state.route.query) get('test-search').value = state.route.query;
    let skipped = state.tests.filter((test) => test.status === 'skipped').length;
    let active = ['running', 'pausing', 'resuming'].includes(state.phase);
    let test = selectedTest(state);
    view = !total || state.route.page === 'overview' ? 'overview' : test ? 'test' : 'missing';
    let overview = view === 'overview';
    let detail = view === 'test';
    let appView = detail && state.route.tab === 'app';
    let timingView = detail && state.route.tab === 'timings';
    get('overview').hidden = !overview;
    get('test-heading').hidden = !detail;
    get('output-panel').hidden = !detail || appView || timingView;
    get('timing-panel').hidden = !timingView;
    get('not-found').hidden = view !== 'missing';
    get('app-panel').dataset.active = String(appView);
    get('app-panel').setAttribute('aria-hidden', String(!appView));
    let titles = {
      connecting: 'Connecting to your app…',
      discovering: 'Discovering tests…',
      running: `Running ${Math.min(passed + failed + 1, total)} of ${total} tests`,
      pausing: 'Pausing after this test…',
      paused: 'Paused for inspection',
      resuming: 'Continuing tests…',
      debugging: 'Paused in this test',
      completed: failed
        ? `${failed} ${failed === 1 ? 'test' : 'tests'} failed`
        : skipped
          ? 'Run complete'
          : 'All tests passed',
      stopped: 'Run stopped',
      error: 'The run could not finish'
    };
    document.title = `${test?.name ?? (view === 'missing' ? 'Test not found' : titles[state.phase])} — Dyno`;
    write(
      get('status'),
      state.phase === 'paused'
        ? failed
          ? `${failed} ${failed === 1 ? 'test' : 'tests'} failed`
          : 'Test results'
        : titles[state.phase]
    );
    get('run-indicator').dataset.phase = state.phase;
    get('run-indicator').dataset.failed = String(failed > 0);
    write(
      get('run-meta'),
      state.error ??
        `${state.files.length} test ${state.files.length === 1 ? 'file' : 'files'} · ${state.appHost || location.host}`
    );
    write(get('passed-count'), String(passed));
    write(get('failed-count'), String(failed));
    write(get('pending-count'), String(total - passed - failed - skipped));
    write(get('skipped-count'), String(skipped));
    get('skipped-summary').hidden = skipped === 0;
    get('failed-summary').dataset.failed = String(failed > 0);
    write(get('test-count'), String(total));
    write(get('run-duration'), duration(state.duration));
    let slow = slowestTests(state.tests);
    get('slow-tests').hidden = !slow.length;
    let key = JSON.stringify([state.route.query, state.route.filter, slow.map(test => [test.id, test.duration])]);
    if (key !== slowKey) {
      slowKey = key;
      get('slow-test-list').replaceChildren(...slow.map(test => {
        let row = element('li');
        let link = element('a', '', [test.file, ...test.suites, test.name].join(' › '));
        link.href = href({ page: 'test', id: test.id, tab: 'timings' });
        row.append(link, element('span', '', timingDuration(test.duration)));
        return row;
      }));
    }
    get('progress').max = Math.max(total, 1);
    get('progress').value = passed + failed + skipped;
    get('progress').hidden = !active && state.phase !== 'discovering';
    get('rerun').disabled = detail ? !test : !total && state.phase !== 'error';
    write(get('rerun'), detail ? 'Run test' : 'Run all');
    get('run-failed').hidden = !failed;
    get('stop').hidden = !['discovering', 'running', 'pausing', 'paused', 'resuming', 'debugging'].includes(
      state.phase
    );
    get('run-options').hidden = !state.interactive;
    get('pause').disabled = !['running', 'pausing'].includes(state.phase);
    write(get('pause'), state.phase === 'pausing' ? 'Keep running' : 'Pause after this test');
    get('pause-on-failure').checked = state.pauseOnFailure;
    get('pause-banner').hidden = !['paused', 'debugging'].includes(state.phase);
    write(get('pause-message'), state.phase === 'debugging' ? state.debugMessage : 'Run paused.');
    get('inspect-paused').href = href({
      page: 'test',
      id: state.tests.find((test) => test.index === state.current)?.id,
      tab: 'app'
    });
    get('inspect-paused').hidden = appView && test.index === state.current;
    get('viewport').disabled = active;
    let viewport = state.viewport ?? { width: 1280, height: 800 };
    let size = `${viewport.width}x${viewport.height}`;
    let custom = get('viewport').querySelector('option[data-current]');
    if (custom && custom.value !== size) custom.remove();
    if (![...get('viewport').options].some((option) => option.value === size)) {
      custom = element('option', '', `${viewport.width} × ${viewport.height}`);
      custom.value = size;
      custom.dataset.current = 'true';
      get('viewport').append(custom);
    }
    get('viewport').value = size;
    for (let button of document.querySelectorAll('[data-filter]'))
      button.setAttribute('aria-pressed', String(button.dataset.filter === state.route.filter));
    for (let group of reporterGroups(state.tests)) {
      let fileGroup = groups.get(group.file);
      if (!fileGroup) {
        let node = element('section', 'file-group');
        let heading = element('header', 'group-heading');
        let title = element('h2', '', group.file);
        let count = element('span', 'group-count');
        let run = element('button', 'text-button', 'Run file');
        run.setAttribute('aria-label', `Run file ${group.file}`);
        run.addEventListener('click', () => actions.runScope({ file: group.file }));
        heading.append(title, count, run);
        node.append(heading);
        get('results').append(node);
        fileGroup = { node, count, run };
        groups.set(group.file, fileGroup);
      }
      let failedCount = group.tests.filter((test) => test.status === 'failed').length;
      write(
        fileGroup.count,
        `${group.tests.length} ${group.tests.length === 1 ? 'test' : 'tests'}${failedCount ? ` · ${failedCount} failed` : ''}`
      );
      fileGroup.run.disabled = active || state.phase === 'debugging' || unavailable;
      let fileVisible = false;
      for (let suite of group.suites) {
        let key = JSON.stringify([group.file, ...suite.path]);
        let suiteGroup = suites.get(key);
        if (!suiteGroup) {
          let node = element('section', 'suite-group');
          if (suite.path.length || group.suites.length > 1) {
            let heading = element('header', 'group-heading suite-heading');
            heading.append(element('h3', '', suite.path.join(' › ') || 'File tests'));
            let run = element('button', 'text-button', 'Run suite');
            run.hidden = !suite.path.length;
            run.setAttribute('aria-label', `Run suite ${suite.path.join(' › ')} in ${group.file}`);
            run.addEventListener('click', () => actions.runScope({ file: group.file, suites: suite.path }));
            heading.append(run);
            node.append(heading);
          }
          let list = element('ol', 'suite-tests');
          node.append(list);
          fileGroup.node.append(node);
          suiteGroup = { node, list };
          suites.set(key, suiteGroup);
        }
        for (let run of suiteGroup.node.querySelectorAll('button'))
          run.disabled = active || state.phase === 'debugging' || unavailable;
        let matches = suite.tests.some(
          (test) =>
            `${test.file} ${test.suites.join(' ')} ${test.name}`
              .toLowerCase()
              .includes(state.route.query.toLowerCase()) &&
            (state.route.filter === 'all' || test.status === state.route.filter)
        );
        suiteGroup.node.hidden = !matches;
        fileVisible ||= matches;
      }
      fileGroup.node.hidden = !fileVisible;
    }
    let visible = 0;
    for (let item of state.tests) {
      let row = rows.get(item.id);
      if (!row) {
        let node = element('li');
        let select = element('a', 'test-select');
        node.dataset.testId = item.id;
        let symbol = element('span', 'test-symbol');
        symbol.setAttribute('aria-hidden', 'true');
        let label = element('span', 'test-name', item.name);
        let error = element('span', 'test-error');
        label.append(error);
        let time = element('span', 'test-time');
        let arrow = element('span', 'test-arrow', '›');
        arrow.setAttribute('aria-hidden', 'true');
        select.append(symbol, label, time, arrow);
        node.append(select);
        suites.get(JSON.stringify([item.file, ...item.suites])).list.append(node);
        row = { node, select, symbol, error, time };
        rows.set(item.id, row);
      }
      row.select.href = href({ page: 'test', id: item.id, tab: 'output' });
      row.select.title = [item.file, ...item.suites, item.name].join(' › ');
      row.node.dataset.status = item.status;
      row.select.setAttribute('aria-label', `${names[item.status]}: ${item.name}`);
      write(row.symbol, symbols[item.status]);
      write(
        row.time,
        item.status === 'pending' ? '—' : item.status === 'running' ? 'Running' : duration(item.duration)
      );
      row.error.hidden = !item.error;
      write(row.error, item.error?.message ?? '');
      row.node.hidden = !(
        `${item.file} ${item.suites.join(' ')} ${item.name}`.toLowerCase().includes(state.route.query.toLowerCase()) &&
        (state.route.filter === 'all' || item.status === state.route.filter)
      );
      if (!row.node.hidden) visible++;
    }
    get('empty-results').hidden = visible > 0 || !total;
    if (get('files').childElementCount !== state.files.length)
      get('files').replaceChildren(...state.files.map((file) => element('li', '', file)));
    write(get('browser-name'), state.browser);
    write(get('app-host'), state.appHost);
    get('standalone-reporter').hidden = !actions.embedded;
    get('standalone-reporter').href = `/__dyno__/reporter?run=${encodeURIComponent(state.runId)}${location.hash}`;
    write(get('selected-context'), test ? [test.file, ...test.suites].join(' › ') : '');
    write(get('selected-name'), test?.name ?? 'Loading test…');
    write(
      get('selected-status'),
      test ? `${names[test.status]}${duration(test.duration) ? ` · ${duration(test.duration)}` : ''}` : ''
    );
    get('selected-status').dataset.status = test?.status ?? 'pending';
    get('output-tab').href = href({ page: 'test', id: test?.id, tab: 'output' });
    get('timings-tab').href = href({ page: 'test', id: test?.id, tab: 'timings' });
    get('app-tab').href = href({ page: 'test', id: test?.id, tab: 'app' });
    for (let [tab, id] of [
      ['output', 'output-tab'],
      ['timings', 'timings-tab'],
      ['app', 'app-tab']
    ]) {
      if (detail && state.route.tab === tab) get(id).setAttribute('aria-current', 'page');
      else get(id).removeAttribute('aria-current');
    }
    get('copy-output').hidden = appView;
    write(get('copy-output'), timingView ? 'Copy timings' : 'Copy output');
    get('copy-output').disabled = !test || !navigator.clipboard?.writeText;
    get('copy-output').title = navigator.clipboard
      ? timingView ? 'Copy this test’s timings' : 'Copy this test’s result and console output'
      : 'Clipboard access needs a secure browser origin';
    if (timingView) renderTimings(test);
    if (detail && !appView && !timingView) renderOutput(test, state.error);
    let hasApp = state.hasApp && test?.index === state.current;
    get('show-app').hidden = !hasApp;
    get('close-reporter').disabled = !state.hasApp;
    let appTitle = test?.status === 'pending' ? 'This test hasn’t run yet' : 'Run this test to inspect its app';
    let appDescription = 'Each test starts with a fresh context. Previous output is always available.';
    if (hasApp && actions.embedded) {
      appTitle = 'Your application is running behind the reporter';
      appDescription = 'Close the reporter to inspect the actual app. Its viewport stays unchanged.';
    } else if (hasApp) {
      appTitle = 'Your application is running in the test browser';
      appDescription = 'Show the app there while keeping this observer open. Its viewport stays unchanged.';
    }
    write(get('preview-empty').querySelector('h2'), appTitle);
    write(get('preview-empty').querySelector('p'), appDescription);
    write(
      get('app-address'),
      test?.path ? `${location.origin}${test.path}` : state.appHost || 'Your app will appear here'
    );
    write(get('preview-caption'), hasApp ? `${state.viewport.width} × ${state.viewport.height} app viewport` : '');
    for (let id of [
      'rerun',
      'run-failed',
      'pause',
      'continue',
      'stop',
      'viewport',
      'close-reporter',
      'show-app',
      'pause-on-failure'
    ])
      get(id).disabled ||= unavailable;
    get('rerun').disabled ||= active || state.phase === 'debugging';
    get('run-failed').disabled = active || state.phase === 'debugging' || unavailable;
  };
}
