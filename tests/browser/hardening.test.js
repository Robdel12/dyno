import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { connect } from 'node:net';
import { readFile, chmod } from 'node:fs/promises';
import { project, reportPayload } from '../helpers/project.js';


test('browser selection reaches a real browser and missing exact test names explain the filter', { timeout: 150000 }, async t => {
  let fixture = await project(t);
  let result = await fixture.run(['run', '--browser', process.env.DYNO_TEST_BROWSER ?? 'chrome']).completion;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.events.find(event => event.type === 'ready').browser.isolated, true);
  assert.match(result.events.find(event => event.type === 'start').userAgent, /Chrome|Firefox/);
  let missing = await fixture.run(['--test', 'does not exist']).completion;
  assert.equal(missing.code, 1);
  assert.match(missing.events.find(event => event.type === 'fatal').error.message, /No test named "does not exist"/);
});

test('compressed HTML runs in a real browser without changing the app response contract', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
for (let path of ['/gzip-app', '/brotli-app']) test('uses compressed app ' + path, async ({app, I}) => {
  await app.goto(path);
  await I.type('Robert').into('$(input[name=name])'); await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
});` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 2);
});

test('capture limits preserve active browsers and make room when a run finishes', { timeout: 20000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let ids = [];
  let connections = [];
  for (let index = 0; index < 20; index++) {
    let response = await fetch(url + 'capture', { method: 'POST' });
    assert.equal(response.status, 200);
    let connection = await response.json();
    connections = [...connections, connection];
    ids = [...ids, connection.runId];
  }
  let full = await fetch(url + 'capture', { method: 'POST' });
  assert.equal(full.status, 429);
  assert.match(await full.text(), /20 active/);
  let results = await (await fetch(url + 'results')).json();
  assert.deepEqual(results.map(run => run.runId), ids);
  let completed = await fetch(url + 'events', { method: 'POST', body: JSON.stringify({ runId: ids[7], connectionKey: connections[7].connectionKey, type: 'fatal', error: { message: 'Browser closed' } }) });
  assert.equal(completed.status, 200);
  assert.equal((await fetch(url + 'capture', { method: 'POST' })).status, 200);
  results = await (await fetch(url + 'results')).json();
  assert.equal(results.length, 20);
  assert.equal(results[0].runId, ids[0]);
  assert.equal(results.some(run => run.runId === ids[7]), false);
});

test('unknown hosts, foreign websocket origins, and interrupted upstream streams leave the gateway usable', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let rejectedHost = await new Promise((resolve, reject) => {
    let outgoing = request(url + 'settings', { headers: { Host: 'foreign.example' } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    outgoing.once('error', reject);
    outgoing.end();
  });
  assert.equal(rejectedHost, 421);
  let upgrade = await fetch(new URL('/socket', url), { headers: { Origin: 'https://foreign.example' } });
  assert.equal(upgrade.status, 200); // Ordinary HTTP is still forwarded to the app.
  let address = new URL(url);
  let socket = connect(Number(address.port), address.hostname);
  t.after(() => socket.destroy());
  let response = new Promise((resolve, reject) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { data += chunk; });
    socket.once('end', () => resolve(data));
    socket.once('error', reject);
  });
  socket.end(`GET /socket HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: https://foreign.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  assert.match(await response, /^HTTP\/1.1 403/);
  await assert.rejects(async () => { let response = await fetch(new URL('/broken-stream', url)); await response.arrayBuffer(); });
  assert.equal((await fetch(url + 'settings')).status, 200);
});

test('an occupied gateway port reports its address and tears down acquired setup', { timeout: 15000 }, async t => {
  let occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  let fixture = await project(t, { config: { port: occupied.address().port, setup: './setup.js' }, files: { 'setup.js': `import {writeFile} from 'node:fs/promises'; export default async () => ({teardown: () => writeFile('cleaned.txt', 'done')});` } });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, new RegExp(`Cannot listen on 127.0.0.1:${occupied.address().port}: EADDRINUSE`));
  assert.equal(await readFile(join(fixture.directory, 'cleaned.txt'), 'utf8'), 'done');
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('startup deadlines and interrupts run project teardown and release the app port', { timeout: 15000 }, async t => {
  let fixture = await project(t, { config: { setup: './setup.js', webServer: { timeout: 300, command: [process.execPath, '--input-type=module', '-e', "import http from 'node:http'; http.createServer().listen(0, '127.0.0.1', () => console.log('booting without listening'));"] } }, files: { 'setup.js': `import {writeFile} from 'node:fs/promises'; export default async () => ({teardown: () => writeFile('cleaned.txt', 'done')});` } });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, /startup exceeded 300 ms/);
  assert.match(result.events.at(-1).message, /booting without listening/);
  assert.equal(await readFile(join(fixture.directory, 'cleaned.txt'), 'utf8'), 'done');
  let running = await project(t);
  let session = running.run(['--manual']);
  await session.waitForEvent('ready');
  session.child.kill('SIGINT');
  let stopped = await session.completion;
  assert.equal(stopped.code, 130);
  assert.equal(stopped.events.at(-1).signal, 'SIGINT');
  await assert.rejects(fetch(`http://127.0.0.1:${running.port}`));
});

