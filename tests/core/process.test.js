import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { project } from '../helpers/project.js';

test('CLI cleanup releases output pipes retained by a detached browser helper', {
  timeout: 20000, skip: process.platform === 'win32'
}, async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-pipe-helper-'));
  let record = join(directory, 'helper.json');
  let launcher = join(directory, 'browser.js');
  t.after(async () => {
    try {
      let helper = JSON.parse(await readFile(record, 'utf8'));
      try { process.kill(helper.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(launcher, `#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
let helper=spawn(process.execPath,['pipe-helper.js'],{detached:true,stdio:['ignore',process.stdout,process.stderr,'ipc']});
let [details]=await once(helper,'message');
await writeFile(${JSON.stringify(record)},JSON.stringify(details));
await fetch(new URL('/api/browser-waiting',process.argv.at(-1)),{method:'POST'});
await fetch(new URL('/api/release-browser',process.argv.at(-1)));
process.exit(0);
`, { mode: 0o755 });
  let fixture = await project(t, {
    config: { browser: { name: 'chrome', path: launcher } },
    files: {
      'pipe-helper.js': `
import {createServer} from 'node:http';
let server=createServer((request,response)=>response.end('retained helper'));
server.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:server.address().port}));
`
    }
  });
  let session = fixture.run();
  let { url } = await session.waitForEvent('ready');
  await fetch(new URL('/api/browser-waiting', url), { signal: t.signal });
  let helper = JSON.parse(await readFile(record, 'utf8'));
  await fetch(new URL('/api/release-browser', url), { method: 'POST', signal: t.signal });
  let result = await session.completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /closed before the run finished/);
  let response = await fetch(`http://127.0.0.1:${helper.port}`, { signal: t.signal });
  assert.equal(await response.text(), 'retained helper');
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});
