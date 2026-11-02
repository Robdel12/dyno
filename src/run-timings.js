import { performanceSummary } from './browser/timings.js';

let freeze = value => Object.freeze(value);

export function recordProjectCleanup(run, executionId, span) {
  if (!span) return run;
  let assignment = run.assignments.find(assignment => assignment.id === executionId);
  if (!assignment || !Number.isFinite(span.startedAt) || !Number.isFinite(span.finishedAt) ||
    span.startedAt < assignment.assignedAt || span.finishedAt < span.startedAt || !['passed', 'failed'].includes(span.status))
    throw new Error('Invalid project cleanup timing.');
  return freeze({ ...run, assignments: freeze(run.assignments.map(item => item === assignment
    ? freeze({ ...item, projectCleanup: freeze({ ...span }) }) : item)) });
}

// These intervals share the coordinator's clock. Browser operation timings keep
// their own clock; summed browser work is not subtracted from concurrent wall.
export function finishRunTimings(run, endedAt) {
  let startedAt = run.startedClock ?? endedAt;
  if (!Number.isFinite(endedAt) || endedAt < startedAt || startedAt < 0) throw new Error('Invalid coordinator completion time.');
  let wallDuration = Math.max(0, endedAt - startedAt);
  let interval = (from, to) => Math.max(0, Math.min(endedAt, to ?? endedAt) - Math.max(startedAt, from ?? endedAt));
  let workers = run.workers.map(worker => {
    let executions = run.assignments.filter(assignment => assignment.workerId === worker.id && !run.tests[assignment.index].skipReason);
    let executionDuration = 0, handoffDuration = 0, queueDuration = 0, projectCleanupDuration = 0;
    for (let assignment of executions) {
      let reportedAt = assignment.reportedAt ?? assignment.projectCleanup?.startedAt;
      executionDuration += interval(assignment.assignedAt, reportedAt);
      if (reportedAt !== undefined) handoffDuration += interval(reportedAt, assignment.releasedAt);
      queueDuration += interval(assignment.requestedAt, assignment.assignedAt);
      if (assignment.projectCleanup) projectCleanupDuration += interval(assignment.projectCleanup.startedAt, assignment.projectCleanup.finishedAt);
    }
    return freeze({ id: worker.id, executionDuration, handoffDuration, queueDuration, projectCleanupDuration,
      unassignedDuration: Math.max(0, wallDuration - executionDuration - handoffDuration - queueDuration) });
  });
  let coordination = freeze({ wallDuration, testWorkDuration: run.outcomes.reduce((sum, test) => sum + (test.status === 'skipped' ? 0 : test.duration ?? 0), 0), workers: freeze(workers) });
  let summary = run.summary && freeze({ ...run.summary, duration: wallDuration, coordination,
    performance: performanceSummary(run.outcomes, wallDuration, { workers: run.workers.length }) });
  return freeze({ ...run, endedClock: endedAt, coordination, ...(summary ? { summary } : {}) });
}
