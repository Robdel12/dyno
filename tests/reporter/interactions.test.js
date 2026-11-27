import assert from 'node:assert/strict';
import test from 'node:test';
import { project } from '../helpers/project.js';
import { openURL } from '../helpers/manual.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let interactive = {
  browser: { name: browser, args: [browser === 'chromium' ? '--headless=new' : '--headless'] },
};

async function completedReporter(t, source) {
  let fixture = await project(t, { source, config: interactive });
  let session = fixture.run(['--ui']);
  let { url } = await session.waitForEvent('ready');
  let complete = await session.waitForEvent('complete');
  let page = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(complete.runId), url).href);
  await page.locator('html[data-phase="completed"]').waitFor();
  return { session, url, page, complete };
}

test('reporter deep links and keyboard navigation preserve filters through browser history', { timeout: 90000 }, async t => {
  let { page } = await completedReporter(t, `describe('Navigation', () => {
    test('first result', () => {});
    test.skip('later result');
  });`);
  await page.keyboard.press('/');
  assert.equal(await page.getByRole('searchbox', { name: 'Filter tests' }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('searchbox', { name: 'Filter tests' }).fill('unmatched search');
  await page.getByText('No tests match this filter.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Skipped', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Filter tests' }).fill('later');
  await page.getByRole('link', { name: 'Skipped: later result', exact: true }).click();
  await page.getByRole('heading', { name: 'later result', exact: true }).waitFor();
  assert.match(page.url(), /status=skipped/);
  assert.match(page.url(), /q=later/);
  await page.goBack();
  await page.getByRole('searchbox', { name: 'Filter tests' }).waitFor();
  assert.equal(await page.getByRole('searchbox', { name: 'Filter tests' }).inputValue(), 'later');
  assert.equal(await page.getByRole('button', { name: 'Skipped', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.goForward();
  await page.getByRole('heading', { name: 'later result', exact: true }).waitFor();
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('searchbox', { name: 'Filter tests' }).fill('');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('link', { name: 'Passed: first result', exact: true }).waitFor();
  await page.locator('#run-options summary').click();
  await page.getByLabel('Pause on failure', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#run-options').evaluate(node => node.open), false);
  await page.getByText('Run info', { exact: true }).click();
  await page.locator('#files').waitFor();
  await page.getByText('Run info', { exact: true }).click();
  await page.goto(page.url().split('#')[0] + '#/tests/%ZZ/output?q=first&status=passed');
  await page.getByRole('heading', { name: 'Test not found', exact: true }).waitFor();
  await page.locator('#not-found').getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('searchbox', { name: 'Filter tests' }).waitFor();
  assert.equal(await page.getByRole('searchbox', { name: 'Filter tests' }).inputValue(), 'first');
  assert.equal(await page.getByRole('button', { name: 'Passed', exact: true }).getAttribute('aria-pressed'), 'true');
});

test('copying reporter diagnostics includes cleanup failures and handles clipboard permission denial', {
  timeout: 90000, skip: browser !== 'chromium' && 'Chromium exposes clipboard permission control.',
}, async t => {
  let { page } = await completedReporter(t, `describe('Copy diagnostics', () => {
    describe('With cleanup', () => {
      afterEach(() => { throw new Error('Cleanup failed too'); });
      test('failed save', () => {
        console.warn('Save diagnostic');

        throw new Error('Save is unavailable');
      });
    });
    test('plain failure', () => { throw 'A failure without a stack'; });
    test.skip('not ready');
    test('no operations', () => {});
  });`);
  await page.getByRole('link', { name: 'Failed: failed save', exact: true }).click();
  await page.getByRole('heading', { name: 'Save is unavailable', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Cleanup failed too', exact: true }).waitFor();
  await page.context().grantPermissions([]);
  await page.getByRole('button', { name: 'Copy output', exact: true }).click();
  await page.getByText('Could not copy. Select the output and copy it with your browser.', { exact: true }).waitFor();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy output', exact: true }).click();
  await page.getByText('Test output copied.', { exact: true }).waitFor();
  let text = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(text, /failed save — failed/);
  assert.match(text, /Save is unavailable/);
  assert.match(text, /Cleanup failed too/);
  assert.match(text, /workflow\.test\.js/);
  assert.match(text, /Save diagnostic/);
  await page.getByRole('link', { name: 'Timings', exact: true }).click();
  await page.getByRole('button', { name: 'Copy timings', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Timings \(inclusive/);
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('link', { name: 'Failed: plain failure', exact: true }).click();
  await page.getByRole('heading', { name: 'A failure without a stack', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Copy output', exact: true }).click();
  await page.getByText('Test output copied.', { exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /A failure without a stack/);
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('link', { name: 'Skipped: not ready', exact: true }).click();
  await page.getByRole('button', { name: 'Copy output', exact: true }).click();
  await page.getByText('Test output copied.', { exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /not ready — skipped/);
  await page.getByRole('link', { name: 'Timings', exact: true }).click();
  await page.getByText('Timing details are unavailable for this test.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Copy timings', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Timing details are unavailable for this test.');
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('link', { name: 'Passed: no operations', exact: true }).click();
  await page.getByText('No console output for this test.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Timings', exact: true }).click();
  await page.getByText('No app operations or named steps were recorded.', { exact: true }).waitFor();
});

test('rerunning a selected test then the whole file keeps a comparable previous pull and viewport choices', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: interactive, source: `describe('Reruns', () => {
    test('first viewport', async ({ app }) => { await app.goto('/'); });
    test('second viewport', async ({ app }) => {
      await app.goto('/');
      await app.setViewport({ width: 999, height: 666 });
      await app.pause('Resize and continue');
    });
  });` });
  let session = fixture.run(['--ui']);
  let { url } = await session.waitForEvent('ready');
  let { runId } = await session.waitForEvent('capture');
  let page = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(runId), url).href);
  await page.getByText('Resize and continue', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Running: second viewport', exact: true }).click();
  await page.getByRole('link', { name: 'Application', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: /Viewport/ }).inputValue(), '999x666');
  await page.getByRole('combobox', { name: /Viewport/ }).selectOption('1280x800');
  await page.locator('#viewport option[data-current]').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Continue run', exact: true }).click();
  let complete = await session.waitForEvent('complete');
  await page.getByRole('button', { name: 'Run test', exact: true }).click();
  let selectedRun = await session.waitForEvent('capture', event => event.runId !== complete.runId);
  await page.waitForURL(url => url.searchParams.get('run') === selectedRun.runId);
  await page.getByText('Resize and continue', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue run', exact: true }).click();
  let selected = await session.waitForEvent('complete', event => event.runId === selectedRun.runId);
  assert.equal(selected.passed, 1);
  await page.locator('html[data-phase="completed"]').waitFor();
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('button', { name: 'Run all', exact: true }).click();
  let allRun = await session.waitForEvent('capture', event => ![complete.runId, selected.runId].includes(event.runId));
  await page.waitForURL(url => url.searchParams.get('run') === allRun.runId);
  await page.getByText('Resize and continue', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue run', exact: true }).click();
  let all = await session.waitForEvent('complete', event => event.runId === allRun.runId);
  assert.equal(all.passed, 2);
  await page.locator('html[data-phase="completed"]').waitFor();
  await page.getByText(/^Last pull, /).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Passed:/ }).count(), 2);
});

test('the live reporter distinguishes pending work, missing timings, and the console limit', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { ...interactive, timeout: 30000 },
    source: `describe('Progress', () => {
      test('streaming output', async ({ app }) => {
        await app.request('/api/browser-waiting', { method: 'POST' });
        await app.request('/api/release-browser');
        console.log('Progress message 0');
        await app.request('/api/capture-before', { method: 'POST' });
        await app.request('/api/release-capture');
        for (let index = 1; index < 100; index++) console.log('Progress message ' + index);
        await app.request('/api/capture-staged', { method: 'POST' });
        await app.request('/api/inspection');
      });
      test('next task', () => {});
    });`,
  });
  let session = fixture.run(['--ui']);
  let { url } = await session.waitForEvent('ready');
  await fetch(new URL('/api/browser-waiting', url), { signal: t.signal });
  let { runId } = await session.waitForEvent('capture');
  let page = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(runId), url).href);
  await page.getByRole('link', { name: 'Running: streaming output', exact: true }).click();
  await page.getByText('Waiting for console output…', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Timings', exact: true }).click();
  await page.getByText('Timing details appear when this test finishes.', { exact: true }).waitFor();
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('link', { name: 'Pending: next task', exact: true }).click();
  await page.getByRole('link', { name: 'Application', exact: true }).click();
  await page.getByRole('heading', { name: 'This test hasn’t run yet', exact: true }).waitFor();
  await page.getByRole('link', { name: /All tests/ }).click();
  await page.getByRole('link', { name: 'Running: streaming output', exact: true }).click();
  await fetch(new URL('/api/release-browser', url), { method: 'POST', signal: t.signal });
  await page.getByText('Progress message 0', { exact: true }).waitFor();
  await fetch(new URL('/api/release-capture', url), { method: 'POST', signal: t.signal });
  await page.getByText('Showing the first 100 console messages for this test.', { exact: true }).waitFor();
  await page.getByText('Progress message 99', { exact: true }).waitFor();
  assert.equal(await page.locator('.log-entry').count(), 100);
  await fetch(new URL('/api/inspection', url), { method: 'POST', body: '{}', signal: t.signal });
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 2);
});

test('manual reporter resize failures can be retried and controller loss disables run controls', { timeout: 90000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let app = await openURL(t, url);
  let complete = await session.waitForEvent('complete');
  let reporter = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(complete.runId), url).href);
  await reporter.getByRole('link', { name: 'Passed: opens the app', exact: true }).click();
  await reporter.getByRole('link', { name: 'Application', exact: true }).click();
  await reporter.getByRole('combobox', { name: /Viewport/ }).selectOption('390x844');
  await reporter.getByText('This browser cannot resize the application viewport. Resize its window manually or select a managed provider.', { exact: true }).waitFor();
  await reporter.getByRole('button', { name: 'Try again', exact: true }).click();
  await reporter.getByText('This browser cannot resize the application viewport. Resize its window manually or select a managed provider.', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => innerWidth), 1280);
  let controller = app.context().pages().find(page => new URL(page.url()).pathname === '/__dyno__/controller');
  assert.ok(controller);
  await controller.close();
  await reporter.getByText('The test browser disconnected. Restart Dyno or reopen its URL to reconnect.', { exact: true }).waitFor();
  assert.equal(await reporter.getByRole('button', { name: 'Run test', exact: true }).isDisabled(), true);
  assert.equal(await reporter.getByRole('button', { name: 'Try again', exact: true }).isDisabled(), true);
  await reporter.goto(new URL('/__dyno__/reporter', url).href);
  await reporter.getByRole('heading', { name: 'The run could not finish', exact: true }).waitFor();
  await reporter.getByText('Open a reporter URL from an active Dyno run.', { exact: true }).waitFor();
});

test('a session with autoRun off waits until a test is started from its reporter row', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: { ...interactive, autoRun: false }, source: `describe('Waiting', () => {
    test('first', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });
    test('second', () => {});
  });` });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  assert.equal(ready.idle, true);
  let start = await session.waitForEvent('start');
  assert.equal(start.tests.length, 2);
  let page = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(start.runId), ready.url).href);
  await page.getByRole('heading', { name: 'Ready to run' }).waitFor();
  await page.getByText('2 tests are ready.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Stop run' }).isVisible(), false);
  assert.equal(session.events.some(event => event.type === 'test'), false);
  await page.getByRole('button', { name: 'Run test second' }).click();
  let complete = await session.waitForEvent('complete');
  assert.deepEqual([complete.passed, complete.failed, complete.skipped], [1, 0, 0]);
  assert.deepEqual(session.events.filter(event => event.type === 'test').map(event => event.name), ['second']);
});
