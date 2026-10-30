import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let interactiveBrowser = {
  name: browser,
  args: [['firefox', 'webkit'].includes(browser) ? '--headless' : '--headless=new'],
};

test('inspection opens on demand, preserves its route, and catches up after closing', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { browser: interactiveBrowser },
    source: `
describe('Reporter inspection', () => {
  test('inspects the current contact', async ({ app, I, step }) => {
    await app.goto('/');
    let document = app.document;
    let viewport = { width: app.window.innerWidth, height: app.window.innerHeight };
    await I.find('Name').then.fill('Robert');
    await I.click('Save');
    await I.find('$([role=status])').text('Saved Robert · 1');
    await I.assert(() => !document.querySelector('#__dynoReporter'), 'The app loaded a reporter before inspection');

    let paused = app.pause('Inspect this contact');
    let reporter;
    await I.assert(() => !!(reporter = document.querySelector('#__dynoReporter'))?.contentDocument?.querySelector('#main') && !reporter.hidden);
    let UI = I.scope(() => reporter.contentDocument.body);
    await UI.click('$(a[aria-label="Running: inspects the current contact"])');
    await UI.assert(() => reporter.contentWindow.location.hash.endsWith('/output'));
    let route = reporter.contentWindow.location.hash;
    let captureError;
    try { await app.screenshot('Reporter must stay out of app captures'); }
    catch (error) { captureError = error; }
    await I.assert(() => /Close the reporter/.test(captureError?.message));
    await UI.click('$(#close-reporter)');
    await I.assert(() => reporter.hidden);
    console.log('Contact output produced while inspection was closed');

    let observer = document.createElement('iframe');
    Object.assign(observer.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', border: '0', zIndex: '2147483647' });
    let loaded = new Promise(resolve => observer.addEventListener('load', resolve, { once: true }));
    observer.src = '/__dyno__/reporter?run=' + new URLSearchParams(location.search).get('run');
    document.body.append(observer);
    await loaded;
    let external = I.scope(() => observer.contentDocument.body);
    await external.click('$(a[aria-label="Running: inspects the current contact"])');
    await step('Read output in the late standalone reporter', () =>
      external.find('$(#output)').contains('Contact output produced while inspection was closed')
    );
    observer.hidden = true;

    let appUI = I.scope(() => document.documentElement);
    await appUI.click('Show test results');
    await I.assert(() => !reporter.hidden);
    await UI.assert(() => reporter.contentWindow.location.hash === route);
    await step('Read current output after reopening inspection', () =>
      UI.find('$(#output)').contains('Contact output produced while inspection was closed')
    );
    // A second close also proves the first close acknowledgement cleared the pending command.
    await UI.click('$(#close-reporter)');
    await I.assert(() => reporter.hidden);
    let image = await app.screenshot('Contact after inspection closes');
    await I.assert(() => image.status === 'captured' && app.window.innerWidth === viewport.width && app.window.innerHeight === viewport.height);
    observer.hidden = false;
    await external.click('$(#continue)');
    await paused;
    observer.remove();
  });
});`,
  });
  let session = fixture.run(['--ui']);
  let complete = await session.waitForEvent('complete');
  let result = await session.stop();
  assert.equal(complete.passed, 1, result.stdout + result.stderr);
  assert.equal(complete.failed, 0, result.stdout + result.stderr);
});

test('public viewport sizing stays real and the next test restores the configured size', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { viewport: { width: 800, height: 600 } },
    source: `
describe('Viewport boundaries', () => {
  test('sets the same public viewport twice', async ({ app, I }) => {
    await app.goto('/');
    await app.setViewport({ width: 390, height: 844 });
    await I.assert(() => app.window.innerWidth === 390 && app.window.innerHeight === 844);
    let viewport = await app.setViewport({ width: 390, height: 844 });
    await I.assert(() => viewport.width === 390 && viewport.height === 844);
    let image = await app.screenshot('Repeated public viewport');
    await I.assert(() => image.status === 'captured' && image.width === 390 * image.pixelRatio && image.height === 844 * image.pixelRatio);
  });
  test('starts with the configured viewport again', async ({ app, I }) => {
    await app.goto('/');
    await I.assert(() => app.window.innerWidth === 800 && app.window.innerHeight === 600);
    await I.find('Name').then.fill('Robert');
    await I.click('Save');
    await I.find('$([role=status])').text('Saved Robert · 1');
    let image = await app.screenshot('Configured viewport restored');
    await I.assert(() => image.status === 'captured' && image.width === 800 * image.pixelRatio && image.height === 600 * image.pixelRatio);
  });
});`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 2, result.stdout + result.stderr);
});
