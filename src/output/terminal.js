import { dirname } from 'node:path';
import { testTitle } from '../suite.js';
import { testCommand } from '../repeat.js';
import { timingDuration, failurePhase, sourceLocation, slowWorkLabel } from '../browser/timing-format.js';
import {
  plural, displayPath, tally, errorsOf, extraFrames, codeFrame, browserName, coverageText, coverageScope, attachmentText,
} from './format.js';
import { out, err, withRun, withoutRun } from './state.js';

// The human reporter: results grouped by file and suite, failures explained
// once in full, and a summary that leads with the outcome.

let marks = { passed: '✓', failed: '✗', skipped: '−' };
let markStyles = { passed: 'green', failed: 'red', skipped: 'dim' };
let slow = 1000;
let indent = depth => '  '.repeat(depth);
let pad = text => text ? '   ' + text : '';
let label = (paint, name, value) => `  ${paint('dim', name.padEnd(10))} ${value}`;
let reportLine = (paint, cwd, report) => report?.html ? [label(paint, 'Report', displayPath(report.html, cwd))] : [];

export let initialTerminal = Object.freeze({ pendingHeader: null, repeat: null, round: null, runs: {}, seen: {} });

let emptyRun = Object.freeze({ file: null, path: [], failures: [], screenshots: 0, screenshotDir: null });

function repeatLines(repeat, { paint }) {
  if (!repeat) return [];
  return [
    label(paint, 'Repeat', `${plural(repeat.requested, 'round')}, reusing browser storage and project worker resources`),
    ...(repeat.seed !== null ? [label(paint, 'Root seed', repeat.seed)] : []),
    label(paint, 'Command', repeat.command),
  ];
}

// One line of facts, joined with words and commas. URLs only appear when
// someone needs to open them: manual, --ui, and --watch sessions.
function headerLines(ready, tests, repeat, context) {
  let { paint, version, persistent } = context;
  let facts = [
    browserName(ready.browser) || 'your browser',
    tests ? `${plural(tests.length, 'test')} in ${plural(new Set(tests.map(test => test.file)).size, 'file')}` : plural(ready.files.length, 'test file'),
    ready.workers?.length > 1 ? `${ready.workers.length} workers` : '',
    `app at ${ready.appURL?.replace(/^https?:\/\//, '').replace(/\/$/, '')}`,
  ].filter(Boolean).join(', ');
  let lines = ['', `${paint('bold', 'dyno')} ${paint('dim', version)}  ${facts}`];
  if (!ready.browser) lines.push(label(paint, 'Open', `${ready.url} ${paint('dim', 'in any browser to start')}`));
  else if (persistent) lines.push(label(paint, 'Runner', ready.url));
  for (let [index, url] of (ready.devices ?? []).entries()) lines.push(label(paint, index ? '' : 'Devices', url));
  if (ready.seed !== null && ready.seed !== undefined) lines.push(label(paint, 'Seed', ready.seed));
  if (ready.replay) lines.push(label(paint, 'Replay', `${plural(ready.replay.selected, 'assigned test')}${ready.replay.omitted ? `, ${plural(ready.replay.omitted, 'unassigned test')} left out` : ''}`));
  return [...lines, ...repeatLines(repeat, context)];
}

// File and suite headings print when they change, so concurrent workers still
// read correctly; their tests just regroup more often.
function testLines(run, test, { paint, cwd }) {
  let lines = [];
  let path = run.path;
  if (test.file !== run.file) {
    lines.push('', paint('bold', test.file ?? 'Tests'));
    path = [];
  }
  let suites = test.suites ?? [];
  let shared = 0;
  while (shared < path.length && shared < suites.length && path[shared] === suites[shared]) shared++;
  for (let depth = shared; depth < suites.length; depth++) lines.push(indent(depth + 1) + suites[depth]);
  let depth = suites.length + 1;
  let time = test.status === 'skipped' ? paint('dim', 'skipped')
    : test.duration === undefined ? '' : paint(test.duration >= slow ? 'yellow' : 'dim', timingDuration(test.duration));
  let name = test.status === 'failed' ? paint('red', test.name) : test.status === 'skipped' ? paint('dim', test.name) : test.name;
  lines.push(`${indent(depth)}${paint(markStyles[test.status], marks[test.status])} ${name}  ${time}`.trimEnd());
  // A skipped optional screenshot is a warning worth seeing in place.
  for (let attachment of test.attachments ?? [])
    if (attachment.status !== 'captured') lines.push(indent(depth + 1) + paint('yellow', attachmentText(attachment, cwd)));
  return lines;
}

