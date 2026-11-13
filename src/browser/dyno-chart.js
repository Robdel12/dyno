// The dyno sheet: a pull plotted as tests completed over summed test time.
// Steep stretches are fast tests; flat stretches are slow ones. Pure functions only,
// so the live reporter and saved reports draw the same sheet.

import { escapeMarkup as escape } from './markup.js';
import { timingDuration } from './timing-format.js';

let finished = ['passed', 'failed', 'skipped', 'stopped'];
let width = 1000;
let height = 300;
let top = 14;


export function pullCurve(tests) {
  let done = tests.filter((test) => finished.includes(test.status));
  let x = 0;
  let points = done.map((test, index) => {
    x += Math.max(test.duration ?? 0, 0);
    return Object.freeze({ id: test.id, index: test.index, name: test.name, status: test.status, x, y: index + 1 });
  });
  let running = tests.find((test) => test.status === 'running');
  return Object.freeze({
    total: tests.length,
    time: points.at(-1)?.x ?? 0,
    done: points.length,
    points: Object.freeze(points),
    running: running ? Object.freeze({ id: running.id, name: running.name }) : undefined
  });
}

export function pace(curve) {
  return curve.done ? curve.time / curve.done : undefined;
}

// Ghost curves keep only geometry, so a stored pull never carries test names.
export function ghostCurve(curve, runId) {
  return Object.freeze({ runId, total: curve.total, time: curve.time, points: curve.points.map(({ x, y }) => [x, y]) });
}

export let usable = (curve, ghost) => (ghost && ghost.total === curve.total && ghost.points?.length ? ghost : undefined);
let scale = (curve, ghost) => {
  let span = Math.max(curve.time, ghost?.time ?? 0, 1);
  let total = Math.max(curve.total, 1);
  return {
    x: (value) => +((value / span) * width).toFixed(2),
    y: (value) => +(height - (value / total) * (height - top)).toFixed(2)
  };
};

let trace = (pairs, s) => `M0 ${height}` + pairs.map(([x, y]) => ` L${s.x(x)} ${s.y(y)}`).join('');

/**
 * Returns sheet SVG markup. `href(point)` links points to tests; omit it for a static sheet.
 */
export function pullSheet(curve, { ghost, href } = {}) {
  let usableGhost = usable(curve, ghost);
  let s = scale(curve, usableGhost);
  let grid = [
    ...Array.from({ length: 9 }, (_, index) => `<path class="sheet-grid" d="M${(index + 1) * 100} 0V${height}"/>`),
    ...[0.25, 0.5, 0.75].map((share) => `<path class="sheet-grid" d="M0 ${s.y(curve.total * share)}H${width}"/>`)
  ].join('');
  let ceiling = `<path class="sheet-ceiling" d="M0 ${s.y(curve.total)}H${width}"/>`;
  let ghostTrace = usableGhost ? `<path class="sheet-ghost" d="${trace(usableGhost.points, s)}"/>` : '';
  let pairs = curve.points.map((point) => [point.x, point.y]);
  let area = pairs.length ? `<path class="sheet-area" d="${trace(pairs, s)} L${s.x(pairs.at(-1)[0])} ${height}Z"/>` : '';
  let current = pairs.length ? `<path class="sheet-trace" d="${trace(pairs, s)}"/>` : '';
  let points = curve.points
    .map((point) => {
      let dot = `<path class="sheet-point" data-status="${escape(point.status)}" d="M${s.x(point.x)} ${s.y(point.y)}h0"><title>${escape(point.name)}</title></path>`;
      return href ? `<a href="${escape(href(point))}" tabindex="-1">${dot}</a>` : dot;
    })
    .join('');
  let last = curve.points.at(-1);
  let head = curve.running
    ? `<path class="sheet-head" d="M${s.x(last?.x ?? 0)} ${s.y(last?.y ?? 0)}h0"><title>${escape(curve.running.name)}</title></path>`
    : '';
  return `<svg class="sheet-plot" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grid}${area}${ceiling}${ghostTrace}${current}${points}${head}</svg>`;
}

/**
 * Where the newest point sits, as percentages of the plot, for labels drawn in HTML.
 */
export function sheetHead(curve, ghost) {
  let s = scale(curve, usable(curve, ghost));
  let last = curve.points.at(-1);
  let left = (s.x(last?.x ?? 0) / width) * 100;
  // Notes near the right edge print to the left of the point so they never clip.
  return Object.freeze({ left, top: (s.y(last?.y ?? 0) / height) * 100, side: left > 62 ? 'left' : 'right' });
}

export let testCount = (count) => `${count} ${count === 1 ? 'test' : 'tests'}`;

// The finished note, printed like a dyno sheet's peak: "13 tests @ 1.90 s".
export let sheetNote = (curve) => `${testCount(curve.total)} @ ${timingDuration(curve.time)}`;

// The x-axis label. The axis spans the longer of this pull and its ghost.
export let sheetSpan = (curve, ghost) =>
  curve.time ? `${timingDuration(Math.max(curve.time, usable(curve, ghost)?.time ?? 0))} of test time` : 'test time';

/**
 * A small tachometer for the run title. The needle sweeps from 0 to all tests finished.
 */
export function tachometer({ id = '', phase = 'connecting', failed = false, progress = 0 } = {}) {
  let ticks = Array.from({ length: 7 }, (_, index) => {
    let angle = Math.PI * (1 - index / 6);
    let point = (radius) => `${(30 + Math.cos(angle) * radius).toFixed(1)} ${(31 - Math.sin(angle) * radius).toFixed(1)}`;
    return `M${point(index % 3 ? 25 : 24)}L${point(28)}`;
  }).join('');
  return `<svg${id ? ` id="${escape(id)}"` : ''} class="tach" viewBox="0 0 60 34" data-phase="${escape(phase)}" data-failed="${failed}" style="--progress:${Math.min(Math.max(progress, 0), 1).toFixed(3)}" aria-hidden="true" focusable="false"><path class="tach-ticks" d="${ticks}"/><path class="tach-track" d="M11 31A19 19 0 0 1 49 31" pathLength="1"/><path class="tach-sweep" d="M11 31A19 19 0 0 1 49 31" pathLength="1"/><path class="tach-needle" d="M30 31L30 15"/><circle class="tach-hub" cx="30" cy="31" r="3"/></svg>`;
}

export function sheetSummary(curve) {
  if (!curve.total) return 'No tests yet.';
  return `${curve.done} of ${curve.total} tests finished in ${timingDuration(curve.time)} of test time.`;
}
