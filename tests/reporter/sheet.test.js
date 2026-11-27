import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { browserEngine } from '../../src/browsers.js';
import { pullCurve, pullSheet } from '../../src/browser/dyno-chart.js';

let durations = [120, 95, 1240, 110, 76];
let curve = pullCurve(durations.map((duration, index) => ({ id: `test-${index}`, index, name: `test ${index}`, duration, status: 'passed' })));

test('clicking the flat stretch of a slow test opens that test, not just its dot', { timeout: 30000 }, async t => {
  let css = await readFile(new URL('../../src/browser/brand.css', import.meta.url), 'utf8');
  let browser = await browserEngine(process.env.DYNO_TEST_BROWSER ?? 'chromium').launch({ headless: true });
  t.after(() => browser.close());
  let page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  // A real origin, so following a hash link changes the page URL.
  await page.route('http://sheet.test/', (route) => route.fulfill({ contentType: 'text/html', body: `<style>${css} .sheet-frame { margin: 40px; height: 300px; }</style>
    <div class="sheet-frame"><div class="sheet-canvas">${pullSheet(curve, { href: (point) => `#/tests/${point.id}` })}</div></div>` }));
  await page.goto('http://sheet.test/');

  // The slow test's stretch runs from the end of the previous test to its own point. Click its middle,
  // well away from either dot.
  let [before, slow] = [curve.points[1], curve.points[2]];
  let middle = await page.evaluate(({ from, to, total, span }) => {
    let svg = document.querySelector('.sheet-plot');
    let point = svg.createSVGPoint();
    point.x = ((from.x + to.x) / 2 / span) * 1000;
    point.y = 300 - (((from.y + to.y) / 2) / total) * (300 - 14);
    let { x, y } = point.matrixTransform(svg.getScreenCTM());
    return { x, y };
  }, { from: before, to: slow, total: curve.total, span: curve.time });

  await page.mouse.click(middle.x, middle.y);
  await page.waitForURL('http://sheet.test/#/tests/test-2');

  // Each dot still opens its own test, even though the next test's stretch starts there.
  let dot = await page.locator('.sheet-point').nth(3).boundingBox();
  await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.waitForURL('http://sheet.test/#/tests/test-3');
});
