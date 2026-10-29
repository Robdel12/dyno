import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { project } from '../helpers/project.js';

test(
  'manual startup recovers from popup blocking and a closed controller without replacing the app tab',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
test('saves and navigates with a persistent controller', async ({ app, I }) => {
  await app.goto('/');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
  await I.assert(() => app.window.top === app.window && app.window.frameElement === null);
  await app.pause('Inspect the saved contact');
  await I.click('Other page');
  await I.find('Other page').visible();
});`,
    });
    let session = fixture.run(['--manual']);
    let { url } = await session.waitForEvent('ready');
    let browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      ignoreDefaultArgs: ['--disable-popup-blocking'],
    });
    t.after(() => browser.close());
    let context = await browser.newContext();
    let app = await context.newPage();
    await app.goto(url);
    await app.getByRole('button', { name: 'Start tests', exact: true }).waitFor();
    let firstPopup = context.waitForEvent('page');
    await app.getByRole('button', { name: 'Start tests', exact: true }).click();
    let firstController = await firstPopup;
    let firstRun = await session.waitForEvent('capture');
    let reporter = app.frameLocator('#__dynoReporter');
    await reporter.getByRole('button', { name: 'Continue run', exact: true }).waitFor();
    await firstController.close();
    await app.getByRole('button', { name: 'Restart Dyno — controller closed', exact: true }).click();
    await app.getByRole('button', { name: 'Start tests', exact: true }).waitFor();
    let nextPopup = context.waitForEvent('page');
    await app.getByRole('button', { name: 'Start tests', exact: true }).click();
    let nextController = await nextPopup;
    let nextRun = await session.waitForEvent('capture', (event) => event.runId !== firstRun.runId);
    assert.notEqual(nextRun.runId, firstRun.runId);
    await app
      .frameLocator('#__dynoReporter')
      .getByRole('button', { name: 'Continue run', exact: true })
      .click();
    let completed = await session.waitForEvent('complete', (event) => event.runId === nextRun.runId);
    assert.equal(completed.passed, 1);
    assert.equal(completed.failed, 0);
    assert.equal(app.isClosed(), false);
    assert.equal(new URL(app.url()).pathname, '/other');
    assert.equal(nextController.isClosed(), false);
  },
);
