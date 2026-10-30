import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { project } from '../helpers/project.js';
import { inspectOfflineReport } from '../helpers/offline-report.js';

let browser = {
    name: process.env.DYNO_CAPTURE_BROWSER ?? 'chromium',
  ...(process.env.DYNO_CAPTURE_PATH ? { path: process.env.DYNO_CAPTURE_PATH } : {})
};

test(
  'saved report copies real PNGs and opens them after gateway shutdown and original artifact removal',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: { browser },
      source: `describe('Workflow', () => {
test('saved screenshot',async({app,I})=>{await app.goto('/visual');await I.find('$([role=status])').text('Ready');await app.screenshot('Saved app');});
});`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let saved = result.events.find((event) => event.type === 'report-saved');
    let report = JSON.parse(await readFile(saved.json, 'utf8'));
    let image = report.tests[0].attachments[0];
    assert.match(image.path, /^images\/[a-f0-9-]+\.png$/);
    assert.equal(image.url, image.path);
    let png = PNG.sync.read(await readFile(join(saved.directory, image.path)));
    assert.equal(png.width, image.width);
    assert.equal(png.height, image.height);
    await rm(join(fixture.directory, '.dyno/artifacts'), { recursive: true, force: true });
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
    assert.deepEqual(await inspectOfflineReport(t, saved.html, browser, { images: 1 }), {
      ok: true,
      images: 1,
      overflow: false
    });
  }
);

test('a removed source image is reported as unavailable without losing the run', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { browser },
    source: `
  describe('Workflow', () => {
test('recorded image',async({app})=>{await app.goto('/visual');await app.screenshot('Removed app image');});
  test('held after capture',async({app})=>{await app.goto('/held-app');});
});`
  });
  let session = fixture.run();
  let { url } = await session.waitForEvent('ready');
  let image = await session.waitForEvent('attachment');
  await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
  await rm(image.attachment.path);
  await fetch(new URL('/api/release-navigation', url), { method: 'POST' });
  let result = await session.completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let saved = result.events.find((event) => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  assert.equal(report.tests[0].attachments[0].status, 'missing');
  assert.match(await readFile(saved.html, 'utf8'), /Screenshot unavailable: Removed app image/);
});
