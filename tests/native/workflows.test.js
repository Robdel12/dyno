import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { project, repository, reportPayload, claimAssignment } from '../helpers/project.js';

let browserName = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let chromiumOnly = browserName === 'chromium';
let managedOptions = { timeout: 90000 };
let config = {
  host: 'localhost',
  browser: { name: browserName },
  viewport: { width: 800, height: 600 },
  webServer: {
    command: [process.execPath, join(repository, 'tests/fixtures/native-app-server.js')],
    ready: 'NATIVE_FIXTURE_READY',
  },
};

function passed(result, count) {
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, count, result.stdout + result.stderr);
  assert.equal(result.summary?.failed, 0, result.stdout + result.stderr);
}

test(
  'native input preserves browser defaults, CSS hover, full documents, and tall element pixels',
  managedOptions,
  async (t) => {
    let fixture = await project(t, {
      config,
      source: `
describe('Native browser workflows', () => {
test('uses real input and captures an offscreen element without resizing the app', async ({app, I}) => {
  await app.goto('/');
  await I.assert(() => Object.isFrozen(app.native.capabilities) && Object.isFrozen(app.native.capabilities.permissions));
  await I.assert(() => app.native.capabilities.keyboard && app.native.capabilities.pointer);
  await I.find('Name').then.focus();
  await I.nativePress('Tab');
  await I.find('Notes').focused();
  await I.find('Save note').then.focus();
  await app.native.press('Space');
  await I.find('$(#saved)').text('Saved Robert');
  let records = await (await app.request('/api/records')).json();
  await I.assert(() => records.length === 1 && records[0].name === 'Robert');
  await I.find('$(#hover)').then.nativeHover();
  await I.assert(() => app.window.getComputedStyle(app.document.querySelector('#hover')).backgroundColor === 'rgb(20, 160, 80)');
  await I.nativeMove({x:0,y:0});
  await I.assert(() => app.window.getComputedStyle(app.document.querySelector('#hover')).backgroundColor === 'rgb(20, 60, 140)');
  await I.assert(
    () => app.window.innerWidth === 800 && app.window.innerHeight === 600,
    () => 'App did not reach the configured viewport: ' + JSON.stringify({actual:app.window.viewportSnapshot(),events:app.window.viewportChanges})
  );
  let dimensions = {width:app.window.innerWidth,height:app.window.innerHeight};
  let setupViewport = {snapshot:app.window.viewportSnapshot(),events:[...app.window.viewportChanges]};
  app.window.viewportChanges.length = 0;
  app.window.viewportObservationStage = 'find-capture-target';
  let element = await I.find('$(#tall)');
  let beforeCapture = app.window.viewportSnapshot();
  app.window.viewportObservationStage = 'capture';
  let image = await app.screenshot('Tall element', {element});
  let captureReturned = app.window.viewportSnapshot();
  app.window.viewportObservationStage = 'capture-returned';
  await new Promise(resolve => app.window.requestAnimationFrame(() => app.window.requestAnimationFrame(resolve)));
  await I.assert(() => image.status === 'captured' && image.width === 160 * image.pixelRatio && image.height === 1500 * image.pixelRatio);
  await I.assert(
    () => app.window.innerWidth === dimensions.width && app.window.innerHeight === dimensions.height && app.window.viewportChanges.every(change => change.width === dimensions.width && change.height === dimensions.height),
    () => 'Element capture changed the app viewport: ' + JSON.stringify({expected:dimensions,setup:setupViewport,beforeCapture,captureReturned,actual:app.window.viewportSnapshot(),events:app.window.viewportChanges,image:{width:image.width,height:image.height,pixelRatio:image.pixelRatio,viewport:image.viewport}})
  );
  app.window.viewportObservationStage = 'capture-verified';
  await I.find('Open destination').then.focus().then.nativePress('Enter');
  await I.find('Destination ready').visible();
  let stale;
  try { await app.native.hover(element); } catch (error) { stale = error; }
  await I.assert(() => stale && /document|stale|detached|connected|current/i.test(stale.message), 'Native input accepted an element from the old document');
  await I.find('Destination ready').visible();
});
});`,
    });
    let result = await fixture.run().completion;
    passed(result, 1);
    let attachment = result.events.find((event) => event.type === 'attachment')?.attachment;
    assert.ok(attachment, result.stdout + result.stderr);
    let image = PNG.sync.read(await readFile(attachment.path));
    let ratio = attachment.pixelRatio;
    assert.equal(image.width, 160 * ratio);
    assert.equal(image.height, 1500 * ratio);
    let pixel = (y) => {
      let offset = (Math.round(y * ratio) * image.width + Math.round(10 * ratio)) * 4;
      return [...image.data.subarray(offset, offset + 4)];
    };
    assert.deepEqual(pixel(10), [180, 40, 90, 255]);
    assert.deepEqual(pixel(600), [20, 160, 80, 255]);
    assert.deepEqual(pixel(1200), [20, 60, 140, 255]);
    let entries = result.events
      .filter((event) => event.type === 'test')
      .flatMap((event) => event.timings?.entries ?? []);
    assert.ok(
      entries.some((entry) => entry.kind === 'native' && entry.status === 'passed'),
      result.stdout + result.stderr,
    );
    assert.ok(entries.some((entry) => entry.kind === 'screenshot' && entry.status === 'passed'));
    let saved = result.events.find((event) => event.type === 'report-saved');
    let report = JSON.parse(await readFile(saved.json, 'utf8'));
    assert.ok(
      report.tests[0].timings.entries.some(
        (entry) => entry.kind === 'native' && entry.status === 'passed',
      ),
    );
  },
);

