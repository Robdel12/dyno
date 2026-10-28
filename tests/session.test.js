import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBrowser } from '../src/launcher.js';
import { project } from './helpers/project.js';

test(
  'the launched browser owns CLI completion even when a manual browser finishes first',
  { timeout: 90000, skip: process.platform === 'win32' },
  async (t) => {
    let name = process.env.DYNO_TEST_BROWSER ?? 'chrome';
    let actual = await resolveBrowser({ name });
    let fixture = await project(t, {
      config: { browser: { name, path: './gated-browser.js' } },
      files: {
        'gated-browser.js': `#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {once} from 'node:events';
let target=process.argv.at(-1);
await fetch(new URL('/api/browser-waiting',target),{method:'POST'});
await fetch(new URL('/api/release-browser',target));
let browser=spawn(${JSON.stringify(actual.path)},process.argv.slice(2),{stdio:'inherit'});
let [code]=await once(browser,'exit');process.exitCode=code??1;
`
      }
    });
    await chmod(join(fixture.directory, 'gated-browser.js'), 0o755);
    let session = fixture.run();
    let { url } = await session.waitForEvent('ready');
    await fetch(new URL('/api/browser-waiting', url), { signal: t.signal });
    let manual = await (await fetch(url + 'capture', { method: 'POST' })).json();
    let post = (event) =>
      fetch(url + 'events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: manual.runId, connectionKey: manual.connectionKey, ...event })
      });
    assert.equal((await post({ type: 'start', tests: ['manual companion'] })).status, 200);
    await post({ type: 'test', index: 0, name: 'manual companion', status: 'passed' });
    await post({ type: 'complete' });
    await fetch(new URL('/api/release-browser', url), { method: 'POST', signal: t.signal });
    let result = await session.completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let owned = result.events.find((event) => event.type === 'capture' && event.owned);
    assert.ok(owned);
    assert.notEqual(owned.runId, manual.runId);
    assert.equal(result.events.findLast((event) => event.type === 'complete').runId, owned.runId);
    assert.equal(result.events.filter((event) => event.type === 'complete').length, 2);
  }
);
