import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

test(
  'URL-only execution uses the actual top-level viewport and reports unavailable capture honestly',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
test('optional capture on an ordinary browser', async ({ app, I }) => {
  await app.goto('/visual');
  let actual = {width:app.window.innerWidth,height:app.window.innerHeight};
  await I.assert(() => app.window === app.window.top && app.window.frameElement === null, 'The application must occupy a top-level browsing context');
  await I.assert(() => app.window.matchMedia('(width:' + actual.width + 'px)').matches);
  await app.setViewport(actual);
  await I.assert(() => app.window.innerWidth === actual.width && app.window.innerHeight === actual.height);
  let image = await app.screenshot('optional image', { optional: true });
  await I.assert(() => image.status === 'skipped' && !image.path);
});
test('required capture explains the missing provider', async ({ app }) => {
  await app.goto('/visual');
  await app.screenshot('required image');
});
`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(result.summary?.passed, 1, result.stdout + result.stderr);
    assert.equal(result.summary?.failed, 1);
    assert.equal(result.events.find((event) => event.type === 'attachment').attachment.status, 'skipped');
    assert.match(
      result.events.find((event) => event.type === 'test' && event.status === 'failed').error.message,
      /no capture provider/
    );
    await assert.rejects(readdir(join(fixture.directory, '.dyno/artifacts')), { code: 'ENOENT' });
  }
);

test('unfinished app operations fail explicitly and awaited errors remain catchable', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
afterEach(({ app }) => {
  if (window.unfinishedHook) app.setViewport({ width: 600, height: 400 });
});
test('requires awaiting viewport work', ({ app }) => {
  app.setViewport({ width: 390, height: 844 });
});
test('requires awaiting cleanup work', async ({ app }) => {
  await app.goto('/visual');
  window.unfinishedHook = true;
});
test('keeps awaited operation failures catchable', async ({ app, I }) => {
  await app.goto('/visual');
  let error;
  try {
    await app.setViewport({ width: 0, height: 1 });
  } catch (failure) {
    error = failure.message;
  }
  await I.assert(() => /integers/.test(error));
  await I.find('$(form)').visible();
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 1, result.stdout + result.stderr);
  assert.equal(result.summary.failed, 2);
  assert.ok(
    result.events
      .filter((event) => event.type === 'test' && event.status === 'failed')
      .every((event) => /Await app/.test(event.error.message))
  );
});

test(
  'URL-only resize requests fail clearly while navigation preserves the actual browser viewport',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
test('fills the real top-level browser', async ({ app, I }) => {
  await app.goto('/visual');
  let actual = {width:app.window.innerWidth,height:app.window.innerHeight};
  await I.assert(() => app.window.top === app.window && app.window.frameElement === null, 'The app should fill its own top-level browser');
  app.window.localStorage.setItem('actual-viewport', JSON.stringify(actual));
  let failure;
  try { await app.setViewport({width:actual.width === 390 ? 391 : 390,height:actual.height}); }
  catch(error) { failure=error.message; }
  await I.assert(() => /cannot resize the application viewport.*managed provider/.test(failure), 'An ordinary browser must explain that it cannot resize its own window');
  await I.assert(() => app.window.innerWidth === actual.width && app.window.innerHeight === actual.height, 'A rejected resize changed the app viewport');
  await app.goto('/other');
  await I.find('Other page').visible();
  await I.assert(() => app.window.innerWidth === actual.width && app.window.innerHeight === actual.height, 'Navigation changed the actual viewport');
});
test('starts the next document at the actual browser size', async ({ app, I }) => {
  await app.goto('/visual');
  let actual=JSON.parse(app.window.localStorage.getItem('actual-viewport'));
  await I.assert(() => app.window.innerWidth === actual.width && app.window.innerHeight === actual.height);
  await I.assert(() => app.window === app.window.top && app.window.frameElement === null);
});
`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.summary?.passed, 2);
  }
);

test('an unsupported configured viewport fails before executing the app workflow', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { viewport: { width: 8192, height: 8192 } },
    source: `test('must not pretend to resize',()=>{throw new Error('Workflow started with the wrong viewport');});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let fatal = result.events.find((event) => event.type === 'fatal');
  assert.match(fatal.error.message, /cannot resize the application viewport/);
  assert.equal(
    result.events.some((event) => event.type === 'test'),
    false
  );
});
