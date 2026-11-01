import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';
import { openURL } from '../helpers/manual.js';
import { observeRun } from '../helpers/observer.js';
import { acceptObserverFrame } from '../../src/browser/reporting.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let visible = { browser: { name: browser, args: [['firefox', 'webkit'].includes(browser) ? '--headless' : '--headless=new'] } };

test('stopping watch during a rebuild releases the app without reporting a cancelled build as an error', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual', '--watch']);
  await session.waitForEvent('ready');
  let file = join(fixture.directory, 'tests/browser/workflow.test.js');
  await writeFile(file, `describe('Workflow', () => {
test('updated workflow', async ({app,I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });
});`);
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
  describe('Workflow', () => {
test('inspect midway',async({app,I})=>{
    await app.goto('/'); await I.type('Still here').into('$(input[name=name])');
    await app.pause('Inspect this contact');
    await I.find('$(input[name=name])').value('Still here');
    await I.click('Save');await I.find('$([role=status])').text('Saved Still here · 1');
  });
});`
    });
    let session = fixture.run(['--ui']);
    let { url } = await session.waitForEvent('ready');
    let capture = await session.waitForEvent('capture');
    let stream = await fetch(url + 'stream?run=' + capture.runId, { signal: t.signal });
    let reader = stream.body.getReader();
    let debugging = Promise.withResolvers();
    let hostStatuses = [];
    let snapshots = [];
    let latestSnapshot;
    let observed;
    let streamError;
    let closing = false;
    let observingSince = performance.now();
    let observe = (async () => {
      let text = '';
      let decoder = new TextDecoder();
      while (true) {
        let chunk = await reader.read();
        if (chunk.done) {
          if (!closing) throw new Error('Reporter event stream closed.');
          return;
        }
        text += decoder.decode(chunk.value, { stream: true });
        let boundary;
        while ((boundary = text.indexOf('\n\n')) !== -1) {
          let lines = text.slice(0, boundary).split('\n');
          text = text.slice(boundary + 2);
          let kind = lines.find(line => line.startsWith('event: '))?.slice(7);
          let data = lines.filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
          if (!data) continue;
          let value = JSON.parse(data);
          let elapsed = performance.now() - observingSince;
          if (kind === 'host-status') hostStatuses.push({ elapsed, ...value });
          if (['view-start', 'view-tests', 'snapshot', 'view-change'].includes(kind)) {
            observed = acceptObserverFrame(observed, kind, value);
            if (observed.pending) continue;
            latestSnapshot = observed.view;
            snapshots.push({ elapsed, phase: latestSnapshot.phase, current: latestSnapshot.current, error: latestSnapshot.error });
            if (latestSnapshot.phase === 'debugging') debugging.resolve();
          }
        }
      }
    })().catch(error => {
      streamError = error.message;
      debugging.reject(error);
    });
    t.after(async () => {
      closing = true;
      await reader.cancel();
      await observe;
    });
    let diagnostics = (run, responseBody) => JSON.stringify({ run, latestSnapshot, snapshots, hostStatuses, streamError, responseBody,
      transport: session.events.filter(event => ['browser-connection', 'browser-diagnostic'].includes(event.type)) });
    let completedBeforePause = async () => {
      await session.waitForEvent('complete');
      throw new Error(`Run completed before pausing: ${JSON.stringify(await (await fetch(url + 'results')).json())}`);
    };
    await Promise.race([debugging.promise, completedBeforePause()]);
    // An external server holds the inspection until its own explicit deadline. This exceeds the test budget without a sleep.
    await fetch(new URL('/held-app', url), { signal: AbortSignal.timeout(11000) }).catch((error) =>
      assert.equal(error.name, 'TimeoutError')
    );
    let runs = await (await fetch(url + 'results')).json();
    let run = runs.find(run => run.runId === capture.runId);
    assert.ok(run, diagnostics(run));
    assert.equal(run.status, 'running', diagnostics(run));
    assert.equal(latestSnapshot?.phase, 'debugging', diagnostics(run));
    assert.equal(streamError, undefined, diagnostics(run));
    assert.equal(run.outcomes.length, 0, diagnostics(run));
    let connected = hostStatuses.findIndex(status => status.connected);
    assert.ok(connected >= 0, diagnostics(run));
    assert.equal(hostStatuses.slice(connected).some(status => !status.connected), false, diagnostics(run));
    let response = await fetch(url + 'control', {
      method: 'POST',
      body: JSON.stringify({ runId: capture.runId, command: 'continue' })
    });
    let responseBody = await response.text();
    assert.equal(response.status, 200, diagnostics(run, responseBody));
    let result = await session.waitForEvent('complete');
    assert.equal(result.passed, 1, JSON.stringify(await (await fetch(url + 'results')).json()));
  }
);

test('headless debug pause fails clearly and cleanup still runs', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `describe('Workflow', () => {
afterEach(async({app})=>{await app.request('/api/lifecycle',{method:'POST',body:'cleaned'});});test('accidental pause',async({app})=>{await app.pause();});test('recovery',async({app,I})=>{let log=await(await app.request('/api/lifecycle')).json();await I.assert(()=>log[0]==='cleaned');});
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.passed, 1);
  assert.match(result.events.find((event) => event.type === 'test').error.message, /requires --ui or --manual/);
});

test('a URL-only paused test keeps its controller connection through real garbage collection', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `describe('Controller lifetime',()=>{test('continues the same contact',async({app,I})=>{
      await app.goto('/');await I.find('Name').then.fill('Retained contact');
      await app.pause('Inspect before saving');
      await I.find('Name').value('Retained contact');await I.click('Save');
      await I.find('$([role=status])').text('Saved Retained contact · 1');
    });});`,
  });
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let page = await openURL(t, url);
  let { runId } = await session.waitForEvent('capture');
  let observer = await observeRun(t, url + 'stream?run=' + runId);
  await observer.until(view => view.phase === 'debugging');
  let companion = page.context().pages().find(candidate => new URL(candidate.url()).pathname === '/__dyno__/controller');
  assert.ok(companion, 'Expected the actual companion window.');
  // Collect the real browser heap; no driver commands interact with the app.
  await companion.requestGC();
  let response = await fetch(url + 'control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, command: 'continue' }), signal: t.signal,
  });
  assert.equal(response.status, 200, await response.text());
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 1);
  assert.equal(complete.failed, 0);
});

test(
  'watch queues the latest helper edits, recovers from build errors, and keeps one app server',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      files: { 'helper.js': `export let label='original';` },
      source: `
  import {label} from '../../helper.js';
  describe('Workflow', () => {
test('watched workflow',async({app,I})=>{
    if(label==='original')await app.goto('/held-app');else await app.goto('/');
    await I.find('Fixture app').visible();
    await app.request('/api/lifecycle',{method:'POST',body:label});
  });
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
