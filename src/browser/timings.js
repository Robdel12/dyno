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

export function performanceSummary(tests, duration) {
  let testDuration = tests.reduce((sum, test) => sum + (test.duration ?? 0), 0);
  return freeze({
    testDuration,
    ...(finite(duration) ? { outsideTestsDuration: Math.max(0, duration - testDuration) } : {}),
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
