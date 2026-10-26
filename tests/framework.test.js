import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root = fileURLToPath(new URL('..', import.meta.url));
let fixtureServer = fileURLToPath(new URL('./fixtures/app-server.js', import.meta.url));
let cli = join(root, 'bin/dyno.js');

async function freePort() {
  let server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function project(source, overrides = {}) {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-test-'));
  let port = await freePort();
  await mkdir(join(directory, 'tests'));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'tests/workflow.test.js'), `import { test, beforeEach, afterEach, Interactor } from 'dyno';\n${source}`);
  let config = { testDir: './tests', port: 0, timeout: 1800, runTimeout: 15000, ...overrides,
    webServer: { command: [process.execPath, fixtureServer], url: `http://127.0.0.1:${port}`, ready: 'FIXTURE_READY', env: { PORT: String(port) }, ...overrides.webServer }
  };
  await writeFile(join(directory, 'dyno.config.js'), `export default ${JSON.stringify(config)};`);
  return { directory, port, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function run(directory, args = []) {
  let child = spawn(process.execPath, [cli, '--config', join(directory, 'dyno.config.js'), '--json', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let completion = (async () => {
    let [code, signal] = await once(child, 'exit');
    let events = stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    return { code, signal, stdout, stderr, events, summary: events.find(event => event.type === 'complete') };
  })();
  return { child, completion, get stdout() { return stdout; } };
}

test('runs real browser actions, preserves cookies/API origin, follows navigation, and resets both realms', { timeout: 30000 }, async () => {
  let fixture = await project(`
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
});`);
  try {
    let result = await run(fixture.directory).completion;
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(result.summary.passed, 4);
    assert.equal(result.summary.failed, 0);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  } finally { await fixture.cleanup(); }
});

test('reports startup errors, rejected promises, assertion diagnostics, and recovers after a hung test', { timeout: 30000 }, async () => {
  let fixture = await project(`
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
});`);
  try {
    let result = await run(fixture.directory).completion;
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
    assert.match(assertionFailure.error.stack, /tests\/workflow.test.js:\d+:\d+/);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  } finally { await fixture.cleanup(); }
});

test('leaves explicitly reused app servers running', { timeout: 15000 }, async () => {
  let fixture = await project(`test('opens reused app', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });`, { webServer: { reuseExistingServer: true } });
  let app = spawn(process.execPath, [fixtureServer], { env: { ...process.env, PORT: String(fixture.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(app.stdout, 'data');
    let result = await run(fixture.directory).completion;
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal((await fetch(`http://127.0.0.1:${fixture.port}`)).status, 200);
    assert.equal(app.exitCode, null);
  } finally {
    let closed = once(app, 'exit'); app.kill(); await closed;
    await fixture.cleanup();
  }
});

test('build errors fail before starting the app server', { timeout: 10000 }, async () => {
  let fixture = await project('test( broken syntax');
  try {
    let result = await run(fixture.directory).completion;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /error|Expected/i);
    assert.equal(result.events.some(event => event.type === 'ready'), false);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  } finally { await fixture.cleanup(); }
});

test('app startup and browser launch failures stop owned processes', { timeout: 15000 }, async () => {
  for (let overrides of [
    { webServer: { command: [process.execPath, '-e', 'process.exit(7)'] } },
    { browser: { path: '/missing/dyno-chrome' } }
  ]) {
    let fixture = await project(`test('never starts', async ({app, I}) => { await app.goto('/'); });`, overrides);
    try {
      let result = await run(fixture.directory).completion;
      assert.equal(result.code, 1, result.stderr + result.stdout);
      assert.match(result.stderr, /Process exited \(7\)|Chrome\/Chromium not found/);
      await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
    } finally { await fixture.cleanup(); }
  }
});

test('an exact-name filter runs the selected test with valid result ordering', { timeout: 15000 }, async () => {
  let fixture = await project(`
test('skip this workflow', () => { throw new Error('Should not run'); });
test('selected workflow', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });`);
  try {
    let result = await run(fixture.directory, ['--test', 'selected workflow']).completion;
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.events.find(event => event.type === 'test').name, 'selected workflow');
  } finally { await fixture.cleanup(); }
});

test('manual capture rebuilds changed tests, freezes active bundles, rejects duplicate results, and stops on a signal', { timeout: 15000 }, async () => {
  let fixture = await project(`test('original workflow', () => {});`);
  let process = run(fixture.directory, ['--manual']);
  let ready = async () => {
    while (true) {
      let event = process.stdout.split('\n').find(line => line.startsWith('{') && JSON.parse(line).type === 'ready');
      if (event) return JSON.parse(event).url;
      await once(process.child.stdout, 'data');
    }
  };
  try {
    let url = await ready();
    let foreignWrite = await fetch(new URL('/api/save', url), { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(foreignWrite.status, 403);
    let socket = new WebSocket(url.replace('http:', 'ws:').replace('/__dyno__/', '/socket'));
    let [message] = await once(socket, 'message');
    assert.equal(message.data, 'hello');
    let closed = once(socket, 'close');
    socket.close();
    await closed;
    let capture = async () => (await fetch(url + 'capture', { method: 'POST' })).json();
    let first = await capture();
    await writeFile(join(fixture.directory, 'tests/workflow.test.js'), `import {test} from 'dyno'; test('edited workflow', () => {});`);
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
    await writeFile(join(fixture.directory, 'tests/workflow.test.js'), 'broken javascript {{');
    assert.equal((await fetch(url + 'capture', { method: 'POST' })).status, 400);
  } finally {
    process.child.kill('SIGTERM');
    let result = await process.completion;
    assert.equal(result.code, 130, result.stderr + result.stdout);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
    await fixture.cleanup();
  }
});

test('test-module startup errors report immediately through the runtime guard', { timeout: 15000 }, async () => {
  let fixture = await project(`throw new Error('Test module exploded');`);
  try {
    let result = await run(fixture.directory).completion;
    assert.equal(result.code, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /Test module exploded/);
    assert.equal(result.events.some(event => event.type === 'complete'), false);
  } finally { await fixture.cleanup(); }
});
