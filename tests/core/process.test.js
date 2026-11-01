import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { project } from '../helpers/project.js';

test('CLI cleanup releases output pipes retained by an unrelated detached helper', {
  timeout: 20000, skip: process.platform === 'win32'
}, async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-retained-helper-'));
  let record = join(directory, 'helper.json');
  t.after(async () => {
    try {
      let helper = JSON.parse(await readFile(record, 'utf8'));
      try { process.kill(helper.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  let fixture = await project(t, {
    config: { webServer: { command: [process.execPath, 'app.js'] } },
    files: {
      'app.js': `import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
let helper=spawn(process.execPath,['pipe-helper.js'],{detached:true,stdio:['ignore',process.stdout,process.stderr,'ipc']});
let [details]=await once(helper,'message');
await writeFile(${JSON.stringify(record)},JSON.stringify(details));
createServer((request,response)=>request.url==='/exit'
  ? response.end('exiting',()=>process.exit(9)) : response.end('app'))
.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('FIXTURE_READY'));
`,
      'pipe-helper.js': `import {createServer} from 'node:http';
let server=createServer((request,response)=>response.end('retained helper'));
server.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:server.address().port}));
`
    }
  });
  let session = fixture.run(['--manual']);
  await session.waitForEvent('ready');
  let helper = JSON.parse(await readFile(record, 'utf8'));
  await fetch(`http://127.0.0.1:${fixture.port}/exit`);
  let result = await session.completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Process exited \(9\)/);
  let response = await fetch(`http://127.0.0.1:${helper.port}`, { signal: t.signal });
  assert.equal(await response.text(), 'retained helper');
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

let setupFiles = {
  'setup.js': `import {writeFile} from 'node:fs/promises';
    export default async () => ({teardown: () => writeFile('cleaned.txt', 'done')});`
};

test('an app startup deadline tears down the project and releases its port', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', webServer: {
      timeout: 300,
      command: [process.execPath, '--input-type=module', '-e',
        "import http from 'node:http'; http.createServer().listen(0, '127.0.0.1', () => console.log('booting without listening'));"],
    } },
    files: setupFiles,
  });
  let result = await fixture.run(['--manual']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /startup exceeded 300 ms/);
  assert.equal(await readFile(join(fixture.directory, 'cleaned.txt'), 'utf8'), 'done');
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('app startup failure includes emitted output and tears down the project', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', webServer: {
      command: [process.execPath, '--input-type=module', '-e',
        "console.log('booting before failure'); process.exitCode = 7;"],
    } },
    files: setupFiles,
  });
  let result = await fixture.run(['--manual']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /Process exited \(7\)/);
  assert.match(result.events.at(-1).message, /booting before failure/);
  assert.equal(await readFile(join(fixture.directory, 'cleaned.txt'), 'utf8'), 'done');
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('interrupting a ready app tears down the project and releases its port', { timeout: 15000 }, async t => {
  let fixture = await project(t, { config: { setup: './setup.js' }, files: setupFiles });
  let session = fixture.run(['--manual']);
  await session.waitForEvent('ready');
  session.child.kill('SIGINT');
  let result = await session.completion;
  assert.equal(result.code, 130, result.stdout + result.stderr);
  assert.equal(result.events.at(-1).signal, 'SIGINT');
  assert.equal(await readFile(join(fixture.directory, 'cleaned.txt'), 'utf8'), 'done');
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('an idle controller stream receives keepalives and reports closing without producing test outcomes', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let owner = await (await fetch(url + 'capture', { method: 'POST', signal: t.signal })).json();
  let { runId } = owner;
  let stream = await fetch(url + 'stream?role=host&run=' + runId, { signal: t.signal });
  assert.equal(stream.status, 200);
  await session.waitForEvent('browser-connection', event => event.runId === runId && event.status === 'connected');
  let reader = stream.body.getReader(), decoder = new TextDecoder(), received = '';
  while (!received.includes(': keepalive\n\n')) {
    let chunk = await reader.read();
    assert.equal(chunk.done, false, 'The idle controller disconnected before its keepalive.');
    received += decoder.decode(chunk.value, { stream: true });
  }
  let status = await fetch(url + 'connection-status', { method: 'POST', signal: t.signal,
    body: JSON.stringify({ ...owner, status: 'reconnecting' }) });
  assert.equal(status.status, 200);
  await session.waitForEvent('browser-connection', event => event.runId === runId && event.source === 'browser' && event.status === 'reconnecting');
  await reader.cancel();
  let closed = await session.waitForEvent('browser-connection', event => event.runId === runId && event.status === 'closed');
  assert.equal(closed.reason, 'disconnected');
  assert.ok(closed.duration >= 0);
  assert.equal(session.events.some(event => ['test', 'complete', 'fatal'].includes(event.type)), false);
});
