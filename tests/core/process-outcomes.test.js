import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startProcess, startWebServer } from '../../src/process.js';
import { project } from '../helpers/project.js';

test('an executable that cannot start reports its operating-system error and still cleans up safely', { timeout: 10000 }, async t => {
  let fixture = await project(t);
  let command = startProcess(join(fixture.directory, 'not-an-executable'), { shell: false });
  t.after(() => command.stop());
  await assert.rejects(command.ready, { code: 'ENOENT' });
  await command.stop();
  await command.stop();
  assert.equal(command.failure.code, 'ENOENT');
});

test('process output keeps the latest startup diagnostics when a command produces a large log', { timeout: 10000 }, async t => {
  let command = startProcess(process.execPath, { shell: false,
    args: ['--input-type=module', '-e', `process.stdout.write('FIRST-LINE\\n' + 'diagnostic\\n'.repeat(3000) + 'FINAL-DIAGNOSTIC');`] });
  t.after(() => command.stop());
  await command.ready;
  assert.equal((await command.closed).code, 0);
  assert.match(command.logs, /FINAL-DIAGNOSTIC$/);
  assert.doesNotMatch(command.logs, /FIRST-LINE/);
  await command.stop();
});

test('reusing an external app requires opt-in and never transfers shutdown ownership', { timeout: 10000 }, async t => {
  let app = createServer((request, response) => response.end('External app remains available'));
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  let url = `http://127.0.0.1:${app.address().port}`;
  await assert.rejects(startWebServer({ url, timeout: 1000 }), /already running.*reuseExistingServer/);
  let reused = await startWebServer({ url, timeout: 1000, reuseExistingServer: true });
  await reused.stop();
  assert.equal(await (await fetch(url, { signal: t.signal })).text(), 'External app remains available');
  let fixture = await project(t);
  await assert.rejects(startWebServer({ url: `http://127.0.0.1:${fixture.port}`, timeout: 1000 }),
    /No app server.*webServer.command/);
});
