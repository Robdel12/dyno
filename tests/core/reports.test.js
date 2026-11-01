import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, acceptEvent, claimTest } from '../../src/run.js';
import {createReport,missingImages} from '../../src/report-model.js';
import {junitReport,htmlReport} from '../../src/report-format.js';
import { testId } from '../../src/suite.js';

test('portable report snapshots whitelist results, preserve stable IDs, and never mutate run data', () => {
  let descriptor = {
    id: testId('a.js', ['Contacts'], 'save'),
    file: 'a.js',
    suites: ['Contacts'],
    name: 'save',
    index: 0
  };
  let run = createRun('report-run');
  run = acceptEvent(run, { runId: run.runId, type: 'start', tests: [descriptor], userAgent: 'Test browser' }).run;
  run = claimTest(run, { executionId: 'save' }).run;
  run = acceptEvent(run, {
    runId: run.runId,
    executionId: 'save',
    type: 'test',
    testId: descriptor.id,
    name: 'save',
    index: 0,
    status: 'passed',
    output: [{ source: 'test', level: 'log', text: 'Saved', elapsed: 0, privateValue: 'omit' }],
    attachments: [
      {
        id: 'image',
        name: 'App',
        status: 'captured',
        path: '/private/source/image.png',
        url: '/__dyno__/artifacts/image',
        width: 100,
        height: 200,
        pixelRatio: 1,
        viewport: { width: 100, height: 200 },
        browser: { name: 'chrome', provider: 'playwright' }
      }
    ]
  }).run;
  let report = createReport({ ...run, connectionKey: 'never save', fixtures: { secret: 'never save' } });
  assert.equal(report.tests[0].id, descriptor.id);
  assert.equal(report.tests[0].attachments[0].path, 'images/image.png');
  assert.equal(report.status, 'interrupted');
  assert.equal(report.userAgent, 'Test browser');
  assert.doesNotMatch(JSON.stringify(report), /privateValue|never save|private\/source/);
  let missing = missingImages(report, ['image']);
  assert.equal(missing.tests[0].attachments[0].status, 'missing');
  assert.equal(report.tests[0].attachments[0].status, 'captured');
  assert.equal(run.outcomes[0].attachments[0].path, '/private/source/image.png');
});

test('JUnit makes an interrupted empty run fail and escapes control characters and markup', () => {
  let report = createReport({
    ...createRun('interrupted'),
    error: { message: 'Bad <script> & "value"\u0000', phase: 'runtime' }
  });
  let xml = junitReport(report);
  assert.match(xml, /tests="1" failures="0" errors="1"/);
  assert.match(xml, /Bad &lt;script&gt; &amp; &quot;value&quot;�/);
  assert.doesNotMatch(xml, /\u0000/);
  let html = htmlReport(report, '');
  assert.match(html, /Run interrupted/);
  assert.doesNotMatch(html, /<script> &/);
});