test(
  'native media changes are observable and reset before the next test',
  managedOptions,
  async (t) => {
    let fixture = await project(t, {
      config: {
        ...config,
        browser: {
          ...config.browser,
          locale: 'fr-FR',
          timezoneId: 'Europe/Paris',
          ...(chromiumOnly ? { args: ['--force-prefers-reduced-motion=reduce'] } : {}),
        },
      },
      source: `
describe('Native media cleanup', () => {
test('changes the app media query', async ({app, I}) => {
  await app.goto('/');
  await I.assert(() => app.window.navigator.language === 'fr-FR' && new app.window.Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Paris');
  await I.assert(() => app.native.capabilities.media);
  let original = app.window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await app.request('/api/media-preference', {method:'POST',body:JSON.stringify({reduced:original})});
  await app.native.setReducedMotion(original ? 'no-preference' : 'reduce');
  await I.assert(() => app.window.matchMedia('(prefers-reduced-motion: reduce)').matches !== original);
});
test('restores the browser media setting automatically', async ({app, I}) => {
  await app.goto('/');
  let original = await (await app.request('/api/media-preference')).json();
  await I.assert(() => app.window.matchMedia('(prefers-reduced-motion: reduce)').matches === original.reduced);
});
});`,
    });
    passed(await fixture.run().completion, 2);
  },
);

test('Chromium native clipboard, credentials, and app offline keep reporting usable and clean up', {
  ...managedOptions,
  skip:
    !chromiumOnly &&
    'Chromium-only clipboard, virtual authenticator, and page offline capabilities',
}, async (t) => {
  let fixture = await project(t, {
    config,
    source: `
describe('Chromium native browser features', () => {
test('copies a token and creates a usable resident credential', async ({app, I}) => {
  await app.goto('/');
  await I.assert(() => app.native.capabilities.authenticator && app.native.capabilities.offline && app.native.capabilities.permissions.includes('clipboard-read') && app.native.capabilities.permissions.includes('clipboard-write'));
  await app.native.grantPermissions(['clipboard-read','clipboard-write']);
  await I.find('Copy token').then.focus().then.nativePress('Space');
  await I.find('$(#copied)').text('Copied');
  let copied = await app.window.navigator.clipboard.readText();
  await I.assert(() => copied === 'Dyno native token');
  await app.native.enableVirtualAuthenticator();
  let navigator = app.window.navigator;
  let challenge = () => app.window.crypto.getRandomValues(new Uint8Array(32));
  let credential = await navigator.credentials.create({publicKey:{challenge:challenge(),rp:{id:app.window.location.hostname,name:'Dyno native fixture'},user:{id:new Uint8Array([1,2,3]),name:'robert@example.test',displayName:'Robert'},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required',userVerification:'required'},attestation:'none'}});
  let assertion = await navigator.credentials.get({publicKey:{challenge:challenge(),rpId:app.window.location.hostname,userVerification:'required',allowCredentials:[{type:'public-key',id:credential.rawId}]}});
  await I.assert(() => assertion.id === credential.id && assertion.response.signature.byteLength > 0);
});
test('takes only the app network offline', async ({app, I}) => {
  await app.goto('/');
  let permission = await app.window.navigator.permissions.query({name:'clipboard-read'});
  await I.assert(() => permission.state !== 'granted', 'The previous test leaked its clipboard permission');
  await app.native.enableVirtualAuthenticator();
  await app.native.disableVirtualAuthenticator();
  let before = await (await app.request('/api/status')).json();
  await app.native.setOffline(true);
  await I.click('Load status');
  await I.find('$(#network)').text('Offline');
  let controllerResponse = await app.request('/api/status');
  let after = await controllerResponse.json();
  await I.assert(() => controllerResponse.ok && after.revision === before.revision + 1);
  await I.assert(() => app.window.navigator.onLine === false);
});
test('restores app network access before loading the next document', async ({app, I}) => {
  await app.goto('/');
  let response = await app.window.fetch('/api/status?probe=' + app.window.crypto.randomUUID(), {cache:'no-store'});
  await I.assert(() => response.ok && app.window.navigator.onLine);
  await I.click('Load status');
  await I.assert(() => app.document.querySelector('#network').textContent.startsWith('Connected '));
});
});`,
  });
  passed(await fixture.run().completion, 3);
});