test('reporter size limits and origin-relative paths reject bad requests without dropping active runs', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let { runId, connectionKey } = await (await fetch(url + 'capture', { method: 'POST' })).json();
  let large = await fetch(url + 'events', { method: 'POST', body: JSON.stringify({ runId, connectionKey, type: 'fatal', error: { message: 'é'.repeat(600000) } }) });
  assert.equal(large.status, 413);
  assert.match(await large.text(), /1 MB/);
  let foreign = await new Promise((resolve, reject) => {
    let outgoing = request(new URL(url), { path: '//foreign.example/secret' }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    outgoing.once('error', reject);
    outgoing.end();
  });
  assert.equal(foreign, 400);
  let names = ['saves café ☕'];
  let posted = await fetch(url + 'events', { method: 'POST', body: JSON.stringify({ runId, connectionKey, ...reportPayload({ type: 'start', tests: names }) }) });
  assert.equal(posted.status, 200);
  let [run] = await (await fetch(url + 'results')).json();
  assert.deepEqual(run.tests.map(test => test.name), names);
});

test('a misconfigured browser executable reports its output and releases the owned app', { timeout: 15000 }, async t => {
  let fixture = await project(t, { config: { browser: { path: process.execPath } } });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, /closed before the run finished/);
  assert.match(result.events.at(-1).message, /bad option/);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('stopping a run terminates descendants that ignore graceful shutdown', { timeout: 15000, skip: process.platform === 'win32' }, async t => {
  let fixture = await project(t, { config: { webServer: { env: { SPAWN_DESCENDANT: 'yes' } } } });
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let { port } = await (await fetch(new URL('/descendant', url))).json();
  assert.ok(port, 'Expected a real descendant server');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'descendant');
  session.child.kill('SIGTERM');
  let result = await session.completion;
  assert.equal(result.code, 143, result.stdout + result.stderr);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('a reporter can rerun the same selected test repeatedly without changing its URL', { timeout: 90000 }, async t => {
  let name = process.env.DYNO_TEST_BROWSER ?? 'chrome';
  let fixture = await project(t, { config: { browser: { name, args: [name === 'firefox' ? '--headless' : '--headless=new'] } }, source: `
test('first visible workflow', async ({app,I}) => {
  await app.goto('/'); await I.find('Fixture app').visible();
  await app.request('/api/lifecycle', {method:'POST', body:'visited'});
});
test('another workflow', async ({app,I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });` });
  let session = fixture.run(['--ui']);
  let {url} = await session.waitForEvent('ready');
  let first = await session.waitForEvent('complete');
  let rerun = runId => fetch(url+'control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,command:'rerun',ids:[JSON.stringify(['tests/browser/workflow.test.js','first visible workflow'])]})});
  assert.equal((await rerun(first.runId)).status,200);
  let second = await session.waitForEvent('complete', event => event.runId !== first.runId);
  assert.equal((await rerun(second.runId)).status,200);
  let third = await session.waitForEvent('complete', event => ![first.runId,second.runId].includes(event.runId));
  assert.equal(third.passed,1);
  let runs = await (await fetch(url+'results')).json();
  assert.equal(runs.length,3);
  assert.ok(runs.every(run=>run.status==='completed'));
  assert.deepEqual(runs[1].tests.map(test=>test.name),['first visible workflow']);
  assert.deepEqual(runs[2].tests.map(test=>test.name),['first visible workflow']);
  assert.deepEqual(await (await fetch(new URL('/api/lifecycle',url))).json(),['visited','visited','visited']);
});

test('a closed stdout consumer stops owned resources without an uncaught pipe error', { timeout: 15000, skip: process.platform === 'win32' }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  session.child.stdout.destroy();
  await fetch(url + 'capture', { method: 'POST' }).catch(() => {});
  let result = await session.completion;
  assert.equal(result.code, 143, result.stderr);
  assert.doesNotMatch(result.stderr, /Unhandled.*error|write EPIPE/);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});


test('a browser that stays open without joining includes its output in the deadline error', { timeout: 10000, skip: process.platform === 'win32' }, async t => {
  let fixture = await project(t, { config: { runTimeout: 1500 }, files: {
    'not-a-browser.js': `#!/usr/bin/env node
import { createServer } from 'node:http';
console.error('Diagnostic: this executable never opens the test URL');
createServer((request, response) => response.end('wrong executable')).listen(0, '127.0.0.1');
`
  } });
  let executable = join(fixture.directory, 'not-a-browser.js');
  await chmod(executable, 0o700);
  let result = await fixture.run(['--browser-path', executable]).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /No complete browser result within 1500 ms/);
  assert.match(result.events.at(-1).message, /Diagnostic: this executable never opens the test URL/);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});
