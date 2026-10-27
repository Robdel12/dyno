export function duration(value) {
  if (value === undefined || value === null) return '';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function reporterRoute(hash) {
  if (!hash || hash === '#/') return Object.freeze({ page: 'overview' });
  let match = /^#\/tests\/(0|[1-9]\d*)\/(output|app)$/.exec(hash);
  return Object.freeze(match ? { page: 'test', index: Number(match[1]), tab: match[2] } : { page: 'missing' });
}

export function selectedTest(state) {
  return state.tests.find(test => test.index === state.route.index);
}

export function testOutput(test) {
  if (!test) return '';
  return [`${test.name} — ${test.status}${duration(test.duration) ? ` (${duration(test.duration)})` : ''}`,
    test.error?.stack ?? test.error?.message,
    test.error?.source ? `${test.error.source.file}:${test.error.source.line}:${test.error.source.column}\n${test.error.source.code}` : '',
    ...test.output.map(entry => `[${duration(entry.elapsed)}] ${entry.source} ${entry.level}: ${entry.text}`)
  ].filter(Boolean).join('\n');
}

let write = (node, text) => { if (node.textContent !== text) node.textContent = text; };
let element = (tag, className, text) => {
  let node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let symbols = { pending: '○', running: '◌', passed: '✓', failed: '×', stopped: '■' };
let names = { pending: 'Pending', running: 'Running', passed: 'Passed', failed: 'Failed', stopped: 'Stopped' };

export function createReporter(actions) {
  let get = id => document.getElementById(id);
  let rows = new Map();
  let outputKey;
  let outputTest;
  let outputStatus;
  let logList;
  let logCount = 0;
  let view = 'overview';
  document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); get('main').focus(); });
  get('rerun').addEventListener('click', () => view === 'test' ? actions.runSelected() : actions.rerun([]));
  get('run-failed').addEventListener('click', actions.runFailed);
  let closeOptions = () => {
    let options = get('run-options');
    if (options.open) { options.open = false; options.querySelector('summary').focus(); }
  };
  get('pause').addEventListener('click', () => { actions.pause(); closeOptions(); });
  get('continue').addEventListener('click', actions.resume);
  get('stop').addEventListener('click', actions.stop);
  get('test-search').addEventListener('input', event => actions.search(event.target.value));
  get('pause-on-failure').addEventListener('change', event => actions.pauseOnFailure(event.target.checked));
  for (let button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => actions.filter(button.dataset.filter));
  let sizePreview = () => {
    let width = Number(get('viewport').value);
    let height = width === 768 ? 1024 : width === 390 ? 844 : 800;
    let stage = document.querySelector('.app-stage');
    let scale = Math.max(.1, Math.min(1, (stage.clientWidth - 24) / width, (stage.clientHeight - 24) / height));
    Object.assign(get('frame').style, { width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` });
    Object.assign(get('preview-sizer').style, { width: `${width * scale}px`, height: `${height * scale}px` });
  };
  get('viewport').addEventListener('change', sizePreview);
  new ResizeObserver(sizePreview).observe(document.querySelector('.app-stage'));
  sizePreview();
  get('copy-output').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(actions.copy()); write(get('copy-output'), 'Copied'); write(get('copy-status'), 'Test output copied.'); }
    catch { write(get('copy-status'), 'Could not copy. Select the output and copy it with your browser.'); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && view === 'overview' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable=true]')) {
      event.preventDefault(); get('test-search').focus();
    }
    if (event.key === 'Escape') closeOptions();
  });
  document.addEventListener('click', event => {
    if (!get('run-options').contains(event.target)) get('run-options').open = false;
  });

  function logRow(entry) {
    let row = element('li', 'log-entry');
    row.dataset.level = entry.level;
    row.append(element('span', 'log-time', duration(entry.elapsed)), element('span', 'log-source', entry.source), element('span', 'log-level', entry.level), element('pre', 'log-text', entry.text));
    return row;
  }

  function renderOutput(test, fatal) {
    let key = JSON.stringify([test?.index, test?.status, test?.error, test?.output.length, fatal]);
    if (key === outputKey) return;
    let append = outputTest === test?.index && outputStatus === test?.status && test?.status === 'running';
    if (outputTest !== test?.index) { write(get('copy-status'), ''); write(get('copy-output'), 'Copy output'); }
    outputTest = test?.index; outputStatus = test?.status;
    outputKey = key;
    let container = get('output');
    let atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
    if (append && logList?.isConnected && test.output.length >= logCount) {
      logList.append(...test.output.slice(logCount).map(logRow));
      if (test.output.length === 100 && logCount < 100) container.append(element('p', 'output-notice', 'Showing the first 100 console messages for this test.'));
      logCount = test.output.length;
      if (atBottom) container.scrollTop = container.scrollHeight;
      return;
    }
    let content = [];
    logList = undefined; logCount = 0;
    let error = fatal ? { message: fatal } : test?.error;
    if (error) {
      let failure = element('div', 'failure');
      failure.append(element('h2', '', error.message));
      if (error.source) {
        let source = error.source;
        failure.append(element('p', 'failure-location', `${source.file}:${source.line}:${source.column}`));
        let excerpt = element('pre', 'source-excerpt');
        for (let [offset, text] of source.code.split('\n').entries()) {
          let line = element('span', 'source-line');
          line.dataset.active = String(source.startLine + offset === source.line);
          line.append(element('span', 'line-number', String(source.startLine + offset)), element('code', 'source-text', text || ' '));
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
      logList = logs; logCount = test.output.length;
      content.push(element('h2', 'console-heading', 'Console'), logs);
      if (test.output.length === 100) content.push(element('p', 'output-notice', 'Showing the first 100 console messages for this test.'));
    } else if (!error) content.push(element('p', 'output-empty', test?.status === 'running' ? 'Waiting for console output…' : test ? 'No console output for this test.' : 'Select a test to see its output.'));
    container.replaceChildren(...content);
    if (append && atBottom) container.scrollTop = container.scrollHeight;
    else if (!append) container.scrollTop = 0;
  }

  return function render(state, frames) {
    let passed = state.tests.filter(test => test.status === 'passed').length;
    let failed = state.tests.filter(test => test.status === 'failed').length;
    let total = state.tests.length;
    let active = ['running', 'pausing'].includes(state.phase);
    let test = selectedTest(state);
    view = !total || state.route.page === 'overview' ? 'overview' : test ? 'test' : 'missing';
    let overview = view === 'overview';
    let detail = view === 'test';
    let appView = detail && state.route.tab === 'app';
    get('overview').hidden = !overview;
    get('test-heading').hidden = !detail;
    get('output-panel').hidden = !detail || appView;
    get('not-found').hidden = view !== 'missing';
    get('app-panel').dataset.active = String(appView);
    get('app-panel').setAttribute('aria-hidden', String(!appView));
    let titles = {
      connecting: 'Connecting to your app…', discovering: 'Discovering tests…',
      running: `Running ${Math.min(passed + failed + 1, total)} of ${total} tests`, pausing: 'Pausing after this test…', paused: 'Paused for inspection',
      completed: failed ? `${failed} ${failed === 1 ? 'test' : 'tests'} failed` : 'All tests passed',
      stopped: 'Run stopped', error: 'The run could not finish'
    };
    document.title = `${test?.name ?? (view === 'missing' ? 'Test not found' : titles[state.phase])} — Dyno`;
    write(get('status'), state.phase === 'paused' ? failed ? `${failed} ${failed === 1 ? 'test' : 'tests'} failed` : 'Test results' : titles[state.phase]);
    get('run-indicator').dataset.phase = state.phase;
    get('run-indicator').dataset.failed = String(failed > 0);
    write(get('run-meta'), state.error ?? `${state.files.length} test ${state.files.length === 1 ? 'file' : 'files'} · ${state.appHost || location.host}`);
    write(get('passed-count'), String(passed)); write(get('failed-count'), String(failed)); write(get('pending-count'), String(total - passed - failed));
    get('failed-summary').dataset.failed = String(failed > 0);
    write(get('test-count'), String(total)); write(get('run-duration'), duration(state.duration));
    get('progress').max = Math.max(total, 1); get('progress').value = passed + failed;
    get('progress').hidden = !active && state.phase !== 'discovering';
    get('rerun').disabled = detail ? !test : !total && state.phase !== 'error';
    write(get('rerun'), detail ? 'Run test' : 'Run all');
    get('run-failed').hidden = !failed;
    get('stop').hidden = !['discovering', 'running', 'pausing', 'paused'].includes(state.phase);
    get('run-options').hidden = !state.interactive;
    get('pause').disabled = !active;
    write(get('pause'), state.phase === 'pausing' ? 'Keep running' : 'Pause after this test');
    get('pause-on-failure').checked = state.pauseOnFailure;
    get('pause-banner').hidden = state.phase !== 'paused';
    get('inspect-paused').href = `#/tests/${state.current}/app`;
    get('inspect-paused').hidden = appView && test.index === state.current;
    get('viewport').disabled = active;
    if (active && get('viewport').value !== '1280') { get('viewport').value = '1280'; sizePreview(); }
    for (let button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
    let visible = 0;
    for (let item of state.tests) {
      let row = rows.get(item.index);
      if (!row) {
        let node = element('li');
        let select = element('a', 'test-select');
        select.href = `#/tests/${item.index}/output`;
        let symbol = element('span', 'test-symbol'); symbol.setAttribute('aria-hidden', 'true');
        let label = element('span', 'test-name', item.name);
        let error = element('span', 'test-error'); label.append(error);
        let time = element('span', 'test-time');
        let arrow = element('span', 'test-arrow', '›'); arrow.setAttribute('aria-hidden', 'true');
        select.append(symbol, label, time, arrow); node.append(select); get('results').append(node);
        row = { node, select, symbol, error, time }; rows.set(item.index, row);
      }
      row.node.dataset.status = item.status;
      row.select.setAttribute('aria-label', `${names[item.status]}: ${item.name}`);
      write(row.symbol, symbols[item.status]); write(row.time, item.status === 'pending' ? '—' : item.status === 'running' ? 'Running' : duration(item.duration));
      row.error.hidden = !item.error;
      write(row.error, item.error?.message ?? '');
      row.node.hidden = !(item.name.toLowerCase().includes(state.query.toLowerCase()) && (state.filter === 'all' || item.status === state.filter));
      if (!row.node.hidden) visible++;
    }
    get('empty-results').hidden = visible > 0 || !total;
    if (get('files').childElementCount !== state.files.length) get('files').replaceChildren(...state.files.map(file => element('li', '', file)));
    write(get('browser-name'), state.browser); write(get('app-host'), state.appHost);
    write(get('selected-name'), test?.name ?? 'Loading test…');
    write(get('selected-status'), test ? `${names[test.status]}${duration(test.duration) ? ` · ${duration(test.duration)}` : ''}` : '');
    get('selected-status').dataset.status = test?.status ?? 'pending';
    get('output-tab').href = `#/tests/${test?.index}/output`;
    get('app-tab').href = `#/tests/${test?.index}/app`;
    for (let [tab, id] of [['output', 'output-tab'], ['app', 'app-tab']]) {
      if (detail && state.route.tab === tab) get(id).setAttribute('aria-current', 'page');
      else get(id).removeAttribute('aria-current');
    }
    get('copy-output').hidden = appView;
    get('copy-output').disabled = !test || !navigator.clipboard?.writeText;
    get('copy-output').title = navigator.clipboard ? 'Copy this test’s result and console output' : 'Clipboard access needs a secure browser origin';
    if (detail && !appView) renderOutput(test, state.error);
    let frame = frames.get(test?.index);
    get('preview-sizer').dataset.parked = String(!frame);
    get('preview-sizer').setAttribute('aria-hidden', String(!frame || !appView));
    get('preview-empty').hidden = Boolean(frame);
    write(get('preview-empty').querySelector('h2'), test?.status === 'pending' ? 'This test hasn’t run yet' : 'Run this test to inspect its app');
    write(get('preview-empty').querySelector('p'), 'Each test starts with a fresh context. Previous output is always available.');
    write(get('app-address'), test?.path ? `${location.origin}${test.path}` : state.appHost || 'Your app will appear here');
    write(get('preview-caption'), frame ? active ? 'Live application · 1280 × 800 test viewport' : 'Application kept open for inspection' : '');
    write(get('connection-state'), titles[state.phase]);
  };
}
