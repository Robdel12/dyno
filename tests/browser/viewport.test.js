import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

test(
  'URL-only execution resizes locally and reports optional images without pretending capture succeeded',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
test('optional capture on an ordinary browser', async ({ app, I }) => {
  await app.setViewport({ width: 390, height: 844 });
  await app.goto('/visual');
  await I.assert(
    () => app.window.innerWidth === 390 && app.window.matchMedia('(max-width:500px)').matches
  );
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
  'URL-only defaults use the real browser viewport and reset explicit sizing per test',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
test('fills the real browser', async ({ app, I }) => {
  await app.goto('/visual');
  await I.assert(
    () =>
      app.window.innerWidth === window.top.innerWidth &&
      app.window.innerHeight === window.top.innerHeight,
    'The app should fill the actual browser'
  );
  await app.setViewport({ width: 390, height: 844 });
  await I.assert(() => app.window.innerWidth === 390);
});
test('returns to the real browser size', async ({ app, I }) => {
  await app.goto('/visual');
  await I.assert(
    () =>
      app.window.innerWidth === window.top.innerWidth &&
      app.window.innerHeight === window.top.innerHeight
  );
});
`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.summary?.passed, 2);
  }
);
