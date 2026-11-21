import { testTitle } from '../suite.js';
import { testCommand } from '../repeat.js';
import { timingDuration, failurePhase, sourceLocation } from '../browser/timing-format.js';
import {
  plural, displayPath, tally, errorsOf, extraFrames, codeFrame, codeLanguage, browserName, coverageText, coverageScope,
  attachmentText,
} from './format.js';
import { out, err, withRun, withoutRun } from './state.js';

// The agent reporter. Plain Markdown with no color, no progress, and no
// passing-test noise. Each failure stands alone: what, where, the code, and the
// exact command to rerun it. Full detail stays in run.json.

export let initialLLM = Object.freeze({ ready: null, repeat: null, runs: {}, firstFailures: null });

// Passing tests only count. Failures keep their events; skipped tests keep a name.
let emptyRun = Object.freeze({ count: 0, failures: [], skipped: [] });

let fenced = (text, language = 'text') => {
  let fence = text.includes('```') ? '````' : '```';
  return [fence + language, text, fence];
};

function failureBlock(test, number, { cwd, options = {} }) {
  let lines = ['', `## ${number}. ${testTitle(test)}`, ''];
  for (let [index, error] of errorsOf(test).entries()) {
    if (index) lines.push('', 'It also failed with:', '');
    lines.push(...(error.message.includes('\n') ? ['Error:', '', ...fenced(error.message), ''] : [`Error: ${error.message}`]));
    let location = sourceLocation(error);
    lines.push(`At: ${[location || test.file || 'unknown file', failurePhase(error)].filter(Boolean).join(', ')}`);
    let frame = codeFrame(error.source);
    if (frame.length) lines.push('', ...fenced(frame.join('\n'), codeLanguage(error.source.file)));
    let frames = extraFrames(error, cwd, location);
    if (frames.length) lines.push('', 'Stack (project frames):', '', ...fenced(frames.join('\n')));
  }
  let output = (test.output ?? []).slice(-20);
  if (output.length)
    lines.push('', `Console output${test.output.length > output.length ? ` (last ${output.length} of ${test.output.length})` : ''}:`, '',
      ...fenced(output.map(entry => `[${entry.level}] ${entry.text}`).join('\n')));
  let screenshots = (test.attachments ?? []).map(attachment => attachmentText(attachment, cwd));
  if (screenshots.length) lines.push('', ...screenshots);
  lines.push('', `Rerun: \`${testCommand(options, test)}\``);
  return lines;
}

function runBlock(event, run, ready, context) {
  let total = event.passed + event.failed + event.skipped;
  let browser = browserName(ready?.browser);
  let title = event.failed ? `${event.failed} of ${plural(total, 'test')} failed`
    : event.coverage?.failures?.length ? 'coverage is below its threshold' : `${plural(total, 'test')} passed`;
  let lines = [`# Dyno: ${title}`, '', `${event.failed || event.skipped ? tally(event) : 'Ran'} in ${timingDuration(event.duration)}${browser ? ` on ${browser}` : ''}.`];
  if (ready?.seed !== null && ready?.seed !== undefined) lines.push(`Seed: ${ready.seed}`);
  for (let [index, test] of run.failures.entries()) lines.push(...failureBlock(test, index + 1, context));
  if (run.skipped.length) lines.push('', `## Skipped (${run.skipped.length})`, '', ...run.skipped.map(test => `- ${test}`));
  if (event.coverage) {
    lines.push('', `## Coverage (${coverageScope(event.coverage)})`, '');
    let summary = coverageText(event.coverage.summary);
    if (summary) lines.push(summary);
    lines.push(...(event.coverage.failures ?? []).map(failure => `- Failed: ${failure}`));
  }
  if (event.report?.json) lines.push('', `Full results with console output and timings: ${displayPath(event.report.json, context.cwd)}`);
  return lines;
}