function failureLines(test, number, { paint, cwd, options = {} }) {
  let lines = ['', `${paint(['red', 'bold'], String(number).padEnd(2))} ${paint('bold', testTitle(test))}`];
  for (let [index, error] of errorsOf(test).entries()) {
    if (index) lines.push('', pad(paint('dim', 'It also failed with')));
    for (let text of error.message.split('\n')) lines.push(pad(paint('red', text)));
    let location = sourceLocation(error);
    let phase = failurePhase(error);
    if (location || phase) lines.push('', pad(location ? location + (phase ? paint('dim', `, ${phase}`) : '') : paint('dim', phase)));
    let frame = codeFrame(error.source, { mark: text => paint('bold', text), dim: text => paint('dim', text) });
    lines.push(...frame.map(text => pad('  ' + text)));
    let frames = extraFrames(error, cwd, location);
    if (frames.length) lines.push('', ...frames.map(text => pad(paint('dim', text))));
  }
  let output = (test.output ?? []).slice(-10);
  if (output.length) {
    lines.push('', pad(paint('dim', 'Console' + (test.output.length > output.length ? `, last ${output.length} of ${test.output.length}` : ''))));
    for (let entry of output)
      lines.push(pad(`  ${paint({ error: 'red', warn: 'yellow' }[entry.level] ?? 'dim', entry.level.padEnd(5))} ${entry.text.split('\n')[0].slice(0, 200)}`));
  }
  for (let attachment of test.attachments ?? [])
    if (attachment.status === 'captured') lines.push('', pad(paint('dim', attachmentText(attachment, cwd))));
  lines.push('', pad(`${paint('dim', 'Rerun')}  ${testCommand(options, test)}`));
  return lines;
}

function coverageLines(coverage, { paint, showCoverage }) {
  if (!coverage) return [];
  let lines = showCoverage ? [label(paint, 'Coverage', `${coverageText(coverage.summary)} ${paint('dim', `in ${coverageScope(coverage)}`)}`)] : [];
  for (let failure of coverage.failures ?? []) lines.push(label(paint, lines.length ? '' : 'Coverage', paint('red', failure)));
  return lines;
}

function headline(event, paint) {
  let total = event.passed + event.failed + event.skipped;
  let time = timingDuration(event.duration);
  if (event.failed) return paint(['red', 'bold'], `✗ ${event.failed} of ${plural(total, 'test')} failed in ${time}`);
  if (event.coverage?.failures?.length) return paint(['red', 'bold'], '✗ Coverage is below its threshold') + paint('dim', `, tests passed in ${time}`);
  let passed = total === event.passed ? (total === 1 ? '1 test' : `All ${total} tests`) : `${event.passed} of ${plural(total, 'test')}`;
  return paint(['green', 'bold'], `✓ ${passed} passed in ${time}`);
}

function summaryLines(event, run, context) {
  let { paint, cwd } = context;
  let lines = [];
  if (run.failures.length) {
    lines.push('', '', paint('bold', 'Failures'));
    for (let [index, test] of run.failures.entries()) lines.push(...failureLines(test, index + 1, context));
  }
  lines.push('', '', headline(event, paint), '');
  // The headline already says everything passed; the breakdown is for mixed results.
  if (event.failed || event.skipped) lines.push(label(paint, 'Tests', tally(event, paint)));
  let coordination = event.coordination;
  if (coordination?.workers.length > 1)
    lines.push(label(paint, 'Workers', `${coordination.workers.length} workers, ${timingDuration(coordination.wallDuration)} wall time, ${timingDuration(coordination.testWorkDuration)} of test work`));
  // Durations sit in the tree already. Call out only the slow ones shown in yellow.
  let slowest = (event.performance?.slowestTests ?? []).filter(test => test.duration >= slow).slice(0, 3);
  for (let [index, test] of slowest.entries()) {
    let step = slowWorkLabel(test);
    lines.push(label(paint, index ? '' : 'Slowest', `${paint('yellow', timingDuration(test.duration).padEnd(7))} ${testTitle(test)}${step ? paint('dim', `, ${step}`) : ''}`));
  }
  lines.push(...coverageLines(event.coverage, context));
  if (run.screenshots)
    lines.push(label(paint, 'Images', `${plural(run.screenshots, 'screenshot')} ${paint('dim', 'in')} ${displayPath(run.screenshotDir, cwd)}`));
  return [...lines, ...reportLine(paint, cwd, event.report)];
}

let failureKey = test => `${test.testId}\n${test.error?.message}`;

// A failure repeated across rounds is explained in full once, then named.
function roundLines(event, run, seen, context) {
  let { paint, cwd } = context;
  let lines = [`  ${paint(event.failed ? 'red' : 'green', event.failed ? '✗' : '✓')} ${tally(event, paint)} ${paint('dim', `in ${timingDuration(event.duration)}`)}`];
  for (let [index, test] of run.failures.entries()) {
    let round = seen[failureKey(test)];
    lines.push(...(round === undefined ? failureLines(test, index + 1, context)
      : [`  ${paint('red', '✗')} ${testTitle(test)} ${paint('dim', `failed the same way as in round ${round}`)}`]));
  }
  let report = reportLine(paint, cwd, event.report);
  return report.length ? [...lines, '', ...report] : lines;
}

