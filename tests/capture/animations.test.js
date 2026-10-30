import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { project } from '../helpers/project.js';

let name = process.env.DYNO_CAPTURE_BROWSER ?? 'chromium';
let browser = {
  name,
  ...(process.env.DYNO_CAPTURE_PATH ? { path: process.env.DYNO_CAPTURE_PATH } : {})
};
let surface = `
  await app.goto('/visual');
  let document = app.document;
  document.documentElement.style.cssText = 'margin:0;scrollbar-width:none';
  document.body.style.cssText = 'margin:0;background:rgb(20,150,80)';
  document.body.replaceChildren();
  let css = document.createElement('style');
  css.textContent = '@keyframes dyno-move { from { transform:translate(0,0) } to { transform:translate(260px,800px) } }';
  document.head.append(css);
  let height = document.createElement('div');
  height.style.height = '600px';
  document.body.append(height);
  let growing = height.animate([{height:'600px'},{height:'1800px'}], {duration:60000,fill:'forwards'});
  growing.pause();
  let secret = document.createElement('div');
  secret.textContent = 'Private information';
  secret.style.cssText = 'position:absolute;left:0;top:100px;width:40px;height:40px;background:rgb(240,200,20);animation:dyno-move 60s linear paused forwards';
  document.body.append(secret);
  let moving = secret.getAnimations()[0];
  let widened;
  moving.addEventListener('finish', () => {
    secret.textContent = 'Private information ready';
    widened = secret.animate([{width:'40px'},{width:'80px'}],{duration:60000,fill:'forwards'});
    widened.pause();
  },{once:true});
  let spinner = document.createElement('div');
  document.body.append(spinner);
  let infinite = spinner.animate([{opacity:0.2},{opacity:0.8}],{duration:60000,iterations:Infinity});
  let input = document.createElement('input');
  input.style.cssText = 'position:absolute;left:10px;top:10px;caret-color:rgb(200,30,50)';
  document.body.append(input);
  input.focus();
  let styles = document.querySelectorAll('style').length;
`;
let restored = `
  await I.assert(() => infinite.playState === 'running', 'The infinite animation did not resume');
  await I.assert(() => app.window.getComputedStyle(input).caretColor === 'rgb(200, 30, 50)', 'The caret style was not restored');
  await I.assert(() => document.querySelectorAll('style').length === styles, 'Capture left a temporary style behind');
  await I.assert(() => {
    let box = secret.getBoundingClientRect();
    return box.x === 260 && box.y === 900 && box.width === 80 && box.height === 40 && height.getBoundingClientRect().height === 1800;
  }, 'Finite animations did not reach their final rendered layout');
  await I.assert(() => secret.textContent === 'Private information ready', 'The animation finish handler did not update the app');
`;

test(
  'capture finishes moving masks and document layout before measuring pixels',
  {
    timeout: 90000,

  },
  async (t) => {
    let fixture = await project(t, {
      config: { browser, viewport: { width: 800, height: 600 } },
      source: `describe('Workflow', () => {
test('captures the final animated layout', async ({app,I}) => {
      ${surface}
      await app.screenshot('finished animations',{fullPage:true,animations:'disabled',caret:'hide',mask:[secret]});
      ${restored}
      await I.assert(() => app.window.innerWidth === 800 && app.window.innerHeight === 600);
    });
});`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let attachment = result.events.find((event) => event.type === 'attachment').attachment;
    let image = PNG.sync.read(await readFile(attachment.path));
    let ratio = attachment.pixelRatio;
    assert.equal(image.width, 800 * ratio);
    assert.equal(image.height, 1800 * ratio);
    for (let y = 900 * ratio; y < 940 * ratio; y++)
      for (let x = 260 * ratio; x < 340 * ratio; x++) {
        let offset = (y * image.width + x) * 4;
        assert.deepEqual([...image.data.subarray(offset, offset + 4)], [255, 0, 255, 255]);
      }
    assert.deepEqual(attachment.policy, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      scale: 'device'
    });
  }
);

test('a failed capture restores infinite animations and caret styling', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { browser, viewport: { width: 800, height: 600 } },
    source: `describe('Workflow', () => {
test('restores rendering when masks are invalid', async ({app,I}) => {
      ${surface}
      let failure;
      try { await app.screenshot('invalid mask',{animations:'disabled',caret:'hide',mask:[document.createElement('div')]}); }
      catch (error) { failure = error.message; }
      await I.assert(() => /connected elements/.test(failure), 'Invalid capture did not fail clearly');
      ${restored}
    });
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(
    result.events.some((event) => event.type === 'attachment'),
    false
  );
});
