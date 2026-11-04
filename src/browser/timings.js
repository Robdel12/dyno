/**
 * One inclusive interval in an execution. Numbers are milliseconds from the browser’s monotonic clock. Nested and parallel intervals overlap; do not add them together.
 *
 * @api TimingEntry
 */

/**
 * Execution duration and up to 500 recorded intervals. `truncated` counts omitted intervals. A runtime that could not report has no timings rather than invented zeros.
 *
 * @api Timings
 */

/**
 * @guide timings Understand where time goes
 * Open **Slowest tests** in the reporter, then a test's **Timings** tab. Dyno always records document startup, hooks, the test body, queued errors, and operations such as navigation, requests, screenshots, and native calls.
 *
 * Give meaningful workflows a name with `step()`:
 *
 * ```js
 * describe('Contacts', () => {
 *   test('saves a contact', async ({ app, I, step }) => {
 *     await app.goto('/contacts/new');
 *     await step('Save contact', async () => {
 *       await I.find('Name').then.fill('Robert');
 *       await I.click('Save');
 *       await I.find('$([role=status])').text('Contact saved');
 *     });
 *   });
 * });
 * ```
 *
 * Use steps in hooks too. Await them before finishing; they return the callback's value and preserve its error. Custom Interactor actions stay inside the enclosing test or hook unless you add a named step.
 *
 * ## Read the numbers
 *
 * Durations include waiting, not just CPU work. Nested steps include their children and parallel operations overlap, so don't add all rows together. Debug pauses are included and marked. Requests end when headers arrive; body reading belongs to the surrounding step.
 *
 * Check `session.json` when browser tests are fast but the command is slow. It separates config, bundling, project setup, server readiness, browser startup/results, and cleanup. Cleanup includes report saving and stopping the app and browser.
 *
 * ```sh
 * jq '.performance.slowestTests' .dyno/reports/<run-id>/run.json
 * jq '.timings.entries | sort_by(-.duration)' .dyno/reports/<run-id>/session.json
 * ```
 *
 * ## Use timings in tools and agents
 *
 * JSON test events and saved results include `timings: { duration, entries, truncated }`. `performance.slowestTests` ranks up to five tests and their slowest work. Use these to compare runs or identify the next workflow to investigate.
 *
 * <details>
 * <summary>Timing fields and clocks</summary>
 *
 * Each entry has `id`, `kind`, `name`, `start`, `duration`, and `status` (`passed`, `failed`, or `cancelled`). Operations and steps include `phase`. Test numbers are milliseconds from that runtime's monotonic clock. Hook rows retain function names and execution order.
 *
 * Single-worker summaries include `outsideTestsDuration` when run duration is available. It covers time outside accepted test runtimes, including frame startup, reporting, and between-test inspection. Concurrent summaries instead use `coordination`: coordinator wall time stays separate from summed browser work. Its clock starts at the first registered catalog and ends after terminal draining, before report persistence.
 *
 * Worker timings show assigned execution, handoff after result acceptance, queue time for assigned requests, and remaining unassigned time. Handoff includes document retirement, project cleanup, and final completion waiting. `projectCleanupDuration` is already part of handoff; don't add it again. Unassigned time includes waiting after the last assignment.
 *
 * Session timing uses its own clock and includes startup, report writing, and shutdown. It stays `running` until resources close, then is finalized atomically with a `session-timing` event. Watch and manual runs share one session across browser runs. The final report write itself is outside measured wall time. `browserCleanup.graceful` and the `browser-stopped` event show whether process cleanup was forced.
 *
 * </details>
 *
 * Each test keeps up to 500 entries; `truncated` counts omissions. A runtime that can't report has no timings, rather than invented zeros. Request labels omit queries, bodies, and headers. Keep secrets out of step and screenshot names: those appear in reports.
 */