function repeatSummary(event, { paint, cwd }) {
  let titles = event.tests.map(testTitle);
  let width = Math.max(...titles.map(title => title.length));
  let passed = event.status === 'passed';
  let lines = ['', paint([passed ? 'green' : 'red', 'bold'], `${passed ? '✓' : '✗'} Repeated runs ${event.status}`),
    label(paint, 'Rounds', `${event.completed} of ${event.requested} completed, ${plural(event.failedRounds, 'round')} with failures`)];
  for (let [index, test] of event.tests.entries())
    lines.push(label(paint, index ? '' : 'Tests', `${titles[index].padEnd(width)}  ${tally(test, paint)}`));
  if (event.firstFailure) {
    lines.push(label(paint, 'First', `failed in round ${event.firstFailure.round}: ${paint('red', event.firstFailure.error?.message ?? 'Run interrupted')}`));
    if (event.firstFailureReplay) lines.push(label(paint, 'Replay', event.firstFailureReplay));
    lines.push(label(paint, 'Reproduce', event.prefixCommand));
  }
  return [...lines, ...reportLine(paint, cwd, event)];
}

export function terminalStep(state, event, context) {
  let { paint, paintErr, persistent } = context;
  switch (event.type) {
    // Headless runs wait for the test count so the header is one complete line.
    // Repeated runs print it now, ahead of the first round.
    case 'ready':
      return persistent || !event.browser || state.repeat
        ? { state, writes: out(headerLines(event, null, state.repeat, context)) }
        : { state: { ...state, pendingHeader: event }, writes: [] };
    case 'capture':
      return { state, writes: persistent ? out([label(paint, 'Reporter', event.reporterURL)]) : [] };
    case 'start': {
      let next = { ...withRun(state, event.runId, emptyRun, () => emptyRun), pendingHeader: null };
      if (state.pendingHeader) return { state: next, writes: out(headerLines(state.pendingHeader, event.tests, state.repeat, context)) };
      return { state: next, writes: state.repeat ? [] : out(['', '', paint('dim', `Running ${plural(event.tests.length, 'test')}`)]) };
    }
    case 'test': {
      let run = state.runs[event.runId] ?? emptyRun;
      let captured = (event.attachments ?? []).filter(item => item.status === 'captured');
      let next = withRun(state, event.runId, emptyRun, () => ({
        failures: event.status === 'failed' ? [...run.failures, event] : run.failures,
        screenshots: run.screenshots + captured.length,
        screenshotDir: run.screenshotDir ?? (captured[0] ? dirname(captured[0].path) : null),
        ...(state.repeat ? {} : { file: event.file, path: event.suites ?? [] }),
      }));
      return { state: next, writes: state.repeat ? [] : out(testLines(run, event, context)) };
    }
    // Run coverage arrives on its complete event. Repeated runs report it once at the end.
    case 'coverage':
      return { state, writes: event.batchId ? out(['', ...coverageLines(event, context)]) : [] };
    case 'complete': {
      let run = state.runs[event.runId] ?? emptyRun;
      let next = withoutRun(state, event.runId);
      if (!state.repeat) return { state: next, writes: out(summaryLines(event, run, context)) };
      let seen = { ...Object.fromEntries(run.failures.map(test => [failureKey(test), state.round])), ...state.seen };
      return { state: { ...next, seen }, writes: out(roundLines(event, run, state.seen, context)) };
    }
    case 'fatal':
      return {
        state: withoutRun(state, event.runId),
        writes: [...err(['', paintErr(['red', 'bold'], `✗ Browser run failed: ${event.error?.message ?? 'Unknown error'}`)]),
          ...out(reportLine(paint, context.cwd, event.report))],
      };
    case 'watch':
      return { state, writes: err([paintErr('yellow', `Watch: ${event.message ?? event.status}`)]) };
    // Printed with the header once the runner is ready.
    case 'repeat-start':
      return { state: { ...state, repeat: event }, writes: [] };
    case 'repeat-round':
      return { state: { ...state, round: event.round }, writes: out(['', paint('bold', `Round ${event.round}/${event.requested}`)]) };
    case 'repeat-complete':
      return {
        state,
        writes: [...out(repeatSummary(event, context)),
          ...(event.reason ? err([paintErr('yellow', `Repeated runs stopped: ${event.reason}`)]) : [])],
      };
    case 'browser-stopped':
      return { state, writes: event.graceful ? [] : err([paintErr('yellow', 'The browser needed forced cleanup. See session.json for timings.')]) };
    case 'session-timing':
      return { state, writes: out([label(paint, 'Total', `${timingDuration(event.timings.duration)} ${paint('dim', 'with startup and cleanup')}`), '']) };
    default:
      return { state, writes: [] };
  }
}
