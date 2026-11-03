/**
 * Each browser run saves `.dyno/reports/<run-id>/` with `run.json`, `junit.xml`, `index.html`, `schedule.json`, and `session.json`. Set `reportDir` or pass `--report-dir path` to choose another folder. The CLI prints the HTML path; JSON output includes a `report-saved` event.
 *
 * Open `index.html` directly in a browser after Dyno stops. It includes searchable files/suites, failures, source excerpts, console output, timings, and screenshots copied into `images/`. Copy the whole run folder to share it. A source image removed before saving appears as Screenshot unavailable.
 *
 * Run JSON uses `schemaVersion: 1`. It contains stable test descriptors, outcomes, summary counts, and relative image paths. A run is `completed` or `interrupted`; a test without an accepted result is `not-run`. Primary and additional failures retain their phase and source context. JUnit includes an error case for interruption, so an unfinished run cannot look green to CI.
 *
 * Completed runs save before completion is reported. SIGINT, SIGTERM, browser loss, and app failures save accepted results before shutdown. A force kill or machine failure cannot flush results. Storage failures fail the CLI; partially written run folders never become published reports. Old reports stay until you remove them.
 *
 * Reports include your test output and source excerpts. Dyno does not save its config, fixtures, connection keys, or launch tokens in them.
 *
 * @guide reports Saved reports
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
