import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chrome';
let visible = { browser: { name: browser, args: [browser === 'firefox' ? '--headless' : '--headless=new'] } };

test('stopping watch during a rebuild releases the app without reporting a cancelled build as an error', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual', '--watch']);
  await session.waitForEvent('ready');
  let file = join(fixture.directory, 'tests/browser/workflow.test.js');
  await writeFile(file, `test('updated workflow', async ({app,I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });`);
  await session.waitForEvent('watch', event => event.status === 'building');
  session.child.kill('SIGTERM');
  let result = await session.completion;
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.equal(result.events.some(event => event.type === 'watch' && event.status === 'error'), false);
  let timingIndex = result.events.findIndex(event => event.type === 'session-timing');
  assert.deepEqual(result.events.slice(timingIndex + 1).map(event => event.type), ['stopped']);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test(
  'debug pause preserves the app and test, suspends its deadline, and resumes through the reporter',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: {...visible,cleanupTimeout:200},
      source: `
  test('inspect midway',async({app,I})=>{
    await app.goto('/'); await I.type('Still here').into('$(input[name=name])');
    await app.pause('Inspect this contact');
    await I.find('$(input[name=name])').value('Still here');
    await I.click('Save');await I.find('$([role=status])').text('Saved Still here · 1');
  },{timeout:2500});`
    });
    let session = fixture.run(['--ui']);
    let { url } = await session.waitForEvent('ready');
    let capture = await session.waitForEvent('capture');
    let stream = await fetch(url + 'stream?run=' + capture.runId, { signal: t.signal });
    let reader = stream.body.getReader();
    let text = '';
    while (!text.includes('"phase":"debugging"')) text += new TextDecoder().decode((await reader.read()).value);
    // An external server holds the inspection until its own explicit deadline. This exceeds the test budget without a sleep.
    await fetch(new URL('/held-app', url), { signal: AbortSignal.timeout(4000) }).catch((error) =>
      assert.equal(error.name, 'TimeoutError')
    );
    let runs = await (await fetch(url + 'results')).json();
    assert.equal(runs[0].outcomes.length, 0);
    let response = await fetch(url + 'control', {
      method: 'POST',
      body: JSON.stringify({ runId: capture.runId, command: 'continue' })
    });
    assert.equal(response.status, 200);
    let result = await session.waitForEvent('complete');
    assert.equal(result.passed, 1, JSON.stringify(await (await fetch(url + 'results')).json()));
    await reader.cancel();
  }
);

test('headless debug pause fails clearly and cleanup still runs', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `afterEach(async({app})=>{await app.request('/api/lifecycle',{method:'POST',body:'cleaned'});});test('accidental pause',async({app})=>{await app.pause();});test('recovery',async({app,I})=>{let log=await(await app.request('/api/lifecycle')).json();await I.assert(()=>log[0]==='cleaned');});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.passed, 1);
  assert.match(result.events.find((event) => event.type === 'test').error.message, /requires --ui or --manual/);
});

test(
  'watch queues the latest helper edits, recovers from build errors, and keeps one app server',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      files: { 'helper.js': `export let label='original';` },
      source: `
  import {label} from '../../helper.js';
  test('watched workflow',async({app,I})=>{
    if(label==='original')await app.goto('/held-app');else await app.goto('/');
    await I.find('Fixture app').visible();
    await app.request('/api/lifecycle',{method:'POST',body:label});
  });`
    });
    let session = fixture.run(['--watch']);
    let { url } = await session.waitForEvent('ready');
    await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
    let first = await session.waitForEvent('capture');
    await writeFile(join(fixture.directory, 'helper.js'), `export let label='middle';`);
    let queued = await session.waitForEvent('watch', (event) => event.status === 'queued');
    await writeFile(join(fixture.directory, 'helper.js'), `export let label='latest';`);
    await session.waitForEvent('watch', (event) => event.status === 'queued' && event.revision > queued.revision);
    await fetch(new URL('/api/release-navigation', url), { method: 'POST' });
    let second = await session.waitForEvent('complete', (event) => event.runId !== first.runId);
    assert.deepEqual(await (await fetch(new URL('/api/lifecycle', url))).json(), ['original', 'latest']);
    await writeFile(join(fixture.directory, 'helper.js'), 'broken syntax {{');
    await session.waitForEvent('watch', (event) => event.status === 'error');
    await writeFile(join(fixture.directory, 'helper.js'), `export let label='fixed';`);
    await session.waitForEvent('complete', (event) => ![first.runId, second.runId].includes(event.runId));
    assert.deepEqual(await (await fetch(new URL('/api/lifecycle', url))).json(), ['original', 'latest', 'fixed']);
    session.child.kill('SIGINT');
    let stopped = await session.completion;
    assert.equal(stopped.code, 130);
    assert.equal(stopped.stderr.split('FIXTURE_READY').length - 1, 1);
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
  }
);
