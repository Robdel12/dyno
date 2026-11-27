// Balancing a run across workers with the session's own timings. Pure functions:
// test IDs and last measured durations in, a worker count or an order out.

// The last measured duration of each test, from earlier runs' outcomes.
export function measuredDurations(runs) {
  let known = {};
  for (let run of runs)
    for (let outcome of run.outcomes ?? [])
      if (outcome.status !== 'skipped' && Number.isFinite(outcome.duration) && outcome.duration > 0)
        known[outcome.testId] = outcome.duration;
  return known;
}

// How many workers a run needs. Never more than it has tests, and with
// timings, never more than its total work divided by its longest test:
// extra workers can't finish sooner than that test.
export function fittedWorkers(ids, durations, launched) {
  if (!ids.length) return launched;
  let count = Math.min(launched, ids.length);
  let measured = ids.map((id) => durations[id]).filter((value) => value > 0);
  if (measured.length < ids.length) return count;
  let longest = Math.max(...measured);
  let total = measured.reduce((sum, value) => sum + value, 0);
  return Math.max(1, Math.min(count, Math.ceil(total / longest)));
}

// Longest work first, so workers finish close together. Tests without a
// timing are treated as average; ties keep their registered order.
export function balancedOrder(ids, durations) {
  let measured = ids.map((id) => durations[id]).filter((value) => value > 0);
  if (!measured.length) return ids;
  let average = measured.reduce((sum, value) => sum + value, 0) / measured.length;
  let weight = (id) => durations[id] > 0 ? durations[id] : average;
  return ids.map((id, index) => ({ id, index, weight: weight(id) }))
    .sort((left, right) => right.weight - left.weight || left.index - right.index)
    .map((entry) => entry.id);
}