test('manual runs cannot invoke native input or borrow another run', {
  timeout: 15000,
}, async (t) => {
  let fixture = await project(t, { config });
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let join = () => fetch(url + 'capture', { method: 'POST' }).then((response) => response.json());
  let first = await join();
  let second = await join();
  assert.deepEqual(first.capabilities.native, {
    keyboard: false,
    pointer: false,
    permissions: [],
    authenticator: false,
    offline: false,
    media: false,
    dialogs: false,
    diagnostics: false,
  });
  let context = {
    executionId: 'manual-execution',
    documentId: 'manual-document',
    revision: 0,
    width: 800,
    height: 600,
  };
  let post = (route, body) =>
    fetch(url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await post('events', { ...first, ...reportPayload({ type: 'start', tests: ['manual native'] }) })).status, 200);
  let assignment = await claimAssignment(url, first, 'manual-native');
  context.executionId = assignment.id;
  assert.equal(
    (await post('context', { runId: first.runId, connectionKey: first.connectionKey, context }))
      .status,
    200,
  );
  let native = {
    runId: first.runId,
    connectionKey: first.connectionKey,
    operation: 'native',
    requestId: 'manual-native-input',
    context,
    input: { kind: 'key', key: 'Tab' },
  };
  let unsupported = await post('operations', native);
  assert.equal(unsupported.status, 422);
  assert.match(await unsupported.text(), /native|managed|unavailable|owned|provider/i);
  let borrowed = await post('operations', {
    ...native,
    connectionKey: second.connectionKey,
    requestId: 'borrowed-native-input',
  });
  assert.equal(borrowed.status, 403);
});

test(
  'scoped dialogs exercise actual confirmation and preserve callback results and browser diagnostics',
  managedOptions,
  async (t) => {
    let fixture = await project(t, {
      config,
      source: `
describe('Native confirmation', () => {
  test('removes a saved note only after accepting the real dialog', async ({app,I}) => {
    await app.goto('/');
    await I.click('Save note');
    await I.find('$(#saved)').text('Saved Robert');
    let before = await app.native.consoleMessages();
    let checkpoint = before.at(-1)?.id ?? 0;
    app.window.console.warn('Native diagnostic fixture');
    let value = await app.native.withDialog({action:'accept',message:'Remove saved note?'}, async () => {
      await I.click('Remove saved note');
      await I.find('$(#removed)').text('Removed');
      return 'confirmed';
    });
    await I.assert(() => value === 'confirmed');
    let records = await (await app.request('/api/records')).json();
    await I.assert(() => records.length === 0);
    let messages = await app.native.consoleMessages();
    await I.assert(() => messages.some(message => message.id > checkpoint && message.type === 'warning' && message.text === 'Native diagnostic fixture'));
    await app.screenshot('Private section', {fullPage:true,mask:[await I.find('$(#secret)')],maskColor:'#11151b'});
  });
});`,
    });
    let result = await fixture.run().completion;
    passed(result, 1);
    let attachment = result.events.find((event) => event.type === 'attachment')?.attachment;
    let image = PNG.sync.read(await readFile(attachment.path));
    let offset = (410 * image.width + 610) * 4;
    assert.deepEqual([...image.data.subarray(offset, offset + 4)], [17, 21, 27, 255]);
  },
);

test(
  'unfinished dialog work fails and releases queued native input before the next test',
  managedOptions,
  async (t) => {
    let fixture = await project(t, {
      config,
      source: `
describe('Cancelled native input', () => {
  test('forgets to await a dialog', async ({app,I}) => {
    await app.goto('/');
    let armed = Promise.withResolvers();
    void app.native.withDialog({action:'accept'}, () => armed.resolve()).catch(() => {});
    await armed.promise;
  });
  test('forgets to await queued input', async ({app,I}) => {
    await app.goto('/');
    await I.find('Save note').then.focus();
    let claimed = new Promise(resolve => {
      if (parent.navigator.serviceWorker.controller) resolve();
      else parent.navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    });
    await app.window.navigator.serviceWorker.register('/native-cancellation-gate.js');
    await app.window.navigator.serviceWorker.ready;
    await claimed;
    void app.native.press('Space').catch(() => {});
    await app.request('/api/native-queued');
  });
  test('still has no saved note and can use native input', async ({app,I}) => {
    await app.goto('/');
    let cancelled = await (await app.request('/api/native-cancelled')).json();
    await I.assert(() => cancelled.status === 409, 'Stale queued input must be rejected before dispatch');
    let records = await (await app.request('/api/records')).json();
    await I.assert(() => records.length === 0, 'Cancelled queued input saved a note');
    await I.find('Name').then.focus();
    await I.nativePress('Tab');
    await I.find('Notes').focused();
  });
});`,
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(result.summary?.failed, 2, result.stdout + result.stderr);
    assert.equal(result.summary?.passed, 1, result.stdout + result.stderr);
    assert.match(
      result.events.find((event) => event.type === 'test').error.message,
      /Await.*native/,
    );
    for (let event of result.events.filter(event => event.type === 'test' && event.status === 'failed'))
      assert.match(event.error.message, /Await.*native/);
  },
);
