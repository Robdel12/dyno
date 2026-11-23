import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { project } from '../helpers/project.js';
import { inspectOfflineReport } from '../helpers/offline-report.js';

let browser = {
  name: process.env.DYNO_CAPTURE_BROWSER ?? 'chromium',
  ...(process.env.DYNO_CAPTURE_PATH ? { path: process.env.DYNO_CAPTURE_PATH } : {})
};

for (let { label, config, args, retain } of [
  { label: 'omits screenshots by default', retain: false },
  { label: 'copies screenshots when configured', config: { reportImages: true }, retain: true },
  { label: 'honors --no-report-images over configuration', config: { reportImages: true }, args: ['--no-report-images'], retain: false },
]) {
  test(`saved report ${label} and opens offline`, { timeout: 90000 }, async (t) => {
    let fixture = await project(t, {
      config: { browser, ...config },
      source: `describe('Workflow', () => {
        test('saved screenshot', async ({app, I}) => {
          await app.goto('/visual');
          await I.find('$([role=status])').text('Ready');
          let image = await app.screenshot('Saved app');
          let response = await fetch(image.url);
          let bytes = new DataView(await response.arrayBuffer());
          await I.assert(() => image.status === 'captured' && response.ok && bytes.getUint32(0) === 0x89504e47);
        });
      });`
    });
    let result = await fixture.run(args).completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let capture = result.events.find((event) => event.type === 'attachment').attachment;
    let source = await readFile(capture.path);
    let png = PNG.sync.read(source);
    let saved = result.events.find((event) => event.type === 'report-saved');
    let report = JSON.parse(await readFile(saved.json, 'utf8'));
    let image = report.tests[0].attachments[0];
    assert.equal(image.id, capture.id);
    assert.equal(png.width, image.width);
    assert.equal(png.height, image.height);
    let junit = await readFile(saved.junit, 'utf8');
    if (retain) {
      assert.equal(image.status, 'captured');
      assert.match(image.path, /^images\/[a-f0-9-]+\.png$/);
      assert.equal(image.url, image.path);
      assert.deepEqual(await readFile(join(saved.directory, image.path)), source);
      assert.ok(junit.includes(`Screenshot: ${image.path}`));
    } else {
      assert.equal(image.status, 'omitted');
      assert.equal(image.reason, 'Saved report images are disabled.');
      assert.equal('path' in image || 'url' in image, false);
      assert.equal((await readdir(saved.directory, { recursive: true })).some(path => path === 'images' || path.endsWith('.png')), false);
      assert.match(junit, /Screenshot omitted: Saved app \(Saved report images are disabled\.\)/);
    }
    await rm(join(fixture.directory, '.dyno/artifacts'), { recursive: true, force: true });
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
    let images = Number(retain);
    assert.deepEqual(await inspectOfflineReport(t, saved.html, browser, { images, omittedImage: retain ? undefined : image.name }), {
      ok: true,
      images,
      overflow: false
    });
  });
}

test('a removed source image is reported as unavailable without losing the run', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { browser, reportImages: false },
    source: `
  describe('Workflow', () => {
test('recorded image',async({app})=>{await app.goto('/visual');await app.screenshot('Removed app image');});
  test('held after capture',async({app})=>{await app.goto('/held-app');});
});`
  });
  let session = fixture.run(['--report-images']);
  let { url } = await session.waitForEvent('ready');
  let image = await session.waitForEvent('attachment');
  await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
  await rm(image.attachment.path);
  await fetch(new URL('/api/release-navigation', url), { method: 'POST' });
  let result = await session.completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let saved = result.events.find((event) => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  let attachment = report.tests[0].attachments[0];
  assert.equal(attachment.status, 'missing');
  assert.equal('path' in attachment || 'url' in attachment, false);
  assert.match(await readFile(saved.html, 'utf8'), /Screenshot unavailable: Removed app image/);
});