let freeze = (value) => Object.freeze(value);
export let timingLimit = 500;
let kinds = [
  'reset',
  'beforeEach',
  'test',
  'afterEach',
  'drain',
  'navigation',
  'request',
  'screenshot',
  'viewport',
  'pause',
  'native',
  'step',
  'lifecycle',
];
let statuses = ['running', 'passed', 'failed', 'cancelled'];
let finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function validTimings(value) {
  return (
    value &&
    finite(value.duration) &&
    Number.isSafeInteger(value.truncated) &&
    value.truncated >= 0 &&
    Array.isArray(value.entries) &&
    value.entries.length <= timingLimit &&
    value.entries.every(
      (entry, index) =>
        entry &&
        entry.id === index + 1 &&
        kinds.includes(entry.kind) &&
        typeof entry.name === 'string' &&
        entry.name.length > 0 &&
        entry.name.length <= 200 &&
        statuses.includes(entry.status) &&
        finite(entry.start) &&
        finite(entry.duration) &&
        entry.start + entry.duration <= value.duration + 0.01 &&
        (entry.phase === undefined ||
          ['reset', 'beforeEach', 'test', 'afterEach', 'drain'].includes(entry.phase)),
    )
  );
}

export function snapshotTimings(value) {
  return freeze({
    duration: value.duration,
    truncated: value.truncated,
    entries: freeze(
      value.entries.map(({ id, kind, name, start, duration, status, phase }) =>
        freeze({ id, kind, name, start, duration, status, ...(phase ? { phase } : {}) }),
      ),
    ),
  });
}

// The clock and pending work live at this boundary. Consumers receive snapshots.
export function createTimings({ now = () => performance.now(), limit = timingLimit } = {}) {
  let origin = now();
  let entries = [];
  let active = new Map();
  let truncated = 0;
  let ended;
  let elapsed = () => (ended ?? now()) - origin;
  let begin = (kind, name, phase) => {
    if (ended !== undefined) return () => {};
    if (entries.length >= limit) {
      truncated++;
      return () => {};
    }
    let id = entries.length + 1;
    let start = elapsed();
    entries = [
      ...entries,
      freeze({ id, kind, name: String(name).slice(0, 200), start, ...(phase ? { phase } : {}) }),
    ];
    let finish = (status = 'passed') => {
      if (!active.delete(id)) return;
      entries = entries.map((entry) =>
        entry.id === id ? freeze({ ...entry, duration: elapsed() - start, status }) : entry,
      );
    };
    active.set(id, finish);
    return finish;
  };
  let snapshot = () => {
    let duration = elapsed();
    return snapshotTimings({
      duration,
      truncated,
      entries: entries.map((entry) =>
        entry.status ? entry : { ...entry, duration: duration - entry.start, status: 'running' },
      ),
    });
  };
  return freeze({
    begin,
    measure(kind, name, work, { signal, phase } = {}) {
      let finish = begin(kind, name, phase);
      return new Promise((resolve, reject) => {
        let settle = (status, value) => {
          signal?.removeEventListener('abort', aborted);
          finish(status);
          status === 'passed' ? resolve(value) : reject(value);
        };
        let aborted = () => settle('cancelled', signal.reason);
        if (signal?.aborted) {
          aborted();
          return;
        }
        signal?.addEventListener('abort', aborted, { once: true });
        Promise.resolve()
          .then(() => {
            signal?.throwIfAborted();
            return work();
          })
          .then(
            (value) => settle('passed', value),
            (error) => settle(signal?.aborted ? 'cancelled' : 'failed', error),
          );
      });
    },
    snapshot,
    end() {
      ended ??= now();
      for (let finish of active.values()) finish('cancelled');
      return snapshot();
    },
  });
}

export function slowestTests(tests, limit = 5) {
  return tests
    .filter((test) => ['passed', 'failed'].includes(test.status) && finite(test.duration))
    .toSorted((a, b) => b.duration - a.duration || a.index - b.index)
    .slice(0, limit);
}

export function slowestWork(timings, limit = 5) {
  return (timings?.entries ?? [])
    .filter((entry) => !['reset', 'test', 'drain', 'pause'].includes(entry.kind))
    .toSorted((a, b) => b.duration - a.duration || a.id - b.id)
    .slice(0, limit);
}

export function performanceSummary(tests, duration, { workers = 1 } = {}) {
  let testDuration = tests.reduce((sum, test) => sum + (test.status === 'skipped' ? 0 : test.duration ?? 0), 0);
  return freeze({
    testDuration,
    ...(finite(duration) && workers === 1 ? { outsideTestsDuration: Math.max(0, duration - testDuration) } : {}),
    slowestTests: freeze(
      slowestTests(tests).map((test) =>
        freeze({
          id: test.id ?? test.testId,
          file: test.file,
          suites: freeze([...(test.suites ?? [])]),
          name: test.name,
          duration: test.duration,
          slowestWork: freeze(slowestWork(test.timings, 3)),
        }),
      ),
    ),
  });
}
