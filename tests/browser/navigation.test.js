import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';

test('hash navigation preserves the app while returning to its exact URL reloads it', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: {
      webServer: { command: [process.execPath, 'navigation-app.js'], ready: 'NAVIGATION_READY' }
    },
    files: {
      'navigation-app.js': `
import { createServer } from 'node:http';
let server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><h1>Navigation app</h1><a href="#details">Show details</a><section id="details">Details</section>');
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('NAVIGATION_READY'));
`
    },
    source: `
test('app.goto changes fragments without replacing the app', async ({ app, I }) => {
  await app.goto('/visual#one');
  let document = app.document;
  let name = app.window.name;
  let bridge = app.window.__browserTestBridge.id;
  app.window.savedValue = 'same app';
  await app.goto('/visual#two');
  await I.assert(() => app.window.location.hash === '#two');
  await I.assert(() => app.document === document && app.window.name === name);
  await I.assert(() => app.window.__browserTestBridge.id === bridge && app.window.savedValue === 'same app');
  await app.goto(app.window.location.href);
  await I.assert(() => app.document !== document && app.window.savedValue === undefined);
  await I.assert(() => app.window.location.hash === '#two');
});
test('app.goto reloads the current URL after following a fragment link', async ({ app, I }) => {
  await app.goto('/visual');
  let document = app.document;
  app.window.savedValue = 'before reload';
  await I.click('Show details');
  await I.assert(() => app.window.location.hash === '#details' && app.document === document);
  await app.goto(app.window.location.pathname + app.window.location.search + app.window.location.hash);
  await I.assert(() => app.document !== document && app.window.savedValue === undefined);
  await I.assert(() => app.window.location.hash === '#details');
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 2);
  assert.equal(result.summary?.failed, 0);
});
