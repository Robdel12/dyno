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
 * Dyno saves results before reporting completion, including accepted outcomes on signals, browser loss, and app failure. A force kill or machine failure can't flush results. Storage errors fail the CLI, and partially written run folders aren't published as reports. A source image removed before saving appears as **Screenshot unavailable**.
 *
 * Reports contain test output and source excerpts. Dyno doesn't save config, fixtures, connection keys, or launch tokens in them.
 *
 * ## Repeated-run reports
 *
 * `--repeat` writes `.dyno/reports/repeat-<session-id>/`. Open its `index.html` for aggregate counts and the first failure. `batch.json` records the root seed, test-bundle fingerprint, browser identity, original selection, and observed outcomes. Skipped and unfinished tests stay separate from passes. The batch's `junit.xml` gives each test execution its round number, so a later pass cannot replace an earlier failure.
 *
 * `rounds.jsonl` records completed and interrupted rounds, per-test outcomes, and paths to their worker schedules under `schedules/`. Full portable reports and images are retained under `runs/` for failed or interrupted rounds and the final round. Successful intermediate rounds keep compact evidence; their screenshots are discarded. Session timing lives once in the batch folder.
 *
 * Round evidence and retained reports share a 256 MiB budget. Reaching it stops repetition, marks unavailable evidence explicitly, and preserves accepted counts in `batch.json`. The aggregate summary, final compact outcome record, and session timing are saved outside that budget so a limit cannot hide a failure or stop reason. Batch metadata updates after each saved round; HTML and JUnit are finalized on shutdown. Storage failures also fail the command. Copy the whole batch folder to keep its relative report and image links; printed commands refer to the original local paths.
 */

import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createReport, missingImages } from './report-model.js';
import { junitReport, htmlReport } from './report-format.js';

export function createReportWriter(directory, { redact = (value) => value } = {}) {
  let writes = new WeakMap();
  let saved = new Set();
  let save = async (run, session, { maxBytes = Infinity } = {}) => {
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
      let imageBytes = 0;
      for (let image of images) {
        try { imageBytes += (await stat(image.path)).size; }
        catch (error) { if (error.code === 'ENOENT') missing.push(image.id); else throw error; }
      }
      if (missing.length) report = missingImages(report, missing);
      let styles = await Promise.all(
        ['reporter.css', 'saved-report.css'].map(file => readFile(new URL(`./browser/${file}`, import.meta.url), 'utf8'))
      );
      let font = (await readFile(new URL('./browser/fonts/archivo.woff2', import.meta.url))).toString('base64');
      let css = styles.join('\n').replaceAll("url('/__dyno__/archivo.woff2')", `url('data:font/woff2;base64,${font}')`);
      let reportFiles = () => [
        ['schedule.json', JSON.stringify(report.schedule, null, 2) + '\n'],
        ['run.json', JSON.stringify(report, null, 2) + '\n'],
        ['junit.xml', junitReport(report)],
        ['index.html', htmlReport(report, css, { session: Boolean(session) })],
        ...(session ? [['session.json', JSON.stringify(session, null, 2) + '\n']] : [])
      ].map(([name, contents]) => [name, redact(contents)]);
      let files = reportFiles();
      let bytes = imageBytes + files.reduce((total, [, contents]) => total + Buffer.byteLength(contents), 0);
      if (bytes > maxBytes) throw Object.assign(new Error('Repeated-run evidence reached its storage limit.'), { code: 'DYNO_EVIDENCE_LIMIT' });
      let copiedBytes = 0;
      for (let image of images) {
        if (missing.includes(image.id)) continue;
        try {
          await copyFile(image.path, join(staging, 'images', `${image.id}.png`));
          copiedBytes += (await stat(join(staging, 'images', `${image.id}.png`))).size;
        } catch (error) {
          if (error.code === 'ENOENT') missing = [...missing, image.id];
          else throw error;
        }
      }
      if (missing.length) {
        report = missingImages(report, missing);
        files = reportFiles();
      }
      bytes = copiedBytes + files.reduce((total, [, contents]) => total + Buffer.byteLength(contents), 0);
      if (bytes > maxBytes) throw Object.assign(new Error('Repeated-run evidence reached its storage limit.'), { code: 'DYNO_EVIDENCE_LIMIT' });
      await Promise.all(files.map(([name, contents]) => writeFile(join(staging, name), contents)));
      await rename(staging, target);
      if (session) saved.add(target);
      return Object.freeze({
        ...(session ? { session: join(target, 'session.json') } : {}),
        runId: run.runId,
        bytes,
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
      throw Object.assign(new Error(`Could not save Dyno report: ${error.message}`, { cause: error }),
        error.code === 'DYNO_EVIDENCE_LIMIT' ? { code: error.code } : {});
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
    save(run, session, options) {
      if (!writes.has(run))
        writes.set(
          run,
          save(run, session, options).catch((error) => {
            writes.delete(run);
            throw error;
          })
        );
      return writes.get(run);
    }
  });
}
