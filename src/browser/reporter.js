import { slowestTests } from './timings.js';
import { pullCurve, pullSheet, ghostCurve, pace, sheetSummary, sheetHead, tachometer, usable, testCount, sheetNote, sheetSpan } from './dyno-chart.js';
import { timingDuration, timingLabels, timingPhases, timingOperations, timingText, failurePlace } from './timing-format.js';

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
    filter: filters.includes(params.get('status')) ? params.get('status') : 'all',
    worker: params.get('worker') ?? ''
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
  if (route.worker) params.set('worker', route.worker);
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
// How many tests have each status, in one pass.
let tally = (tests) => {
  let counts = {};
  for (let test of tests) counts[test.status] = (counts[test.status] ?? 0) + 1;
  return counts;
};

let symbols = { pending: '○', running: '◌', passed: '✓', failed: '×', stopped: '■', skipped: '−', outside: '·' };
let names = {
  pending: 'Pending',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped',
  outside: 'Not in this run'
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
  let bays = new Map();
  let workerCount = (used, slots) => slots > used ? `, ${used} of ${slots} workers` : used > 1 ? `, ${used} workers` : '';
  // The listed tests from the latest render, for checkboxes and scoped runs.
  let lastListed = [];
  // Tests picked with checkboxes. Kept across reruns so a set can run again.
  let picked = new Set();

  let bayPhases = { connecting: 'Starting', discovering: 'Loading tests', running: 'Running', pausing: 'Pausing after this test',
    paused: 'Paused', resuming: 'Resuming', debugging: 'Debugging', completed: 'Done', stopped: 'Stopped', error: 'Stopped',
    retired: 'Closed', waiting: 'Waiting' };
  // One bay per worker: what it's doing, its current test, and its own results.
  let renderBays = (state) => {
    let workers = state.workers ?? [];
    get('bays').hidden = workers.length < 2;
    let byWorker = new Map();
    for (let test of state.tests) byWorker.set(test.workerId, [...(byWorker.get(test.workerId) ?? []), test]);
    for (let worker of workers) {
      let bay = bays.get(worker.id);
      if (!bay) {
        let node = element('li', 'bay');
        let select = element('button', 'bay-select');
        select.dataset.worker = worker.id;
        let name = element('span', 'bay-name', `Worker ${worker.id}`);
        let phase = element('span', 'bay-phase');
        let current = element('span', 'bay-test');
        let tally = element('span', 'bay-tally');
        select.append(name, phase, current, tally);
        select.addEventListener('click', () => actions.focusWorker(worker.id));
        let controls = element('span', 'bay-controls');
        let hold = element('button', 'text-button bay-hold');
        hold.addEventListener('click', () => (bays.get(worker.id).held ? actions.continueWorker : actions.pauseWorker)(worker.id));
        let app = element('button', 'text-button bay-app', 'Show app');
        app.setAttribute('aria-label', `Show worker ${worker.id}'s app`);
        app.addEventListener('click', () => actions.showApp(worker.id));
        controls.append(hold, app);
        node.append(select, controls);
        get('bay-list').append(node);
        bay = { node, select, phase, current, tally, app, hold, held: false };
        bays.set(worker.id, bay);
      }
      let mine = byWorker.get(worker.id) ?? [];
      let { passed = 0, failed = 0, running: busy = 0 } = tally(mine);
      let running = mine.find((test) => test.status === 'running') ??
        (worker.current === null ? undefined : mine.find((test) => test.index === worker.current));
      // A held worker is pausing while its current test runs, then paused.
      let phase = state.waiting ? 'waiting' : worker.held && worker.phase === 'running'
        ? (busy ? 'pausing' : 'paused') : worker.phase;
      // Pause or continue just this worker while the run is going.
      bay.held = worker.held;
      let live = !state.waiting && ['running', 'pausing', 'paused', 'resuming'].includes(worker.phase) && !['completed', 'stopped', 'error'].includes(state.phase);
      bay.hold.hidden = !live;
      write(bay.hold, worker.held ? 'Continue' : 'Pause');
      bay.hold.setAttribute('aria-label', `${worker.held ? 'Continue' : 'Pause'} worker ${worker.id}`);
      bay.hold.disabled = state.connection !== 'connected' || state.command?.status === 'pending';
      bay.node.dataset.phase = phase;
      bay.node.dataset.failed = String(failed > 0);
      bay.select.setAttribute('aria-pressed', String(worker.id === state.selectedWorker));
      write(bay.phase, bayPhases[phase] ?? phase);
      write(bay.current, running && ['running', 'pausing', 'paused', 'debugging'].includes(worker.phase) ? running.name : '');
      write(bay.tally, mine.length ? `${passed} passed${failed ? `, ${failed} failed` : ''}` : state.waiting ? 'Ready' : 'No tests yet');
      bay.app.disabled = worker.phase === 'retired' || state.connection !== 'connected';
    }
  };

  // The list shows the run's tests plus any the run left out, in suite order.
  let listing = (state) => {
    let outside = (state.outside ?? []).map((test) => ({ ...test, status: 'outside', output: [], attachments: [] }));
    return outside.length ? [...state.tests, ...outside].sort((left, right) => left.index - right.index) : state.tests;
  };
  let testsIn = (file, path = []) => lastListed.filter((test) =>
    test.file === file && path.every((name, index) => test.suites[index] === name)).map((test) => test.id);
  let syncPicks = () => {
    let total = picked.size;
    get('results').classList.toggle('picking', total > 0);
    for (let [id, row] of rows) row.pick.checked = picked.has(id);
    // Picked and total tests per file and per suite (nested suites included), in one pass.
    let counts = new Map();
    let add = (key, on) => {
      let entry = counts.get(key) ?? { chosen: 0, total: 0 };
      counts.set(key, { chosen: entry.chosen + Number(on), total: entry.total + 1 });
    };
    for (let test of lastListed) {
      let on = picked.has(test.id);
      add(JSON.stringify([test.file]), on);
      for (let depth = 1; depth <= test.suites.length; depth++) add(JSON.stringify([test.file, test.suites.slice(0, depth)]), on);
    }
    let mark = (input, key) => {
      let { chosen = 0, total = 0 } = counts.get(key) ?? {};
      input.checked = total > 0 && chosen === total;
      input.indeterminate = chosen > 0 && chosen < total;
    };
    for (let [file, group] of groups) mark(group.pick, JSON.stringify([file]));
    for (let suite of suites.values()) if (suite.pick) mark(suite.pick, JSON.stringify([suite.file, suite.path]));
    get('selection-bar').hidden = total === 0;
    write(get('selection-count'), `${total} ${total === 1 ? 'test' : 'tests'} selected`);
  };
  let pick = (ids, on) => {
    for (let id of ids) on ? picked.add(id) : picked.delete(id);
    syncPicks();
  };
  let checkbox = (label, ids) => {
    let input = element('input', 'pick');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => pick(ids(), input.checked));
    return input;
  };
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
  get('show-app').addEventListener('click', () => actions.showApp());
  get('run-selected').addEventListener('click', () => actions.rerun([...picked]));
  get('run-workers').addEventListener('change', (event) => actions.setRunWorkers(Number(event.target.value)));
  get('clear-selection').addEventListener('click', () => pick([...picked], false));
  get('clear-worker').addEventListener('click', () => actions.clearWorker());
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
  // The sheet makes the overview tall; bring disclosed details and empty results into view.
  for (let detail of document.querySelectorAll('.run-info'))
    detail.addEventListener('toggle', () => {
      if (detail.open) detail.scrollIntoView({ block: 'nearest' });
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
      failure.append(element('h2', '', error.message));
      let place = failurePlace(error);
      if (place) failure.append(element('p', 'failure-location', place));
      if (error.source) {
        let source = error.source;
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
            `${attachment.name}, ${attachment.width} × ${attachment.height} in ${attachment.browser.name}`
          )
        );
      } else figure.append(element('figcaption', '', `${attachment.name}: image skipped. ${attachment.reason}`));
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
    let phaseEntries = timingPhases(timings);
    let split = element('div', 'timing-split');
    split.setAttribute('aria-hidden', 'true');
    let phases = element('dl', 'timing-phases');
    for (let entry of phaseEntries) {
      let segment = element('span');
      segment.dataset.kind = entry.kind;
      segment.style.flexGrow = String(Math.max(entry.duration, 0.0001));
      segment.title = `${entry.name}: ${timingDuration(entry.duration)}`;
      split.append(segment);
      let group = element('div');
      let swatch = element('i');
      swatch.dataset.kind = entry.kind;
      group.append(swatch, element('dt', '', entry.name), element('dd', '', timingDuration(entry.duration)));
      phases.append(group);
    }
    let operations = timingOperations(timings);
    let begin = Math.min(...timings.entries.map((entry) => entry.start));
    let span = Math.max(...timings.entries.map((entry) => entry.start + entry.duration)) - begin || 1;
    let waterfall = element('ol', 'waterfall');
    waterfall.setAttribute('aria-hidden', 'true');
    for (let entry of operations.toSorted((a, b) => a.start - b.start || a.id - b.id).slice(0, 60)) {
      let row = element('li');
      let track = element('span', 'waterfall-track');
      let bar = element('span', 'waterfall-bar');
      bar.dataset.status = entry.status;
      bar.style.left = `${(((entry.start - begin) / span) * 100).toFixed(2)}%`;
      bar.style.width = `${((entry.duration / span) * 100).toFixed(2)}%`;
      bar.title = `${entry.name}: ${timingDuration(entry.duration)}`;
      track.append(bar);
      row.append(element('span', 'waterfall-name', entry.name), track);
      waterfall.append(row);
    }
    let table = element('table', 'timings-table');
    table.setAttribute('aria-label', 'Hooks, operations, and steps, slowest first');
    let heading = element('tr');
    for (let label of ['Work', 'Started', 'Duration']) {
      let cell = element('th', '', label); cell.scope = 'col'; heading.append(cell);
    }
    let head = element('thead'); head.append(heading); table.append(head);
    let body = element('tbody');
    for (let entry of operations) {
      let row = element('tr');
      let name = element('td');
      name.append(element('strong', '', entry.name), element('span', 'timing-kind',
        `${timingLabels[entry.kind]} in ${entry.phase ?? 'test'}, ${entry.status}`));
      row.append(name, element('td', '', timingDuration(entry.start)), element('td', '', timingDuration(entry.duration)));
      body.append(row);
    }
    table.append(body);
    container.replaceChildren(element('h2', '', `Where ${timingDuration(timings.duration)} went`), split, phases,
      ...(body.childElementCount ? [element('h2', '', 'Timeline'), waterfall] : []),
      element('h2', '', 'Hooks, operations, and steps'),
      element('p', 'output-notice', 'Times include waiting. Steps can contain operations and overlap; do not add these rows together. Debug pauses are included.'),
      body.childElementCount ? table : element('p', '', 'No app operations or named steps were recorded.'));
    if (timings.truncated) container.append(element('p', 'output-notice', `${timings.truncated} additional timings were not recorded.`));
  }

  let sheetKey;
  get('tach-slot').outerHTML = tachometer({ id: 'run-indicator' });
  let tach = get('run-indicator');
  let storedPull;
  let savedPull;
  let pullKey = (state) => `dyno:last-pull:${state.tests.length}:${state.files.join('|')}`;
  let readPull = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  let writePull = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in private or locked-down browsers; the sheet still renders.
    }
  };
  function renderSheet(state, curve, href) {
    // One worker's pull isn't comparable to the whole run, so it keeps no ghost.
    let key = curve.total && !state.route.worker ? pullKey(state) : undefined;
    if (key && storedPull?.key !== key) storedPull = { key, value: readPull(key) };
    let ghost = storedPull?.value?.runId !== state.runId ? storedPull?.value : undefined;
    if (key && state.phase === 'completed' && curve.done === curve.total && savedPull !== state.runId) {
      savedPull = state.runId;
      writePull(key, ghostCurve(curve, state.runId));
    }
    let shownGhost = usable(curve, ghost);
    write(get('ghost-legend'), shownGhost ? `Last pull, ${duration(shownGhost.time)}` : '');
    get('ghost-legend').hidden = !shownGhost;
    write(get('sheet-total'), curve.total ? testCount(curve.total) : '');
    write(get('sheet-time'), sheetSpan(curve, shownGhost));
    write(get('sheet-summary'), sheetSummary(curve));
    let average = pace(curve);
    write(get('run-pace'), average === undefined ? '—' : duration(average));
    let flag = get('sheet-flag');
    let head = sheetHead(curve, shownGhost);
    let finishedPull = curve.total && curve.done === curve.total && !curve.running;
    let label = curve.running ? curve.running.name : finishedPull ? sheetNote(curve) : '';
    flag.hidden = !label;
    flag.dataset.kind = curve.running ? 'running' : 'finished';
    flag.dataset.side = head.side;
    flag.style.left = `${head.left}%`;
    flag.style.top = `${head.top}%`;
    write(get('sheet-flag-text'), label);
    // Points only append during a run, so a few scalars identify the drawn sheet.
    let next = JSON.stringify([state.runId, curve.total, curve.done, curve.time, curve.running?.id, shownGhost?.time, state.route.query, state.route.filter]);
    if (next === sheetKey) return;
    sheetKey = next;
    get('sheet').innerHTML = pullSheet(curve, {
      ghost: shownGhost,
      href: (point) => href({ page: 'test', id: point.id, tab: 'output' })
    });
  }

  return function render(state) {
    let totals = tally(state.tests);
    let { passed = 0, failed = 0, skipped = 0 } = totals;
    let total = state.tests.length;
    let workers = state.workers ?? [];
    // Pressing a bay filters the list, sheet, and readouts to that worker.
    let scope = workers.some((worker) => worker.id === state.route.worker) ? state.route.worker : '';
    let scoped = scope ? state.tests.filter((test) => test.workerId === scope) : state.tests;
    let listed = listing(state);
    let shown = (test) =>
      `${test.file} ${test.suites.join(' ')} ${test.name}`.toLowerCase().includes(state.route.query.toLowerCase()) &&
      (state.route.filter === 'all' || test.status === state.route.filter) && (!scope || test.workerId === scope);
    lastListed = listed;
    renderBays(state);
    // Workers per run: from one up to every launched worker. The next run uses it.
    let slots = state.workerSlots ?? workers.length;
    get('workers-setting').hidden = slots < 2;
    // Auto fits the workers to each run's tests and timings.
    if (get('run-workers').options.length !== slots + 1)
      get('run-workers').replaceChildren(Object.assign(element('option', '', 'Auto'), { value: '' }), ...Array.from({ length: slots }, (_, index) => {
        let option = element('option', '', `${index + 1} of ${slots}`);
        option.value = String(index + 1);
        return option;
      }));
    let chosen = actions.runWorkers?.();
    get('run-workers').value = chosen ? String(Math.min(chosen, slots)) : '';
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
    let active = ['running', 'pausing', 'resuming'].includes(state.phase);
    // Starting a run needs a connected, idle runner.
    let blocked = active || state.phase === 'debugging' || unavailable;
    get('command-notice').hidden = !state.command || state.command.status === 'idle';
    write(
      get('command-status'),
      state.command?.status === 'pending' ? `Sending ${state.command.name}…` : (state.command?.message ?? '')
    );
    get('retry-command').hidden = state.command?.status !== 'failed';
    get('retry-command').disabled = state.connection !== 'connected';
    // The status row speaks only when something needs attention.
    write(
      get('connection-state'),
      state.connection === 'closed'
        ? 'The test browser disconnected. Restart Dyno or reopen its URL to reconnect.'
        : state.connection === 'connected' ? '' : 'Connecting to the test browser…'
    );
    get('connection-state').dataset.connection = state.connection;
    get('connection-state').hidden = state.connection === 'connected';
    write(get('capabilities'), state.capabilities && !state.capabilities.screenshot
      ? 'This browser can’t take screenshots, so app.screenshot() fails unless it’s optional.' : '');
    get('capabilities').hidden = !state.capabilities || Boolean(state.capabilities.screenshot);
    for (let link of document.querySelectorAll('.back-link,.brand')) link.href = href({ page: 'overview' });
    if (get('test-search').value !== state.route.query) get('test-search').value = state.route.query;
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
    // A waiting run has found its tests and holds them until you start one.
    let waiting = Boolean(state.waiting);
    let heading = waiting ? 'Ready to run' : titles[state.phase];
    document.title = `${test?.name ?? (view === 'missing' ? 'Test not found' : heading)} — Dyno`;
    write(
      get('status'),
      waiting ? heading : state.phase === 'paused'
        ? failed
          ? `${failed} ${failed === 1 ? 'test' : 'tests'} failed`
          : 'Test results'
        : titles[state.phase]
    );
    let curve = pullCurve(scoped);
    tach.dataset.phase = state.phase;
    tach.dataset.failed = String(failed > 0);
    tach.style.setProperty('--progress', curve.total ? (curve.done / curve.total).toFixed(3) : '0');
    write(
      get('run-meta'),
      state.error ?? (waiting
        ? `${total} ${total === 1 ? 'test is' : 'tests are'} ready. Run all of them, or a file, suite or single test from the list.`
        : `${state.files.length} test ${state.files.length === 1 ? 'file' : 'files'}${workerCount(workers.length, state.workerSlots ?? workers.length)}, app at ${state.appHost || location.host}`)
    );
    // Readouts follow the worker filter; the title stays about the whole run.
    let readout = scope ? tally(scoped) : totals;
    let [scopedPassed, scopedFailed, scopedSkipped] = ['passed', 'failed', 'skipped'].map((status) => readout[status] ?? 0);
    write(get('passed-count'), String(scopedPassed));
    write(get('failed-count'), String(scopedFailed));
    write(get('pending-count'), String(scoped.length - scopedPassed - scopedFailed - scopedSkipped));
    write(get('skipped-count'), String(scopedSkipped));
    get('skipped-summary').hidden = scopedSkipped === 0;
    get('failed-summary').dataset.failed = String(scopedFailed > 0);
    get('worker-scope').hidden = !scope;
    write(get('worker-scope-name'), scope ? `Worker ${scope}` : '');
    write(get('test-count'), listed.length > total ? `${total} of ${listed.length}` : String(total));
    write(get('run-duration'), duration(state.duration) || '—');
    document.documentElement.dataset.phase = state.phase;
    renderSheet(state, curve, href);
    let coordination = state.coordination;
    get('run-coordination').hidden = !coordination;
    get('worker-timings').hidden = !coordination;
    if (coordination) {
      write(get('run-coordination'), `${duration(coordination.wallDuration)} wall time, ${duration(coordination.testWorkDuration)} summed test work`);
      let lines = coordination.workers.map(worker => `Worker ${worker.id}: ${duration(worker.executionDuration)} execution (${duration(worker.projectPreparationDuration ?? 0)} preparation), ${duration(worker.handoffDuration)} handoff, ${duration(worker.queueDuration)} queue to assignment, ${duration(worker.unassignedDuration)} unassigned`);
      if (get('worker-timings').textContent !== lines.join(''))
        get('worker-timings').replaceChildren(...lines.map(line => element('li', '', line)));
    }
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
    get('progress').value = curve.done;
    get('progress').hidden = !active && state.phase !== 'discovering';
    get('rerun').disabled = detail ? !test : !total && state.phase !== 'error';
    write(get('rerun'), detail ? 'Run test' : 'Run all');
    get('run-failed').hidden = !failed;
    get('stop').hidden = waiting || !['discovering', 'running', 'pausing', 'paused', 'resuming', 'debugging'].includes(
      state.phase
    );
    get('run-options').hidden = !state.interactive;
    get('pause').disabled = !['running', 'pausing'].includes(state.phase);
    write(get('pause'), state.phase === 'pausing' ? 'Keep running' : 'Pause after this test');
    get('pause-on-failure').checked = state.pauseOnFailure;
    get('pause-banner').hidden = waiting || !['paused', 'debugging'].includes(state.phase);
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
    for (let button of document.querySelectorAll('[data-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === state.route.filter));
      let count = button.dataset.filter === 'all' ? total : totals[button.dataset.filter] ?? 0;
      write(button.querySelector('.filter-count'), total ? String(count) : '');
      button.dataset.count = String(count);
    }
    for (let group of reporterGroups(listed)) {
      let fileGroup = groups.get(group.file);
      if (!fileGroup) {
        let node = element('section', 'file-group');
        let heading = element('header', 'group-heading');
        let title = element('h2', '', group.file);
        let count = element('span', 'group-count');
        let run = element('button', 'text-button', 'Run file');
        run.setAttribute('aria-label', `Run file ${group.file}`);
        run.addEventListener('click', () => actions.rerun(testsIn(group.file)));
        let filePick = checkbox(`Select every test in ${group.file}`, () => testsIn(group.file));
        heading.append(filePick, title, count, run);
        node.append(heading);
        get('results').append(node);
        fileGroup = { node, count, run, pick: filePick };
        groups.set(group.file, fileGroup);
      }
      let { failed: failedCount = 0, outside = 0 } = tally(group.tests);
      let ran = group.tests.length - outside;
      let head = outside ? `${ran} of ${group.tests.length} tests in this run` : `${ran} ${ran === 1 ? 'test' : 'tests'}`;
      write(fileGroup.count, `${head}${failedCount ? `, ${failedCount} failed` : ''}`);
      fileGroup.run.disabled = blocked;
      let fileVisible = false;
      for (let suite of group.suites) {
        let key = JSON.stringify([group.file, ...suite.path]);
        let suiteGroup = suites.get(key);
        if (!suiteGroup) {
          let node = element('section', 'suite-group');
          let suitePick;
          if (suite.path.length || group.suites.length > 1) {
            let heading = element('header', 'group-heading suite-heading');
            if (suite.path.length) {
              suitePick = checkbox(`Select every test in ${suite.path.join(' › ')}`, () => testsIn(group.file, suite.path));
              heading.append(suitePick);
            }
            heading.append(element('h3', '', suite.path.join(' › ') || 'File tests'));
            let run = element('button', 'text-button', 'Run suite');
            run.hidden = !suite.path.length;
            run.setAttribute('aria-label', `Run suite ${suite.path.join(' › ')} in ${group.file}`);
            run.addEventListener('click', () => actions.rerun(testsIn(group.file, suite.path)));
            heading.append(run);
            node.append(heading);
          }
          let list = element('ol', 'suite-tests');
          node.append(list);
          fileGroup.node.append(node);
          suiteGroup = { node, list, pick: suitePick, file: group.file, path: suite.path };
          suites.set(key, suiteGroup);
        }
        for (let run of suiteGroup.node.querySelectorAll(':scope > .group-heading button'))
          run.disabled = blocked;
        let matches = suite.tests.some((test) => shown(test));
        suiteGroup.node.hidden = !matches;
        fileVisible ||= matches;
      }
      fileGroup.node.hidden = !fileVisible;
    }
    let visible = 0;
    let slowest = Math.max(0, ...state.tests.filter((item) => item.status !== 'running').map((item) => item.duration ?? 0));
    for (let item of listed) {
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
        let load = element('span', 'test-load');
        load.setAttribute('aria-hidden', 'true');
        let time = element('span', 'test-time');
        select.append(symbol, label, load, time);
        // Every row can run its own test. The button sits beside the row link.
        let run = element('button', 'text-button row-run', 'Run');
        run.setAttribute('aria-label', `Run test ${item.name}`);
        run.addEventListener('click', () => actions.rerun([item.id]));
        let rowPick = checkbox(`Select ${item.name}`, () => [item.id]);
        node.append(rowPick, select, run);
        suites.get(JSON.stringify([item.file, ...item.suites])).list.append(node);
        row = { node, select, symbol, error, time, load, run, pick: rowPick };
        rows.set(item.id, row);
      }
      // A left-out test has no results to open yet; it can still be picked or run.
      if (item.status === 'outside') row.select.removeAttribute('href');
      else row.select.href = href({ page: 'test', id: item.id, tab: 'output' });
      row.run.disabled = blocked;
      row.select.title = [item.file, ...item.suites, item.name].join(' › ');
      row.node.dataset.status = item.status;
      row.select.setAttribute('aria-label', `${names[item.status]}: ${item.name}`);
      write(row.symbol, symbols[item.status]);
      write(
        row.time,
        item.status === 'outside' ? names.outside
          : ['pending', 'skipped'].includes(item.status) ? '—' : item.status === 'running' ? 'Running' : duration(item.duration)
      );
      let load = slowest ? Math.min((item.duration ?? 0) / slowest, 1).toFixed(3) : '0';
      if (row.load.style.getPropertyValue('--load') !== load) row.load.style.setProperty('--load', load);
      row.error.hidden = !item.error;
      write(row.error, item.error?.message ?? '');
      row.node.hidden = !shown(item);
      if (!row.node.hidden) visible++;
    }
    let emptyHidden = visible > 0 || !total;
    if (get('empty-results').hidden && !emptyHidden) requestAnimationFrame(() => get('empty-results').scrollIntoView({ block: 'nearest' }));
    get('empty-results').hidden = emptyHidden;
    if (get('files').childElementCount !== state.files.length)
      get('files').replaceChildren(...state.files.map((file) => element('li', '', file)));
    write(get('browser-name'), state.browser);
    write(get('app-host'), state.appHost);
    get('run-seed').hidden = state.seed == null;
    write(get('run-seed'), state.seed == null ? '' : `Seed: ${state.seed}`);
    get('standalone-reporter').hidden = !actions.embedded;
    get('standalone-reporter').href = `/__dyno__/reporter?run=${encodeURIComponent(state.runId)}${state.selectedWorker ? '&worker=' + encodeURIComponent(state.selectedWorker) : ''}${location.hash}`;
    write(get('selected-context'), test ? [test.file, ...test.suites, ...(workers.length > 1 && test.workerId ? ['Worker ' + test.workerId] : [])].join(' › ') : '');
    write(get('selected-name'), test?.name ?? 'Loading test…');
    write(
      get('selected-status'),
      test ? `${names[test.status]}${duration(test.duration) ? ` in ${duration(test.duration)}` : ''}` : ''
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
    get('close-reporter').disabled = state.appOpen === false;
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
    get('run-selected').disabled = blocked;
    get('run-failed').disabled = blocked;
    syncPicks();
  };
}
