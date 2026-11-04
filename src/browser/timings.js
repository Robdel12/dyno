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
 * Timings are always recorded. Open **Slowest tests** in the reporter, then a test’s **Timings** tab. It separates fresh-document setup, hooks, the body, and queued errors. Individual hooks keep their function name and execution order. Navigation, requests, screenshots, viewport changes, native calls, and debug pauses have their own intervals.
 *
 * Custom Interactor actions and assertions are included in the enclosing test or hook duration. They don't get separate timing rows automatically. Wrap meaningful workflows in `step()` to give them named intervals:
 *
 * ```js
 * describe('Contacts', () => {
 *   test('saves a contact', async ({ app, I, step }) => {
 *     await app.goto('/contacts/new');
 *     let contact = await step('Save contact', async () => {
 *       await I.type('Robert').into('$(input[name=name])');
 *       await I.click('Save');
 *       await I.find('$([role=status])').text('Contact saved');
 *       return 'Robert';
 *     });
 *   });
 * });
 * ```
 *
 * `step(name, callback)` returns the callback’s value and preserves its error. Use it in hooks too. Await it before finishing a test or hook. Interactor still owns interaction and convergence; timings do not wrap its polling loop or change assertion behavior.
 *
 * For agents, `--json` test events and saved `run.json` tests include `timings: { duration, entries, truncated }`. Each entry has `id`, `kind`, `name`, `start`, `duration`, and `status` (`passed`, `failed`, or `cancelled`), with `phase` on operations and steps. All numbers are milliseconds from that test runtime’s monotonic clock. `performance.slowestTests` ranks up to five tests and their slowest work. Single-worker summaries include `outsideTestsDuration` when a run duration is available. It measures time outside accepted test runtimes, including frame startup, reporting, and between-test inspection. Concurrent summaries use `coordination` instead.
 *
 * Each saved run also has `session.json`. It measures CLI config, bundling, project setup, app-server readiness, browser startup/results, and cleanup on a separate clock. Cleanup includes separate intervals for stopping the app, saving reports, project teardown, and stopping the browser. Its status is `running` until the CLI closes its resources; shutdown atomically finalizes it and emits a `session-timing` JSON event. Watch and manual runs share one session across their browser runs. The final report write itself is outside the measured wall time. These fields are separate from the browser-run duration. Managed runs also record `browserCleanup.graceful` and emit a `browser-stopped` event, so forced process cleanup is visible.
 *
 * ```sh
 * jq '.performance.slowestTests' .dyno/reports/<run-id>/run.json
 * jq '.timings.entries | sort_by(-.duration)' .dyno/reports/<run-id>/session.json
 * ```
 *
 * Intervals include waiting. A step can contain a request or another step, and parallel work overlaps. Do not add inclusive rows together. Debugging time is included and marked as a pause. Request timing ends when response headers arrive; reading the body belongs to the surrounding step. This measures test execution, not application CPU time.
 *
 * `coordination` in JSON and Run info separates coordinator wall time from summed browser test work. Its clock starts with the first registered catalog and ends after terminal draining, before report persistence. Session timing includes startup, report writing and shutdown. Concurrent work is never subtracted from wall time to invent an overhead number.
 *
 * Worker timings show assigned execution, handoff after result acceptance, queue time for requests that received assignments, and remaining unassigned time. Handoff includes document retirement, project cleanup and final completion waiting. `projectCleanupDuration` measures the callback within that handoff; do not add it again. Unassigned time includes waiting after a worker's last assignment.
 *
 * Each test retains up to 500 entries; `truncated` counts omitted intervals. An interrupted runtime that cannot report has no timings, rather than invented zeros. Dyno records request methods and paths, without query strings, bodies, or headers. Step and screenshot names appear in reports, so keep secrets out of those labels.
 *
 * @guide timings Find slow work
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
