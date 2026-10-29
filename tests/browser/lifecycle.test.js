import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';

let outcomes = (result) => result.events.filter((event) => event.type === 'test');

test(
  'keeps the original failure and every cleanup failure while later cleanup and tests recover',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
afterEach(async ({app, test}) => { await app.request('/api/lifecycle', {method:'POST', body:test.name}); });
describe('account', () => {
  afterEach(() => { throw new Error('Outer cleanup failed'); });
  describe('save', () => {
    afterEach(() => { throw new Error('Inner cleanup failed'); });
    test('original failure', () => { throw new Error('Save failed'); });
  });
});
test('next workflow', async ({app, I}) => {
  let log = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => log.join(',') === 'original failure', 'Cleanup did not reach the real API');
});`
    });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    let [failed, recovered] = outcomes(result);
    assert.equal(failed.error.message, 'Save failed');
    assert.equal(failed.error.phase, 'test');
    assert.deepEqual(
      failed.additionalErrors.map((error) => [error.phase, error.message]),
      [
        ['afterEach', 'Inner cleanup failed'],
        ['afterEach', 'Outer cleanup failed']
      ]
    );
    assert.ok(failed.error.source?.code.length);
    assert.ok(failed.additionalErrors.every((error) => error.source?.code.length));
    assert.equal(recovered.status, 'passed');
  }
);

test('only cleans entered scopes when setup fails', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
let record = (app, body) => app.request('/api/lifecycle', {method:'POST',body});
afterEach(({app}) => record(app, 'file cleanup'));
describe('parent', () => {
  beforeEach(() => { throw new Error('Setup failed'); });
  afterEach(({app}) => record(app, 'parent cleanup'));
  describe('unentered child', () => {
    afterEach(({app}) => record(app, 'wrong child cleanup'));
    test('never runs', ({app}) => record(app, 'wrong body'));
  });
});
test('recovers', async ({app,I}) => {
  let log = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => log.join(',') === 'parent cleanup,file cleanup', JSON.stringify(log));
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.summary.failed, 1, result.stdout + result.stderr);
  let [failed, recovered] = outcomes(result);
  assert.equal(failed.error.phase, 'beforeEach');
  assert.equal(recovered.status, 'passed');
});

test(
  'execution timeouts and app rejections leave cleanup APIs usable and old APIs cancelled',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
afterEach(async ({app,signal,test}) => {
  if (signal.aborted) throw new Error('Cleanup inherited the aborted test signal');
  await app.request('/api/lifecycle', {method:'POST',body:test.name});
});
test('hung', async ({app,signal}) => {
  signal.addEventListener('abort', () => { app.request('/api/lifecycle', {method:'POST',body:'wrong late request'}).catch(() => {}); });
  await new Promise(() => {});
}, {timeout:1000});
test('app rejection', async ({app,I}) => {
  await app.goto('/'); await I.click('Reject'); await I.find('Never appears').visible();
});
test('recovered', async ({app,I}) => {
  let log = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => log.join(',') === 'hung,app rejection', JSON.stringify(log));
});`
    });
    let result = await fixture.run().completion;
    assert.equal(result.summary.failed, 2, result.stdout + result.stderr);
    let [timeout, app, recovered] = outcomes(result);
    assert.equal(timeout.error.phase, 'timeout');
    assert.match(timeout.error.stack, /Declared at:/);
    assert.equal(app.error.phase, 'app');
    assert.equal(recovered.status, 'passed');
  }
);

test('bounds hung cleanup independently and continues with a fresh test', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { cleanupTimeout: 400 },
    source: `
afterEach(({test}) => test.name === 'hung cleanup' ? new Promise(() => {}) : undefined);
afterEach(async ({app,test}) => { await app.request('/api/lifecycle', {method:'POST',body:test.name}); });
test('hung cleanup', () => { throw new Error('Original failure'); });
test('recovered', async ({app,I}) => {
  let log = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => log.length === 0, 'Hook ran after cleanup deadline');
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.summary.failed, 1, result.stdout + result.stderr);
  let [failed, recovered] = outcomes(result);
  assert.equal(failed.error.message, 'Original failure');
  assert.equal(failed.additionalErrors.length, 1);
  assert.equal(failed.additionalErrors[0].phase, 'cleanup');
  assert.match(failed.additionalErrors[0].message, /Cleanup exceeded 400 ms/);
  assert.equal(recovered.status, 'passed');
});

test('reporter Stop waits for bounded browser cleanup before ending the run', { timeout: 90000 }, async (t) => {
  let name = process.env.DYNO_TEST_BROWSER ?? 'chrome';
  let fixture = await project(t, {
    config: { browser: { name, args: [name === 'firefox' ? '--headless' : '--headless=new'] } },
    source: `
afterEach(async ({app}) => { await app.request('/api/lifecycle', {method:'POST',body:'cleaned'}); });
test('held workflow', async ({app}) => {
  await app.request('/api/lifecycle', {method:'POST',body:'started'});
  await app.goto('/held-app');
});`
  });
  let session = fixture.run(['--ui']);
  let { url } = await session.waitForEvent('ready');
  await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
  let captured = await session.waitForEvent('capture');
  let response = await fetch(url + 'control', {
    method: 'POST',
    body: JSON.stringify({ runId: captured.runId, command: 'stop' })
  });
  assert.equal(response.status, 200);
  await session.waitForEvent('fatal');
  assert.deepEqual(await (await fetch(new URL('/api/lifecycle', url))).json(), ['started', 'cleaned']);
});


test('a hung body and hung cleanup keep both deadline failures', { timeout: 90000 }, async t => {
  let fixture = await project(t, {config:{cleanupTimeout:200},source:`
  afterEach(() => new Promise(() => {}));
  test('both phases hang', () => new Promise(() => {}), {timeout:500});`});
  let result = await fixture.run().completion;
  let [failed] = outcomes(result);
  assert.equal(failed.error.phase, 'timeout', result.stdout + result.stderr);
  assert.equal(failed.additionalErrors.length, 1);
  assert.equal(failed.additionalErrors[0].phase, 'cleanup');
});
