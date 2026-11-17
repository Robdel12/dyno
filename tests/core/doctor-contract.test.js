import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { project, launch, repository } from '../helpers/project.js';

let checkNamed = (result, name) => result.events.find(event => event.type === 'diagnosis').checks.find(check => check.name === name);

test('doctor explains app ownership conflicts, reuse, and a missing startup command without starting resources', { timeout: 15000 }, async t => {
  let app = createServer((request, response) => response.end('Externally owned app'));
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  let url = `http://127.0.0.1:${app.address().port}`;
  let conflict = await project(t, { config: { webServer: { url } } });
  let denied = await conflict.run(['doctor', '--manual']).completion;
  assert.equal(denied.code, 1);
  assert.equal(checkNamed(denied, 'app').status, 'failed');
  assert.match(checkNamed(denied, 'app').message, /already responds.*reuseExistingServer/);
  let shared = await project(t, { config: { webServer: { url, reuseExistingServer: true } } });
  let reused = await shared.run(['doctor', '--manual']).completion;
  assert.equal(reused.code, 0, reused.stderr);
  assert.match(checkNamed(reused, 'app').message, /Will reuse/);
  assert.equal(await (await fetch(url, { signal: t.signal })).text(), 'Externally owned app');
  let missing = await project(t, { config: { webServer: { command: undefined } } });
  let unavailable = await missing.run(['doctor', '--manual']).completion;
  assert.equal(unavailable.code, 1);
  assert.match(checkNamed(unavailable, 'app').message, /not responding.*command is missing/);
});

test('doctor distinguishes explicit browser paths, deferred channels, and a missing browser cache', { timeout: 15000 }, async t => {
  let name = process.env.DYNO_TEST_BROWSER ?? 'chromium';
  // Doctor checks that this configured path is executable; it does not launch it.
  let path = process.execPath;
  let custom = await project(t, { config: { browser: { name, path } } });
  let configured = await custom.run(['doctor', '--ui']).completion;
  assert.equal(configured.code, 0, configured.stderr);
  assert(checkNamed(configured, 'browser').message.includes(path));
  let channel = await project(t, { config: { browser: { name: 'chrome' } } });
  let deferred = await channel.run(['doctor']).completion;
  assert.equal(deferred.code, 0, deferred.stderr);
  assert.match(checkNamed(deferred, 'browser').message, /channel.*checked when the browser starts/);
  let fixture = await project(t);
  let env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(fixture.directory, 'missing-browser-cache') };
  let missing = await fixture.run(['doctor'], { env }).completion;
  assert.equal(missing.code, 1);
  assert.match(checkNamed(missing, 'browser').message, /Browser build is missing.*dyno install/);
  let listing = launch(process.execPath, [join(repository, 'bin/dyno.js'), 'browsers'], fixture.directory, t.signal, { env });
  t.after(() => listing.stop());
  let displayed = await listing.completion;
  assert.equal(displayed.code, 0, displayed.stderr);
  for (let browser of ['chromium', 'firefox', 'webkit']) assert.match(displayed.stdout, new RegExp(browser + '\\s+not installed'));
});
