import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createGateway } from '../../src/server.js';
import { createReportWriter } from '../../src/reports.js';
import { project } from '../helpers/project.js';
import { join } from 'node:path';

test('shutdown refuses a pending browser join while saving the interrupted run', { timeout: 15000 }, async (t) => {
  let fixture = await project(t);
  let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
  let bundle = await buildSuite(config);
  let writer = createReportWriter(config.reportDir);
  let rebuilding = Promise.withResolvers(),
    releaseBuild = Promise.withResolvers();
  let saving = Promise.withResolvers(),
    releaseSave = Promise.withResolvers();
  let captures = 0;
  // The caller's real bundle/output callbacks are held at their public boundaries.
  let gateway = await createGateway(config, bundle, {
    rebuild: async () => {
      if (captures++) {
        rebuilding.resolve();
        await releaseBuild.promise;
      }
      return buildSuite(config);
    },
    onRun: async (run) => {
      saving.resolve();
      await releaseSave.promise;
      return writer.save(run);
    }
  });
  t.after(async () => {
    releaseBuild.resolve();
    releaseSave.resolve();
    await gateway.close();
  });
  let first = await (await fetch(gateway.url + 'capture', { method: 'POST' })).json();
  let joining = fetch(gateway.url + 'capture', { method: 'POST' });
  await rebuilding.promise;
  let closing = gateway.close();
  await saving.promise;
  releaseBuild.resolve();
  let response = await joining;
  assert.equal(response.status, 503);
  assert.match(await response.text(), /shutting down/);
  releaseSave.resolve();
  await closing;
  assert.deepEqual(await readdir(config.reportDir), [first.runId]);
  let report = JSON.parse(await readFile(join(config.reportDir, first.runId, 'run.json'), 'utf8'));
  assert.equal(report.status, 'interrupted');
});
