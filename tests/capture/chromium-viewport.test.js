import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { open } from '../../src/providers/playwright.js';

let name = process.env.DYNO_CAPTURE_BROWSER ?? 'chromium';

test('Chromium capture never exposes its temporary viewport to application handlers', {
  skip: name !== 'chromium', timeout: 60000,
}, async t => {
  let browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  let session = await open(browser, { name: 'chromium' }, { width: 800, height: 600 });
  t.after(() => session.stop());
  let context = browser.contexts()[0];
  let page = context.pages()[0];
  let client = await context.newCDPSession(page);
  // Exercise the real browser scheduling that exposes Chromium's temporary resize.
  await client.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  await page.setContent(`<!doctype html><style>
    html,body{margin:0;padding:0;scrollbar-width:none}
    section{height:100vh;background:rgb(180,40,90)}
    footer{height:1800px;background:rgb(20,160,80)}
  </style><section><button>Save</button><output>Ready</output></section><footer></footer><script>
    let smallestWidth = innerWidth;
    addEventListener('resize', () => { smallestWidth = Math.min(smallestWidth, innerWidth); });
    document.querySelector('button').onclick = () => document.querySelector('output').textContent = 'Saved';
  </script>`);
  for (let index = 0; index < 24; index++) {
    let image = PNG.sync.read(await session.capture({ fullPage: true }));
    assert.deepEqual([image.width, image.height], [800, 2400]);
    for (let [y, color] of [[300, [180, 40, 90]], [2100, [20, 160, 80]]]) {
      let offset = (y * image.width + 10) * 4;
      assert.deepEqual([...image.data.subarray(offset, offset + 4)], [...color, 255]);
    }
    assert.equal(await page.evaluate(() => smallestWidth), 800, 'Capture reached an app resize handler with a smaller viewport');
  }
  // A document can shrink after its element bounds were measured.
  await assert.rejects(
    session.capture({ clip: { x: 900, y: 0, width: 100, height: 100 } }),
    /no longer fits/,
  );
  await page.getByRole('button', { name: 'Save' }).click();
  assert.equal(await page.locator('output').textContent(), 'Saved');
  await session.resize({ width: 390, height: 844 });
  await page.waitForFunction(() => smallestWidth === 390);
  assert.equal(await page.evaluate(() => smallestWidth), 390);
  await session.resize({ width: 800, height: 600 });
  await page.setContent(`<style>
    html,body{margin:0;background:blue}
    div{position:fixed;right:0;bottom:0;width:50vw;height:50vh;background:red;transition:all 100ms}
  </style><div></div>`);
  let clip = { x: 400, y: 300, width: 400, height: 300 };
  let expected = PNG.sync.read(await page.screenshot({ fullPage: true, clip }));
  let actual = PNG.sync.read(await session.capture({ clip }));
  assert.deepEqual(actual.data, expected.data, 'A short-page element capture changed fixed viewport content');
});

test('Chromium capture preserves queued app events, debugger ownership, and navigation startup', {
  skip: name !== 'chromium', timeout: 60000,
}, async t => {
  let browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  let session = await open(browser, { name: 'chromium' }, { width: 800, height: 600 });
  t.after(() => session.stop());
  let context = browser.contexts()[0];
  let page = context.pages()[0];
  let client = await context.newCDPSession(page);
  await page.setContent(`<body style="height:2400px"><output>Waiting</output><script>
    addEventListener('message', () => document.querySelector('output').textContent = 'Notification received');
  </script>`);
  await client.send('Debugger.enable');
  let queued = Promise.withResolvers();
  client.once('Debugger.paused', event => {
    client.send('Debugger.evaluateOnCallFrame', {
      callFrameId: event.callFrames[0].callFrameId,
      expression: 'postMessage("notification", "*"); document.querySelector("output").textContent',
      returnByValue: true,
    }).then(queued.resolve, queued.reject);
  });
  let capture = session.capture({ fullPage: true });
  assert.equal((await queued.promise).result.value, 'Waiting');
  await capture;
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Notification received');

  let userPaused = Promise.withResolvers();
  client.once('Debugger.paused', userPaused.resolve);
  let userEvaluation = client.send('Runtime.evaluate', { expression: '(function userBreakpoint(){ debugger; })()' });
  let userPause = await userPaused.promise;
  await assert.rejects(session.capture({ fullPage: true }), /Resume the application debugger/);
  let stillPaused = await client.send('Debugger.evaluateOnCallFrame', {
    callFrameId: userPause.callFrames[0].callFrameId, expression: '21 * 2', returnByValue: true,
  });
  assert.equal(stillPaused.result.value, 42, 'Capture resumed a debugger pause it did not own');
  await client.send('Debugger.resume');
  await userEvaluation;

  let navigated = Promise.withResolvers();
  client.once('Debugger.paused', () => {
    page.goto('data:text/html,<output>Starting</output><script>document.querySelector("output").textContent="New app started"</script>')
      .then(navigated.resolve, navigated.reject);
  });
  await assert.rejects(session.capture({ fullPage: true }), /Application execution resumed or navigated/);
  await navigated.promise;
  assert.equal(await page.locator('output').textContent(), 'New app started');
  await client.send('Debugger.disable');
});

test('Chromium capture retains mobile pixel ratio, orientation, and touch after errors', {
  skip: name !== 'chromium', timeout: 60000,
}, async t => {
  let browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  let session = await open(browser, { name: 'chromium', isMobile: true, hasTouch: true, deviceScaleFactor: 1.5 }, { width: 393, height: 727 });
  t.after(() => session.stop());
  let page = browser.contexts()[0].pages()[0];
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:2400px}</style>Mobile record');
  for (let viewport of [{ width: 393, height: 727 }, { width: 727, height: 393 }]) {
    await session.resize(viewport);
    let before = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      touch: navigator.maxTouchPoints, orientation: screen.orientation.type,
      screenWidth: screen.width, screenHeight: screen.height,
    }));
    let image = PNG.sync.read(await session.capture({ fullPage: true }));
    assert.ok(Math.abs(image.width - viewport.width * 1.5) <= 1);
    assert.equal(image.height, 3600);
    await assert.rejects(session.capture({ clip: { x: 0, y: 0, width: 0, height: 20 } }), /0 width/);
    assert.deepEqual(await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      touch: navigator.maxTouchPoints, orientation: screen.orientation.type,
      screenWidth: screen.width, screenHeight: screen.height,
    })), before);
  }
});
