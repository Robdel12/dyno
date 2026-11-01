import { testDescriptor } from './suite.js';
import { snapshotTimings, performanceSummary } from './browser/timings.js';

let freeze = (value) => Object.freeze(value);
let errorSnapshot = (error) =>
  error &&
  freeze({
    phase: error.phase ?? 'runtime',
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.source
      ? {
          source: freeze({
            file: error.source.file,
            line: error.source.line,
            column: error.source.column,
            startLine: error.source.startLine,
            code: error.source.code
          })
        }
      : {})
  });
export function createReport(run) {
  let tests = run.tests.map((test) => {
    let outcome = run.outcomes.find((outcome) => outcome.testId === test.id);
    let output = outcome?.output ?? run.partial?.find((item) => item.id === test.id)?.output ?? [];
    return freeze({
      ...testDescriptor(test),
      suites: freeze([...test.suites]),
      status: outcome?.status ?? 'not-run',
      duration: outcome?.duration ?? 0,
      ...(outcome?.timings ? { timings: snapshotTimings(outcome.timings) } : {}),
      ...(outcome?.skipReason ? { skipReason: outcome.skipReason } : {}),
      ...(outcome?.error ? { error: errorSnapshot(outcome.error) } : {}),
      additionalErrors: freeze((outcome?.additionalErrors ?? []).map(errorSnapshot)),
      output: freeze(
        output.map((entry) =>
          freeze({ source: entry.source, level: entry.level, text: entry.text, elapsed: entry.elapsed })
        )
      ),
      attachments: freeze(
        (outcome?.attachments ?? []).map((attachment) =>
          freeze(
            attachment.status === 'captured'
              ? {
                  id: attachment.id,
                  name: attachment.name,
                  status: 'captured',
                  path: `images/${attachment.id}.png`,
                  url: `images/${attachment.id}.png`,
                  width: attachment.width,
                  height: attachment.height,
                  pixelRatio: attachment.pixelRatio,
                  viewport: freeze({ ...attachment.viewport }),
                  browser: freeze({ ...attachment.browser })
                }
              : { id: attachment.id, name: attachment.name, status: 'skipped', reason: attachment.reason }
          )
        )
      )
    });
  });
  return freeze({
    schedule: freeze({ version: 1, algorithm: 'sha256-id-rank-v1', seed: run.seed ?? null,
      selected: freeze(run.tests.map(test => test.id)), priority: freeze([...(run.priority ?? [])]),
      workers: freeze((run.workers ?? []).map(worker => worker.id)),
      assignments: freeze((run.assignments ?? []).map(assignment => freeze({
        executionId: assignment.id, workerId: assignment.workerId, testId: assignment.testId,
        status: assignment.status,
      }))),
      completion: freeze(run.outcomes.map(outcome => outcome.testId)),
    }),
    schemaVersion: 1,
    runId: run.runId,
    status: run.status === 'completed' ? 'completed' : 'interrupted',
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.userAgent ? { userAgent: run.userAgent } : {}),
    summary: freeze({
      passed: tests.filter((test) => test.status === 'passed').length,
      failed: tests.filter((test) => test.status === 'failed').length,
      skipped: tests.filter((test) => test.status === 'skipped').length,
      notRun: tests.filter((test) => test.status === 'not-run').length,
      duration: run.summary?.duration ?? tests.reduce((sum, test) => sum + test.duration, 0)
    }),
    ...(run.error ? { error: errorSnapshot(run.error) } : {}),
    performance: performanceSummary(tests, run.summary?.duration),
    tests: freeze(tests)
  });
}
export function missingImages(report, ids) {
  return freeze({
    ...report,
    tests: freeze(
      report.tests.map((test) =>
        freeze({
          ...test,
          attachments: freeze(
            test.attachments.map((image) =>
              ids.includes(image.id)
                ? freeze({
                    id: image.id,
                    name: image.name,
                    status: 'missing',
                    reason: 'The screenshot file is no longer available.'
                  })
                : image
            )
          )
        })
      )
    )
  });
}
