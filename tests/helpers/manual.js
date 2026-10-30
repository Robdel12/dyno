import { browserEngine } from '../../src/browsers.js';

// Playwright only opens the URL here; this browser has no Dyno controller.
export async function openURL(t, url) {
  let browser = await browserEngine(process.env.DYNO_TEST_BROWSER ?? 'chromium').launch({ headless: true });
  t.after(() => browser.close());
  let page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url);
  return page;
}

export async function runURL(t, fixture) {
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  await openURL(t, url);
  await Promise.race([session.waitForEvent('complete'), session.waitForEvent('fatal')]);
  return session.stop();
}
