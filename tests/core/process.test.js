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