function repeatBlock(event, failures, context) {
  let lines = ['', `# Dyno repeated runs: ${event.status}`, '',
    `${event.completed} of ${event.requested} rounds completed, ${plural(event.failedRounds, 'round')} with failures.`];
  if (event.seed !== null && event.seed !== undefined) lines.push(`Root seed: ${event.seed}`);
  lines.push('', '## Tests', '', ...event.tests.map(test => `- ${testTitle(test)}: ${tally(test)}`));
  if (event.firstFailure) {
    lines.push('', `## First failure (round ${event.firstFailure.round})`);
    lines.push(...(failures?.length ? failures.flatMap((test, index) => failureBlock(test, index + 1, context))
      : ['', `Error: ${event.firstFailure.error?.message ?? 'Run interrupted'}`]), '');
    if (event.firstFailureReplay) lines.push(`- Replay this round: \`${event.firstFailureReplay}\``);
    lines.push(`- Rerun through the failure: \`${event.prefixCommand}\``);
  }
  if (event.reason) lines.push('', `Stopped early: ${event.reason}`);
  return [...lines, '', `Report: ${displayPath(event.html, context.cwd)}`];
}

export function llmStep(state, event, context) {
  switch (event.type) {
    case 'ready': {
      let open = [
        ...(event.browser ? [] : [`Open ${event.url} in a browser to start the tests.`]),
        ...(event.devices ?? []).map(url => `Open on another device: ${url}`),
      ];
      return { state: { ...state, ready: event }, writes: out(open) };
    }
    case 'capture':
      return { state, writes: context.persistent ? out([`Reporter: ${event.reporterURL}`]) : [] };
    case 'start':
      return { state: withRun(state, event.runId, emptyRun, () => emptyRun), writes: [] };
    case 'test':
      return {
        state: withRun(state, event.runId, emptyRun, run => ({
          count: run.count + 1,
          failures: event.status === 'failed' ? [...run.failures, event] : run.failures,
          skipped: event.status === 'skipped' ? [...run.skipped, `${testTitle(event)}${event.file ? ` (${event.file})` : ''}`] : run.skipped,
        })),
        writes: [],
      };
    // Run coverage arrives on its complete event. Repeated runs report it once at the end.
    case 'coverage':
      return {
        state,
        writes: event.batchId ? out(['', `Coverage (${coverageScope(event)}): ${coverageText(event.summary) || event.status}`,
          ...(event.failures ?? []).map(failure => `- Failed: ${failure}`)]) : [],
      };
    case 'complete': {
      let run = state.runs[event.runId] ?? emptyRun;
      let next = withoutRun(state, event.runId);
      if (!state.repeat) return { state: next, writes: out(runBlock(event, run, state.ready, context)) };
      return { state: { ...next, firstFailures: next.firstFailures ?? (run.failures.length ? run.failures : null) }, writes: [] };
    }
    case 'fatal': {
      let run = state.runs[event.runId] ?? emptyRun;
      return {
        state: withoutRun(state, event.runId),
        writes: out(['', '# Dyno: browser run failed', '', `Error: ${event.error?.message ?? 'Unknown error'}`,
          `${plural(run.count, 'test')} finished before the failure.`,
          ...run.failures.flatMap((test, index) => failureBlock(test, index + 1, context)),
          ...(event.report?.json ? ['', `Report: ${displayPath(event.report.json, context.cwd)}`] : [])]),
      };
    }
    case 'repeat-start':
      return { state: { ...state, repeat: event }, writes: [] };
    case 'repeat-complete':
      return { state, writes: out(repeatBlock(event, state.firstFailures, context)) };
    case 'watch':
      return { state, writes: err([`Watch: ${event.message ?? event.status}`]) };
    case 'browser-stopped':
      return { state, writes: event.graceful ? [] : err(['The browser needed forced cleanup. See session.json for timings.']) };
    default:
      return { state, writes: [] };
  }
}
