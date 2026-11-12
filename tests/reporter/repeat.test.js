import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { project } from '../helpers/project.js';
import { browserEngine } from '../../src/browsers.js';

let browser = { name: process.env.DYNO_TEST_BROWSER ?? 'chromium' };

test('repeated-run HTML opens offline and links to the preserved failure after later passes', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `export default()=>{let execution=0;return {beforeExecution:()=>({fixtures:{execution:++execution}})}};` },
    source: `describe('Checkout',()=>{test('confirms <order>',async({app,I,fixtures})=>{
      await app.goto('/');await I.find('Fixture app').visible();
      await I.assert(()=>fixtures.execution>1,'Confirmation <missing>');
    });});`
  });
  let result = await fixture.run(['--repeat', '2', '--seed', 'checkout']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'repeat-complete');
  let native = await browserEngine(browser.name).launch({ headless: true });
  t.after(() => native.close());
  let page = await native.newPage();
  await page.goto(pathToFileURL(saved.html).href);
  assert.equal(await page.getByRole('heading', { name: 'Repeated runs: failed' }).count(), 1);
  assert.match(await page.locator('body').innerText(), /2\/2 rounds completed · 1 with failures/);
  let row = page.getByRole('row').filter({ hasText: 'Checkout › confirms <order>' });
  assert.deepEqual(await row.getByRole('cell').allTextContents(), ['Checkout › confirms <order>', '1', '1', '0', '0']);
  assert.match(await page.locator('body').innerText(), /Confirmation <missing>/);
  await page.getByRole('link', { name: 'Open the failed run' }).click();
  assert.match(await page.locator('body').innerText(), /Confirmation <missing>/);
});
