import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createReport, missingImages } from './report-model.js';
import { junitReport, htmlReport } from './report-format.js';

export function createReportWriter(directory, { redact = (value) => value } = {}) {
  let writes = new WeakMap();
  let save = async (run) => {
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
        writeFile(join(staging, 'run.json'), redact(JSON.stringify(report, null, 2) + '\n')),
        writeFile(join(staging, 'junit.xml'), redact(junitReport(report))),
        writeFile(join(staging, 'index.html'), redact(htmlReport(report, css)))
      ]);
      await rename(staging, target);
      return Object.freeze({
        runId: run.runId,
        directory: target,
        json: join(target, 'run.json'),
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
    save(run) {
      if (!writes.has(run))
        writes.set(
          run,
          save(run).catch((error) => {
            writes.delete(run);
            throw error;
          })
        );
      return writes.get(run);
    }
  });
}
