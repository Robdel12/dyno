export function duration(value) {
  if (value === undefined || value === null) return '';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function selectedTest(state) {
  return state.tests.find(test => test.index === state.selected)
    ?? state.tests.find(test => test.index === state.current && ['running', 'pausing'].includes(state.phase))
    ?? state.tests.find(test => test.status === 'failed')
    ?? state.tests.findLast(test => ['passed', 'failed'].includes(test.status))
    ?? state.tests[0];
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
  get('rerun').addEventListener('click', () => actions.rerun([]));
  get('run-failed').addEventListener('click', actions.runFailed);
  get('run-selected').addEventListener('click', actions.runSelected);
  get('inspect-rerun').addEventListener('click', actions.runSelected);
  get('pause').addEventListener('click', actions.pause);
  get('continue').addEventListener('click', actions.resume);
  get('stop').addEventListener('click', actions.stop);
  get('follow').addEventListener('click', () => actions.select(null));
  get('test-search').addEventListener('input', event => actions.search(event.target.value));
  get('pause-on-failure').addEventListener('change', event => actions.pauseOnFailure(event.target.checked));
  for (let button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => actions.filter(button.dataset.filter));
  let sizePreview = () => {
    get('output-divider').setAttribute('aria-orientation', matchMedia('(min-width:1100px)').matches ? 'vertical' : 'horizontal');
    let width = Number(get('viewport').value);
    let height = width === 768 ? 1024 : width === 390 ? 844 : 800;
    let stage = document.querySelector('.app-stage');
    let scale = Math.max(.1, Math.min(1, (stage.clientWidth - 24) / width, (stage.clientHeight - 24) / height));
    Object.assign(get('frame').style, { width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` });
    Object.assign(get('preview-sizer').style, { width: `${width * scale}px`, height: `${height * scale}px` });
    if (get('frame').querySelector('iframe:not([hidden])')) write(get('retention-note'), `${width} × ${height} · interactive`);
  };
  get('viewport').addEventListener('change', sizePreview);
  new ResizeObserver(sizePreview).observe(document.querySelector('.app-stage'));
  sizePreview();
  get('expand').addEventListener('click', () => {
    let expanded = document.body.classList.toggle('app-expanded');
    get('expand').setAttribute('aria-pressed', String(expanded));
    write(get('expand'), expanded ? 'Restore layout' : 'Expand app');
  });
  get('copy-output').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(actions.copy()); write(get('copy-output'), 'Copied'); write(get('copy-status'), 'Test output copied.'); }
    catch { write(get('copy-status'), 'Could not copy. Select the output and copy it with your browser.'); }
  });
  let divider = get('output-divider');
  let resize = (x, y) => {
    let bounds = get('workspace').getBoundingClientRect();
    let vertical = matchMedia('(min-width:1100px)').matches;
    let size = vertical ? Math.max(280, Math.min(bounds.width - 360, bounds.right - x)) : Math.max(160, Math.min(bounds.height - 220, bounds.bottom - y));
    get('workspace').style.setProperty(vertical ? '--output-width' : '--output-height', `${size}px`);
    divider.setAttribute('aria-valuenow', String(Math.round(100 * size / (vertical ? bounds.width : bounds.height))));
  };
  divider.addEventListener('pointerdown', event => { divider.setPointerCapture(event.pointerId); });
  divider.addEventListener('pointermove', event => { if (divider.hasPointerCapture(event.pointerId)) resize(event.clientX, event.clientY); });
  divider.addEventListener('pointerup', event => divider.releasePointerCapture(event.pointerId));
  divider.addEventListener('keydown', event => {
    let keys = matchMedia('(min-width:1100px)').matches ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let bounds = divider.getBoundingClientRect();
    resize(bounds.left + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0), bounds.top + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0));
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable=true]')) {
      event.preventDefault(); get('test-search').focus();
    }
    if (event.key === 'Escape' && document.body.classList.contains('app-expanded')) get('expand').click();
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
      failure.append(element('h4', '', error.message));
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
      content.push(logs);
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
    let titles = {
      connecting: 'Connecting to your app…', discovering: 'Discovering tests…',
      running: `Running ${Math.min(passed + failed + 1, total)} of ${total} tests`, pausing: 'Pausing after this test…', paused: 'Paused for inspection',
      completed: failed ? `${failed} ${failed === 1 ? 'test' : 'tests'} failed` : 'All tests passed',
      stopped: 'Run stopped', error: 'The run could not finish'
    };
    write(get('status'), titles[state.phase]);
    get('run-indicator').dataset.phase = state.phase;
    get('run-indicator').dataset.failed = String(failed > 0);
    write(get('run-meta'), state.error ?? (state.current !== null && active ? state.tests.find(item => item.index === state.current)?.name ?? 'Loading the test runtime' : `${state.files.length} test ${state.files.length === 1 ? 'file' : 'files'} · ${state.appHost || location.host}`));
    write(get('passed-count'), String(passed)); write(get('failed-count'), String(failed)); write(get('pending-count'), String(total - passed - failed));
    write(get('test-count'), String(total)); write(get('run-duration'), duration(state.duration));
    get('progress').max = Math.max(total, 1); get('progress').value = passed + failed;
    get('rerun').disabled = !total && state.phase !== 'error';
    get('run-failed').disabled = !failed;
    get('run-selected').disabled = !test;
    get('stop').disabled = !['discovering', 'running', 'pausing', 'paused'].includes(state.phase);
    get('pause').hidden = !state.interactive;
    get('pause-setting').hidden = !state.interactive;
    get('pause').disabled = !active;
    write(get('pause'), state.phase === 'pausing' ? 'Keep running' : 'Pause after this test');
    get('pause-on-failure').checked = state.pauseOnFailure;
    get('pause-banner').hidden = state.phase !== 'paused';
    write(get('pause-reason'), test?.status === 'failed' ? 'Inspect the failure and its app before continuing.' : 'The app is ready to inspect.');
    get('viewport').disabled = active;
    if (active && get('viewport').value !== '1280') { get('viewport').value = '1280'; sizePreview(); }
    for (let button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
    let visible = 0;
    for (let item of state.tests) {
      let row = rows.get(item.index);
      if (!row) {
        let node = element('li');
        let select = element('button', 'test-select');
        let symbol = element('span', 'test-symbol'); symbol.setAttribute('aria-hidden', 'true');
        let label = element('span', 'test-name', item.name);
        let time = element('span', 'test-time'); label.append(time);
        select.append(symbol, label); select.addEventListener('click', () => actions.select(item.index));
        let rerun = element('button', 'text-button test-rerun', '↗');
        rerun.title = 'Run this test'; rerun.setAttribute('aria-label', `Run test: ${item.name}`);
        rerun.addEventListener('click', () => actions.rerun([item.name]));
        node.append(select, rerun); get('results').append(node);
        row = { node, select, symbol, time }; rows.set(item.index, row);
      }
      row.node.dataset.status = item.status; row.node.dataset.selected = String(item.index === test?.index);
      row.select.setAttribute('aria-current', String(item.index === test?.index));
      row.select.setAttribute('aria-label', `${names[item.status]}: ${item.name}`);
      write(row.symbol, symbols[item.status]); write(row.time, item.status === 'pending' ? 'Not run yet' : item.status === 'running' ? 'Running' : duration(item.duration));
      row.node.hidden = !(item.name.toLowerCase().includes(state.query.toLowerCase()) && (state.filter === 'all' || item.status === state.filter));
      if (!row.node.hidden) visible++;
    }
    get('empty-results').hidden = visible > 0 || !total;
    write(get('file-count'), `${state.files.length} test ${state.files.length === 1 ? 'file' : 'files'}`);
    if (get('files').childElementCount !== state.files.length) get('files').replaceChildren(...state.files.map(file => element('li', '', file)));
    write(get('browser-name'), state.browser);
    write(get('selected-name'), test?.name ?? 'Select a test to see its output');
    write(get('selected-status'), test ? `${names[test.status]}${duration(test.duration) ? ` · ${duration(test.duration)}` : ''}` : 'Waiting');
    get('selected-status').dataset.status = test?.status ?? 'pending';
    write(get('output-count'), test?.output.length ? `${test.output.length} console ${test.output.length === 1 ? 'message' : 'messages'}` : '');
    get('copy-output').disabled = !test || !navigator.clipboard?.writeText;
    get('copy-output').title = navigator.clipboard ? 'Copy this test’s result and console output' : 'Clipboard access needs a secure browser origin';
    renderOutput(test, state.error);
    let preview = active ? state.tests.find(item => item.index === state.current) : test;
    let frame = frames.get(preview?.index);
    for (let [index, resource] of frames) resource.frame.hidden = index !== preview?.index;
    get('preview-empty').hidden = Boolean(frame);
    get('inspect-rerun').hidden = !preview || Boolean(frame) || active;
    write(get('preview-empty').querySelector('h3'), preview && !frame ? 'Rerun this test to inspect its app' : 'See the test. Inspect the app.');
    write(get('preview-empty').querySelector('p'), preview && !frame ? 'Each new test replaces the app context. Run this test on its own to inspect its app.' : 'The real application renders here as your tests run.');
    write(get('preview-state'), frame ? active ? 'Live' : 'Retained' : 'Waiting');
    write(get('app-address'), preview?.path ? `${location.origin}${preview.path}` : state.appHost || 'Your app will appear here');
    write(get('preview-name'), frame ? preview.name : 'Fresh browser context for every test');
    write(get('retention-note'), frame ? `${get('viewport').selectedOptions[0].textContent} · interactive` : '');
    get('follow').hidden = !active || state.selected === null || state.selected === state.current;
    write(get('connection-state'), state.phase === 'completed' ? 'Run complete' : state.phase === 'paused' ? 'Paused' : state.phase === 'error' ? 'Run error' : state.phase === 'stopped' ? 'Stopped' : 'Browser connected');
  };
}
