import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project, repository } from './helpers/project.js';

let fixtureServer = join(repository, 'tests/fixtures/app-server.js');

test('runs real browser actions, preserves cookies/API origin, follows navigation, and resets both realms', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('saves exactly once through the HTTP boundary', async ({app, I}) => {
  await app.goto('/');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
  let cookie = await (await app.request('/api/cookie')).json();
  await I.assert(() => cookie.cookie.includes('saved=yes'), 'Expected the saved session cookie');
  window.testOnly = true;
  Array.prototype.testOnly = true;
  await I.assert(() => app.window.testOnly === undefined, 'Runner global leaked into app');
  await I.assert(() => app.window.Array.prototype.testOnly === undefined, 'Runner prototype leaked into app');
});
test('fresh test and app contexts', async ({app, I}) => {
  await app.goto('/');
  await I.assert(() => window.testOnly === undefined, 'Test global leaked into next test');
  await I.assert(() => Array.prototype.testOnly === undefined, 'Test prototype leaked into next test');
  await I.find('$([role=status])').text('Ready');
});
test('observes property-only changes and completes actions that replace their targets', async ({app, I}) => {
  await app.goto('/');
  await I.click('Change property');
  await I.find('$(input[name=name])').value('Property only');
  await I.click('Dismiss notice');
  await I.find('$([role=status])').text('Notice dismissed');
  await I.click('"Compare"$(option)');
  await I.find('$(output)').text('Review mode: Compare');
});
test('follows full-document links and explicit redirects without stale reads', async ({app, I}) => {
  await app.goto('/');
  await I.click('Other page');
  await I.find('Other page').visible();
  await app.goto('/redirect');
  await I.assert(() => app.window.location.pathname === '/other', 'Expected the other page URL');
  await I.find('Other page').visible();
});` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(result.summary.passed, 4);
  assert.equal(result.summary.failed, 0);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('waits for the app response before interacting and reports the saved result', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('saves after the app finishes loading', async ({app,I}) => {
  await app.goto('/held-app');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
});` });
  let session = fixture.run();
  let { url } = await session.waitForEvent('ready');
  let requested = await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
  assert.equal(await requested.text(), 'navigation requested');
  let [waiting] = await (await fetch(url + 'results', { signal: t.signal })).json();
  assert.equal(waiting.status, 'running');
  assert.deepEqual(waiting.outcomes, []);
  let released = await fetch(new URL('/api/release-navigation', url), { method: 'POST', signal: t.signal });
  assert.equal(await released.text(), 'navigation released');
  let result = await session.completion;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(result.summary.passed, 1);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('reports startup errors, rejected promises, assertion diagnostics, and recovers after a hung test', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('early app exception', async ({app, I}) => { await app.goto('/startup-error'); });
test('unhandled rejection', async ({app, I}) => {
  await app.goto('/'); await I.click('Reject');
  await I.find('$([role=status])').text('Completed');
});
test('failed assertion', async ({app, I}) => {
  await app.goto('/'); await I.find('$([role=status])').text('Expected status');
}, {timeout: 4000});
test('unresolved test', () => new Promise(() => {}), {timeout: 200});
test('runs cleanly after failures', async ({app, I}) => {
  await app.goto('/'); await I.find('$([role=status])').text('Ready');
});` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stderr + result.stdout);
  assert.equal(result.summary.passed, 1, result.stderr + result.stdout);
  assert.equal(result.summary.failed, 4);
  let errors = result.events.filter(event => event.type === 'test' && event.error).map(event => event.error.message).join('\n');
  assert.match(errors, /Startup exploded/);
  assert.match(errors, /Unhandled app rejection/);
  assert.match(errors, /Expected status/);
  assert.match(errors, /text is "Ready" but expected "Expected status"/);
  assert.match(errors, /exceeded 200 ms/);
  let assertionFailure = result.events.find(event => event.name === 'failed assertion');
  assert.match(assertionFailure.error.stack, /tests\/browser\/workflow.test.js:\d+:\d+/);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('leaves explicitly reused app servers running', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `test('opens reused app', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });`, config: { webServer: { reuseExistingServer: true } } });
  let app = spawn(process.execPath, [fixtureServer], { env: { ...process.env, PORT: String(fixture.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(app.stdout, 'data');
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal((await fetch(`http://127.0.0.1:${fixture.port}`)).status, 200);
    assert.equal(app.exitCode, null);
  } finally {
    let closed = once(app, 'exit'); app.kill(); await closed;
  }
});

