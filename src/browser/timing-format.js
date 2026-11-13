import { slowestWork } from './timings.js';

export let timingDuration = (value) =>
  value < 1 ? '<1 ms' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
// Where a failure happened, written to follow the error message.
let failurePhases = {
  test: 'In the test body',
  beforeEach: 'In a setup hook (beforeEach)',
  afterEach: 'In a cleanup hook (afterEach)',
  app: 'In the application',
  timeout: 'The test timed out',
  cleanup: 'Cleanup timed out',
  runtime: 'In the test runtime',
};
export let failurePlace = (error) => {
  let place = error.phase ? failurePhases[error.phase] ?? error.phase : '';
  let location = error.source ? `${error.source.file}:${error.source.line}:${error.source.column}` : '';
  return [place, location].filter(Boolean).join(' at ');
};
export let phaseKinds = ['reset', 'beforeEach', 'test', 'afterEach', 'drain'];
export let timingLabels = {
  reset: 'Fresh document',
  beforeEach: 'Setup hook',
  test: 'Test body',
  afterEach: 'Cleanup hook',
  drain: 'Queued errors',
  navigation: 'Navigation',
  request: 'Request',
  screenshot: 'Screenshot',
  viewport: 'Viewport',
  pause: 'Debug pause',
  native: 'Native browser',
  step: 'Step',
  lifecycle: 'CLI',
};
export let timingPhases = (timings) =>
  phaseKinds.flatMap((kind) => {
    let entries = timings.entries.filter((entry) => entry.kind === kind);
    return entries.length
      ? [
          {
            kind,
            name: timingLabels[kind],
            duration: entries.reduce((sum, entry) => sum + entry.duration, 0),
          },
        ]
      : [];
  });
export let timingOperations = (timings) =>
  timings.entries
    .filter((entry) => !['reset', 'test', 'drain'].includes(entry.kind))
    .toSorted((a, b) => b.duration - a.duration || a.id - b.id);
export function timingText(timings) {
  if (!timings) return 'Timing details are unavailable for this test.';
  return [
    'Timings (inclusive; overlapping work is not additive)',
    ...timingPhases(timings).map((entry) => `${entry.name}: ${timingDuration(entry.duration)}`),
    ...timingOperations(timings).map(
      (entry) =>
        `${timingLabels[entry.kind]} · ${entry.name}: ${timingDuration(entry.duration)} · ${entry.status} · starts ${timingDuration(entry.start)}`,
    ),
    ...(timings.truncated ? [`${timings.truncated} additional timings were not recorded.`] : []),
  ].join('\n');
}
export function slowWorkLabel(timings) {
  let work = slowestWork(timings, 1)[0];
  return work ? `${timingLabels[work.kind]} · ${work.name} (${timingDuration(work.duration)})` : '';
}
