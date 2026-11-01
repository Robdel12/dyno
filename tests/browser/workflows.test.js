import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { project, exec, repository, reportPayload, claimAssignment } from '../helpers/project.js';

function outcomes(result, passed, failed) {
  assert.equal(result.code, failed ? 1 : 0, result.stderr + result.stdout);
  assert.equal(result.summary?.passed, passed, result.stderr + result.stdout);
  assert.equal(result.summary?.failed, failed, result.stderr + result.stdout);
}

test('init refuses existing files without leaving a partial scaffold', async (t) => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-existing-project-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'tests/browser'), { recursive: true });
  let existing = join(directory, 'tests/browser/home.test.js');
  await writeFile(existing, 'existing user test');
  await assert.rejects(
    exec(process.execPath, [join(repository, 'bin/dyno.js'), 'init'], { cwd: directory }),
    /Refusing to overwrite tests\/browser\/home.test.js/
  );
  assert.equal(await readFile(existing, 'utf8'), 'existing user test');
  await assert.rejects(readFile(join(directory, 'dyno.config.js')), { code: 'ENOENT' });
});

test(
  'invalid config and empty discovery explain the problem before starting the app',
  { timeout: 15000 },
  async (t) => {
    for (let config of [{ port: 'wrong' }, { testMatch: '**/missing.test.js' }]) {
      let fixture = await project(t, { config });
      let result = await fixture.run().completion;
      assert.equal(result.code, 1);
      assert.match(result.stderr, /port must be|No browser tests found/);
      assert.equal(
        result.events.some((event) => event.type === 'ready'),
        false
      );
      await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
    }
  }
);

test('hooks reset the session and still clean up after a failing assertion', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
describe('Workflow', () => {
beforeEach(async ({app}) => { await app.request('/api/lifecycle', {method:'POST', body:'before'}); });
afterEach(async ({app}) => { await app.request('/api/lifecycle', {method:'POST', body:'after'}); });
test('fails after recording work', async ({app, I}) => {
  await app.goto('/'); await app.request('/api/lifecycle', {method:'POST', body:'body'});
  await I.find('$([role=status])').text('Missing result');
});
test('observes cleanup before the next workflow', async ({app, I}) => {
  await app.goto('/');
  let log = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => log.join(',') === 'before,body,after,before', 'Expected ordered hook cleanup');
});
});`
  });
  outcomes(await fixture.run().completion, 1, 1);
});

test('fresh frames retain origin storage until the project explicitly resets it', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
describe('Workflow', () => {
test('stores a session', async ({app, I}) => {
  await app.goto('/'); app.window.localStorage.setItem('session', 'saved');
  await I.type('Robert').into('$(input[name=name])'); await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
});
test('sees the session and resets it explicitly', async ({app, I}) => {
  await app.goto('/');
  await I.assert(() => app.window.localStorage.getItem('session') === 'saved');
  let cookie = await (await app.request('/api/cookie')).json();
  await I.assert(() => cookie.cookie.includes('saved=yes'));
  app.window.localStorage.clear(); await app.request('/api/logout', {method:'POST'});
});
test('starts without the reset session', async ({app, I}) => {
  await app.goto('/'); await I.assert(() => app.window.localStorage.getItem('session') === null);
  let cookie = await (await app.request('/api/cookie')).json();
  await I.assert(() => !cookie.cookie.includes('saved=yes'));
});
});`
  });
  outcomes(await fixture.run().completion, 3, 0);
});

test(
  'the app CSP permits a nonced bridge and a blocked bridge fails without weakening the policy',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `
describe('Workflow', () => {
test('runs under the real nonce policy', async ({app, I}) => { await app.goto('/nonce-app'); await I.find('Nonce app ready').visible(); });
test('cannot bypass blocked scripts', async ({app}) => { await app.goto('/blocked-app'); }, {timeout:600});
test('recovers after blocked startup', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });
});`
    });
    let result = await fixture.run().completion;
    outcomes(result, 2, 1);
    assert.match(
      result.events.find((event) => event.name === 'cannot bypass blocked scripts').error.message,
      /blocked scripts/
    );
  }
);

test(
  'manual browsers have independent runs and malformed or stale reports cannot change the results',
  { timeout: 15000 },
  async (t) => {
    let fixture = await project(t, { config: { browser: { path: '/missing/browser' } } });
    let session = fixture.run(['--manual']);
    let { url } = await session.waitForEvent('ready');
    let capture = async () => (await fetch(url + 'capture', { method: 'POST' })).json();
    let first = await capture();
    let second = await capture();
    assert.notEqual(first.runId, second.runId);
    let assignments = new Map();
    let post = (runId, event) =>
      fetch(url + 'events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          connectionKey: [first, second].find((run) => run.runId === runId)?.connectionKey,
          ...(event.type === 'test' ? { executionId: assignments.get(runId) } : {}),
          ...reportPayload(event)
        })
      });
    assert.equal(
      (await fetch(url + 'capture', { method: 'POST', headers: { Origin: 'https://foreign.example' } })).status,
      400
    );
    assert.equal((await post(first.runId, { type: 'start', tests: ['first'] })).status, 200);
    assert.equal((await post(second.runId, { type: 'start', tests: ['second'] })).status, 200);
    for (let owner of [first, second]) assignments.set(owner.runId, (await claimAssignment(url, owner, 'case')).id);
    for (let event of [
      { type: 'complete' },
      { type: 'test', index: 1, name: 'first', status: 'passed' },
      { type: 'test', index: 0, name: 'wrong name', status: 'passed' },
      { type: 'test', index: 0, name: 'first', status: 'failed' },
      { type: 'test', index: 0, name: 'first', status: 'passed', duration: -1 }
    ])
      assert.equal((await post(first.runId, event)).status, 400);
    let before = await (await fetch(url + 'results')).json();
    assert.deepEqual(
      before.map((run) => run.outcomes),
      [[], []]
    );
    assert.equal((await post(second.runId, { type: 'test', index: 0, name: 'second', status: 'passed' })).status, 200);
    assert.equal((await post(second.runId, { type: 'test', index: 1, status: 'passed' })).status, 400);
    assert.equal((await post(second.runId, { type: 'complete', passed: 99, failed: 99 })).status, 200);
    assert.equal(
      (
        await post(first.runId, {
          type: 'test',
          index: 0,
          name: 'first',
          status: 'failed',
          error: { message: 'Expected failure' }
        })
      ).status,
      200
    );
    assert.equal((await post(first.runId, { type: 'complete' })).status, 200);
    assert.equal((await post(second.runId, { type: 'fatal', error: { message: 'late' } })).status, 400);
    let results = await (await fetch(url + 'results')).json();
    assert.deepEqual(
      results.map((run) => [run.summary.passed, run.summary.failed]),
      [
        [0, 1],
        [1, 0]
      ]
    );
  }
);

test('an app crash fails the run and releases the owned server port', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `describe('Workflow', () => {
test('app disconnects', async ({app, I}) => { await app.goto('/'); await app.request('/api/crash'); await I.assert(() => false); });
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Process exited \(9\)/);
  let saved = result.events.find((event) => event.type === 'report-saved');
  assert.match(JSON.parse(await readFile(saved.json, 'utf8')).error.message, /Process exited \(9\)/);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});