test('build errors fail before starting the app server', { timeout: 10000 }, async t => {
  let fixture = await project(t, { source: 'test( broken syntax' });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /error|Expected/i);
  assert.equal(result.events.some(event => event.type === 'ready'), false);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('app startup and browser launch failures stop owned processes', { timeout: 90000 }, async t => {
  for (let overrides of [
    { webServer: { command: [process.execPath, '-e', 'process.exit(7)'] } },
    { browser: { path: '/missing/dyno-chrome' } }
  ]) {
    let fixture = await project(t, { source: `test('never starts', async ({app, I}) => { await app.goto('/'); });`, config: overrides });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /Process exited \(7\)|chrome not found/);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  }
});

test('an exact-name filter runs the selected test with valid result ordering', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('skip this workflow', () => { throw new Error('Should not run'); });
test('selected workflow', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });` });
  let result = await fixture.run(['--test', 'selected workflow']).completion;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.events.find(event => event.type === 'test').name, 'selected workflow');
});

test('manual capture rebuilds changed tests, freezes active bundles, rejects duplicate results, and stops on a signal', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `test('original workflow', () => {});` });
  let session = fixture.run(['--manual']);
  try {
    let { url } = await session.waitForEvent('ready');
    let foreignWrite = await fetch(new URL('/api/save', url), { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(foreignWrite.status, 403);
    let socket = new WebSocket(url.replace('http:', 'ws:').replace('/__dyno__/', '/socket'));
    let [message] = await once(socket, 'message', { signal: AbortSignal.timeout(5000) });
    assert.equal(message.data, 'hello');
    let closed = once(socket, 'close');
    socket.close();
    await closed;
    let capture = async () => (await fetch(url + 'capture', { method: 'POST' })).json();
    let first = await capture();
    await writeFile(join(fixture.directory, 'tests/browser/workflow.test.js'), `import {test} from 'dyno'; test('edited workflow', () => {});`);
    let second = await capture();
    let firstBundle = await (await fetch(url + `suite.js?run=${first.runId}`)).text();
    let secondBundle = await (await fetch(url + `suite.js?run=${second.runId}`)).text();
    assert.match(firstBundle, /original workflow/);
    assert.doesNotMatch(firstBundle, /edited workflow/);
    assert.match(secondBundle, /edited workflow/);
    let post = event => fetch(url + 'events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: second.runId, ...event }) });
    assert.equal((await post({ type: 'start', tests: ['edited workflow'] })).status, 200);
    assert.equal((await post({ type: 'test', index: 0, name: 'edited workflow', status: 'passed' })).status, 200);
    assert.equal((await post({ type: 'test', index: 0, name: 'edited workflow', status: 'passed' })).status, 400);
    assert.equal((await post({ type: 'complete', failed: 99, passed: 0 })).status, 200);
    let runs = await (await fetch(url + 'results')).json();
    assert.equal(runs.find(run => run.runId === second.runId).summary.passed, 1);
    await writeFile(join(fixture.directory, 'tests/browser/workflow.test.js'), 'broken javascript {{');
    assert.equal((await fetch(url + 'capture', { method: 'POST' })).status, 400);
  } finally {
    session.child.kill('SIGTERM');
    let result = await session.completion;
    assert.equal(result.code, 143, result.stderr + result.stdout);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  }
});

test('test-module startup errors report immediately through the runtime guard', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `throw new Error('Test module exploded');` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stderr + result.stdout);
  assert.match(result.stderr, /Test module exploded/);
  assert.equal(result.events.some(event => event.type === 'complete'), false);
});
