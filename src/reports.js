/**
 * @guide reports Saved reports
 * The CLI prints an HTML report path after each browser run. Open `index.html` directly after Dyno stops to search tests, read failures and source excerpts, inspect console output and timings, and view screenshots.
 *
 * Reports live in `.dyno/reports/<run-id>/`. Change that with `reportDir` or `--report-dir path`. Copy the whole folder to share a report; its images live in `images/`. Old reports stay until you remove them.
 *
 * ## Use reports in CI
 *
 * Each folder includes `run.json`, `junit.xml`, `schedule.json`, and `session.json`. JSON output emits a `report-saved` event. `run.json` uses `schemaVersion: 1`, stable test descriptors, outcomes, summary counts, and relative image paths.
 *
 * Runs are `completed` or `interrupted`; tests without accepted results are `not-run`. Failures retain their phase and source context. JUnit adds an error case for interruption, so an unfinished run can't look green.
 *
 * Dyno saves results before reporting completion, including accepted outcomes on signals, browser loss, and app failure. A force kill or machine failure can't flush results. Storage errors fail the CLI, and partially written folders aren't published as reports. A source image removed before saving appears as **Screenshot unavailable**.
 *
 * Reports contain test output and source excerpts. Dyno doesn't save config, fixtures, connection keys, or launch tokens in them.
 */

import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createReport, missingImages } from './report-model.js';
import { junitReport, htmlReport } from './report-format.js';

export function createReportWriter(directory, { redact = (value) => value } = {}) {
  let writes = new WeakMap();
  let saved = new Set();
  let save = async (run, session) => {
    let report = createReport(run);
    let staging;
    let target = join(directory, run.runId);
    try {
      await mkdir(directory, { recursive: true });
      staging = await mkdtemp(join(directory, `.${run.runId}-`));
      let images = run.outcomes
        .flatMap((test) => test.attachments ?? [])
        .filter((image) => image.status === 'captured');
      if (images.length) await mkdir(join(staging, 'images'));
      let missing = [];
      for (let image of images) {
        try {
          await copyFile(image.path, join(staging, 'images', `${image.id}.png`));
        } catch (error) {
          if (error.code === 'ENOENT') missing = [...missing, image.id];
          else throw error;
        }
      }
      if (missing.length) report = missingImages(report, missing);
      let styles = await Promise.all(
        ['reporter.css', 'saved-report.css'].map((file) =>
          readFile(new URL(`./browser/${file}`, import.meta.url), 'utf8')
        )
      );
      let css = styles.join('\n');
      await Promise.all([
        writeFile(join(staging, 'schedule.json'), redact(JSON.stringify(report.schedule, null, 2) + '\n')),
        writeFile(join(staging, 'run.json'), redact(JSON.stringify(report, null, 2) + '\n')),
        writeFile(join(staging, 'junit.xml'), redact(junitReport(report))),
        writeFile(join(staging, 'index.html'), redact(htmlReport(report, css, { session: Boolean(session) }))),
        ...(session ? [writeFile(join(staging, 'session.json'), redact(JSON.stringify(session, null, 2) + '\n'))] : [])
      ]);
      await rename(staging, target);
      if (session) saved.add(target);
      return Object.freeze({
        ...(session ? { session: join(target, 'session.json') } : {}),
        runId: run.runId,
        directory: target,
        json: join(target, 'run.json'),
        schedule: join(target, 'schedule.json'),
        junit: join(target, 'junit.xml'),
        html: join(target, 'index.html')
      });
    } catch (error) {
      let cleanup;
      if (staging)
        try {
          await rm(staging, { recursive: true, force: true });
        } catch (failure) {
          cleanup = failure;
        }
      if (cleanup)
        throw new AggregateError(
          [error, cleanup],
          `Could not save Dyno report: ${error.message}. Temporary report cleanup also failed: ${cleanup.message}`
        );
      throw new Error(`Could not save Dyno report: ${error.message}`, { cause: error });
    }
  };
  return Object.freeze({
    async finishSession(session) {
      for (let directory of saved) {
        let temporary = join(directory, `.session-${randomUUID()}.json`);
        try {
          await writeFile(temporary, redact(JSON.stringify(session, null, 2) + '\n'));
          await rename(temporary, join(directory, 'session.json'));
        } finally { await rm(temporary, { force: true }); }
      }
    },
    save(run, session) {
      if (!writes.has(run))
        writes.set(
          run,
          save(run, session).catch((error) => {
            writes.delete(run);
            throw error;
          })
        );
      return writes.get(run);
    }
  });
}
