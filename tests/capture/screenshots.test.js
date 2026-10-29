import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { project, exec } from '../helpers/project.js';

let provider = process.env.DYNO_CAPTURE_PROVIDER ?? 'playwright';
let name = process.env.DYNO_CAPTURE_BROWSER ?? 'chrome';
let managedOptions = {
  timeout: 90000
};
let browser = { name, provider, ...(process.env.DYNO_CAPTURE_PATH ? { path: process.env.DYNO_CAPTURE_PATH } : {}) };

test('managed capture saves real app pixels after local actions and responsive resize', managedOptions, async (t) => {
  let fixture = await project(t, {
    config: { browser, viewport: { width: 800, height: 600 } },
    source: `
test('saves the actual app', async ({ app, I }) => {
  await app.goto('/visual');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
  let original = app.document;
  let image = await app.screenshot('saved contact');
  await I.assert(() => image.status === 'captured' && image.viewport.width === 800);
  await app.setViewport({ width: 390, height: 844 });
  await I.assert(
    () =>
      app.window.innerWidth === 390 &&
      app.window.innerHeight === 844 &&
      app.window.matchMedia('(max-width:500px)').matches
  );
  await I.assert(() => app.document === original, 'Resize replaced the app');
  await I.find('$([role=status])').text('Saved Robert · 1');
  await app.screenshot('narrow contact');
});
test('starts the next test with configured dimensions', async ({ app, I }) => {
  await app.goto('/visual');
  await I.assert(() => app.window.innerWidth === 800 && app.window.innerHeight === 600);
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 2);
  let attachments = result.events.filter((event) => event.type === 'attachment').map((event) => event.attachment);
  assert.equal(attachments.length, 2);
  for (let [index, attachment] of attachments.entries()) {
    let image = PNG.sync.read(await readFile(attachment.path));
    let ratio = attachment.pixelRatio;
    assert.equal(image.width, (index ? 390 : 800) * ratio);
    assert.equal(image.height, (index ? 844 : 600) * ratio);
    let pixel = (x, y) => [
      ...image.data.subarray(
        (Math.round(y * ratio) * image.width + Math.round(x * ratio)) * 4,
        (Math.round(y * ratio) * image.width + Math.round(x * ratio)) * 4 + 4
      )
    ];
    assert.deepEqual(pixel(10, 10), [30, 70, 210, 255]);
    assert.deepEqual(pixel(200, 300), [20, 150, 80, 255]);
    assert.equal(attachment.browser.provider, provider);
  }
  assert.equal(result.events.find((event) => event.type === 'test').attachments.length, 2);
  assert.equal(
    (await readdir(join(fixture.directory, '.dyno/artifacts'))).some((file) => file.endsWith('.partial')),
    false
  );
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test(
  'navigation discards a real staged screenshot instead of attaching another document',
  managedOptions,
  async (t) => {
    let fixture = await project(t, {
      config: { browser },
      source: `
test('rejects capture after document navigation', async ({ app, I }) => {
  await app.goto('/visual');
  let whenControlled = (realm) =>
    realm.navigator.serviceWorker.controller
      ? Promise.resolve()
      : new Promise((resolve) =>
          realm.navigator.serviceWorker.addEventListener('controllerchange', resolve, {
            once: true
          })
        );
  let controlled = Promise.all([whenControlled(window), whenControlled(window.top)]);
  let registration = await navigator.serviceWorker.register('/capture-gate.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  await controlled;
  let capture = app.screenshot('navigation race').then(
    () => ({ accepted: true }),
    (error) => ({ error: error.message })
  );
  await app.request('/api/capture-staged');
  await app.goto('/other');
  await app.request('/api/release-capture', { method: 'POST' });
  let result = await capture;
  await I.assert(
    () => !result.accepted && /navigated|changed|stale|ended/.test(result.error),
    'A stale screenshot was accepted'
  );
  await I.find('Other page').visible();
  await registration.unregister();
});
`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(
      result.events.some((event) => event.type === 'attachment'),
      false
    );
    assert.deepEqual(await readdir(join(fixture.directory, '.dyno/artifacts')), []);
  }
);

test('an optional image still fails when a connected provider cannot save its artifact', managedOptions, async (t) => {
  let fixture = await project(t, {
    config: { browser },
    files: { '.dyno/artifacts': 'a file blocking artifact storage' },
    source: `
test('does not hide a storage failure', async ({ app }) => {
  await app.goto('/visual');
  await app.screenshot('cannot save', { optional: true });
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.summary?.failed, 1);
  assert.match(result.events.find((event) => event.type === 'test').error.message, /EEXIST|ENOTDIR/);
  assert.equal(
    result.events.some((event) => event.type === 'attachment'),
    false
  );
});

test('an ordinary join cannot borrow the managed browser or determine its CLI result', managedOptions, async (t) => {
  let fixture = await project(t, {
    config: { browser },
    source: `
test('keeps managed capture bound to this browser', async ({ app, I }) => {
  await app.goto('/visual');
  let joined = await (await app.request('/__dyno__/capture', { method: 'POST' })).json();
  await I.assert(() => joined.capabilities.screenshot === false);
  let runId = new URLSearchParams(location.search).get('run');
  let borrowed = await app.request('/__dyno__/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      connectionKey: joined.connectionKey,
      operation: 'screenshot',
      name: 'borrowed'
    })
  });
  await I.assert(() => borrowed.status === 403, 'Manual browser borrowed another run');
  let forged = await app.request('/__dyno__/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      connectionKey: joined.connectionKey,
      type: 'fatal',
      error: { message: 'forged result' }
    })
  });
  await I.assert(() => forged.status === 403, 'A manual join changed the managed result');
  await app.request('/__dyno__/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: joined.runId,
      connectionKey: joined.connectionKey,
      type: 'start',
      tests: [{ id: JSON.stringify(['manual', 'manual companion']), name: 'manual companion', file: 'manual', suites: [], index: 0, skipReason: null }]
    })
  });
  await app.request('/__dyno__/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: joined.runId,
      connectionKey: joined.connectionKey,
      type: 'test',
      index: 0,
      name: 'manual companion',
      testId: JSON.stringify(['manual', 'manual companion']),
      status: 'passed'
    })
  });
  await app.request('/__dyno__/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: joined.runId,
      connectionKey: joined.connectionKey,
      type: 'complete'
    })
  });
  await app.screenshot('owned image');
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let completions = result.events.filter((event) => event.type === 'complete');
  assert.equal(completions.length, 2);
  assert.equal(result.events.filter((event) => event.type === 'attachment').length, 1);
  assert.equal(
    result.events.findLast((event) => event.type === 'test').name,
    'keeps managed capture bound to this browser'
  );
  assert.ok(result.events.every((event) => !('connectionKey' in event)));
});

test(
  'managed Playwright capture records actual device pixels at DPR 2',
  { ...managedOptions, skip: managedOptions.skip || provider !== 'playwright' },
  async (t) => {
    let fixture = await project(t, {
      config: { browser: { ...browser, deviceScaleFactor: 2 }, viewport: { width: 320, height: 240 } },
      source: `
test('captures device pixels', async ({ app }) => {
  await app.goto('/visual');
  await app.screenshot('retina viewport');
});
`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let attachment = result.events.find((event) => event.type === 'attachment').attachment;
    let image = PNG.sync.read(await readFile(attachment.path));
    assert.equal(image.width, 640);
    assert.equal(image.height, 480);
    assert.equal(attachment.pixelRatio, 2);
  }
);

test(
  'a managed provider process crash fails clearly and releases owned resources',
  { ...managedOptions, skip: managedOptions.skip || process.platform === 'win32' },
  async (t) => {
    let fixture = await project(t, {
      config: { browser },
      source: `
test('waits for a provider failure', async ({ app }) => {
  await app.goto('/');
  await new Promise(() => {});
});
`
    });
    let session = fixture.run();
    await session.waitForEvent('start');
    let { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,command=']);
    let worker = stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .find(
        ([pid, parent, ...command]) =>
          Number(parent) === session.child.pid && command.join(' ').endsWith('/src/providers/worker.js')
      );
    assert.ok(worker, 'Expected an owned provider worker');
    process.kill(Number(worker[0]), 'SIGKILL');
    let result = await session.completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /disconnected/);
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
    let profiles = await readdir(tmpdir());
    assert.equal(
      profiles.some((name) => name.startsWith(`dyno-${provider}-${session.child.pid}-`)),
      false,
      'Provider profile survived crash cleanup'
    );
  }
);

test('interrupting after persistence removes an unacknowledged image and owned profile', managedOptions, async (t) => {
  let fixture = await project(t, {
    config: { browser },
    source: `
test('waits for capture acknowledgement', async ({ app }) => {
  await app.goto('/visual');
  let controlled = new Promise((resolve) =>
    window.top.navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
  );
  await navigator.serviceWorker.register('/capture-gate.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!window.top.navigator.serviceWorker.controller) await controlled;
  await app.screenshot('interrupt committed image');
});
`
  });
  let session = fixture.run();
  let { url } = await session.waitForEvent('ready');
  await fetch(new URL('/api/capture-committed', url), { signal: t.signal });
  session.child.kill('SIGTERM');
  let result = await session.completion;
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.equal(
    result.events.some((event) => event.type === 'attachment'),
    false
  );
  assert.deepEqual(await readdir(join(fixture.directory, '.dyno/artifacts')), []);
  assert.equal(
    (await readdir(tmpdir())).some((name) => name.startsWith(`dyno-${provider}-${session.child.pid}-`)),
    false
  );
});

test('a host resize cannot turn stale pixels into a different device pixel ratio', managedOptions, async (t) => {
  let fixture = await project(t, {
    config: { browser, viewport: { width: 800, height: 600 } },
    source: `
test('rejects a changed capture surface', async ({ app, I }) => {
  await app.goto('/visual');
  let whenControlled = (realm) =>
    realm.navigator.serviceWorker.controller
      ? Promise.resolve()
      : new Promise((resolve) =>
          realm.navigator.serviceWorker.addEventListener('controllerchange', resolve, {
            once: true
          })
        );
  let controlled = Promise.all([whenControlled(window), whenControlled(window.top)]);
  let registration = await navigator.serviceWorker.register('/capture-gate.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  await controlled;
  let capture = app.screenshot('host resize race').then(
    () => ({ accepted: true }),
    (error) => ({ error: error.message })
  );
  await app.request('/api/capture-before');
  let host = window.top;
  let resized = new Promise((resolve) => host.addEventListener('resize', resolve, { once: true }));
  let response = await fetch('/__dyno__/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...JSON.parse(host.sessionStorage.getItem('dyno:previous')),
      operation: 'resize',
      viewport: { width: host.innerWidth * 2, height: host.innerHeight * 2 },
      current: { width: host.innerWidth, height: host.innerHeight }
    })
  });
  if (!response.ok) throw new Error(await response.text());
  await resized;
  await app.request('/api/release-capture', { method: 'POST' });
  let result = await capture;
  await I.assert(
    () => !result.accepted && /viewport|changed|stale/.test(result.error),
    'Changed capture surface was accepted'
  );
  await I.assert(() => app.window.innerWidth === 800 && app.window.innerHeight === 600);
  await registration.unregister();
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(
    result.events.some((event) => event.type === 'attachment'),
    false
  );
  await assert.rejects(readdir(join(fixture.directory, '.dyno/artifacts')), { code: 'ENOENT' });
});
