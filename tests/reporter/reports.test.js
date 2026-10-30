import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';
import { inspectOfflineReport } from '../helpers/offline-report.js';

let browser = { name: process.env.DYNO_TEST_BROWSER ?? 'chromium' };

test(
  'CLI saves escaped JSON, JUnit, and HTML that still works offline after app shutdown',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
  describe('Workflow', () => {
describe('Contacts & accounts',()=>{
    afterEach(({test})=>{if(test.name.startsWith('failure'))throw new Error('Cleanup <failed> & retained');});
    test('passed workflow',async({app,I})=>{await app.goto('/');await I.find('Fixture app').visible();console.log('Saved <contact> & ready');});
    test.skip('later');
    test('failure <script data-untrusted>window.injectedReportCode=true</script>',()=>{throw new Error('Save <failed> & retained');});
  });
});`
    });
    let result = await fixture.run(['--report-dir', 'output']).completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    let saved = result.events.find((event) => event.type === 'report-saved');
    assert.ok(saved);
    let report = JSON.parse(await readFile(saved.json, 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status, 'completed');
    assert.deepEqual([report.summary.passed, report.summary.failed, report.summary.skipped], [1, 1, 1]);
    assert.equal(report.tests[2].additionalErrors[0].phase, 'afterEach');
    assert.equal(report.tests[2].error.source.file, 'tests/browser/workflow.test.js');
    let xml = await readFile(saved.junit, 'utf8');
    assert.match(xml, /failures="1"/);
    assert.match(xml, /skipped="1"/);
    assert.match(xml, /Save &lt;failed&gt; &amp; retained/);
    assert.match(xml, /Cleanup &lt;failed&gt; &amp; retained/);
    let html = await readFile(saved.html, 'utf8');
    assert.match(html, /&lt;script data-untrusted&gt;/);
    assert.doesNotMatch(html, /connectionKey|private launch|fixtures/);
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
    assert.deepEqual(await inspectOfflineReport(t, saved.html, browser), { ok: true, images: 0, overflow: false });
  }
);

test('interrupt saves completed outcomes and honestly marks tests without results', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
  describe('Workflow', () => {
test('completed workflow',()=>{});
  test('interrupted workflow',async({app})=>{await app.goto('/held-app');});
  test('not reached',()=>{});
});`
  });
  let session = fixture.run();
  let { url } = await session.waitForEvent('ready');
  await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
  session.child.kill('SIGTERM');
  let result = await session.completion;
  assert.equal(result.code, 143, result.stdout + result.stderr);
  let saved = result.events.find((event) => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  assert.equal(report.status, 'interrupted');
  assert.deepEqual(
    report.tests.map((test) => test.status),
    ['passed', 'not-run', 'not-run']
  );
  assert.match(report.error.message, /stopped before/);
  let xml = await readFile(saved.junit, 'utf8');
  assert.match(xml, /errors="1"/);
  assert.match(xml, /name="Run interrupted"/);
  assert.equal(result.events.at(-1).type, 'stopped');
  let sessionTiming = JSON.parse(await readFile(saved.session, 'utf8'));
  assert.equal(sessionTiming.status, 'interrupted');
  assert.ok(sessionTiming.timings.entries.some(entry => entry.name === 'Cleanup' && entry.status === 'passed'));
  assert.ok(!sessionTiming.timings.entries.some(entry => entry.status === 'running'));
  assert.ok((await readdir(join(fixture.directory, '.dyno/reports'))).every((name) => !name.startsWith('.')));
});

test(
  'report storage errors fail the CLI and release the app instead of losing successful results silently',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, { files: { 'blocked-report': 'a file' }, config: { reportDir: 'blocked-report' } });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.ok(result.events.some((event) => event.type === 'error' && event.phase === 'report'));
    assert.match(result.stderr, /Could not save Dyno report|EEXIST|ENOTDIR/);
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
  }
);
