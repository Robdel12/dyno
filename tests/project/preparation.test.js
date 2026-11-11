import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { project, reportPayload } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let visible = { name: browser, args: [['firefox', 'webkit'].includes(browser) ? '--headless' : '--headless=new'] };

function setupSource({ mode = 'open', result = '{ fixtures: { executionName: context.test.name, preparedWorker: worker.id } }' } = {}) {
  return `import { createServer } from 'node:http';
    import { writeFile } from 'node:fs/promises';
    export default async function setup({config}) {
      let slowEntered = Promise.withResolvers();
      return {
        fixtures: { staticValue: 'Shared build' },
        async createWorker({worker}) {
          let events = [];
          let entered = Promise.withResolvers(), released = Promise.withResolvers();
          let aborted = Promise.withResolvers(), settled = Promise.withResolvers();
          let record = (phase, detail = {}) => events.push({phase, ...detail});
          let server = createServer(async (request, response) => {
            let path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/entered') { await entered.promise; response.end('entered'); }
            else if (path === '/aborted') { await aborted.promise; response.end('aborted'); }
            else if (path === '/settled') { await settled.promise; response.end('settled'); }
            else if (path === '/release') { record('released'); released.resolve(); response.end('released'); }
            else if (path === '/slow-entered') { await slowEntered.promise; response.end('entered'); }
            else if (path === '/state') {
              response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(events));
            } else if (path === '/hook') { record('hook'); response.end('hook'); }
            else {
              if (request.method === 'GET' && path === '/') record('document');
              response.setHeader('Content-Type', 'text/html');
              response.end('<!doctype html><h1>Prepared application</h1>');
            }
          });
          await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
          return {
            webServer: { command: undefined, reuseExistingServer: true, url: 'http://127.0.0.1:' + server.address().port },
            async beforeExecution(context) {
              let { signal } = context;
              record('preparing', {runId:context.runId, workerId:context.workerId, executionId:context.executionId, name:context.test.name});
              entered.resolve();
              if (worker.id === '0') slowEntered.resolve();
              try {
                if (${JSON.stringify(mode)} === 'timeout' || ${JSON.stringify(mode)} === 'held' && worker.id === '0') {
                  await new Promise((resolve, reject) => {
                    let cancel = () => { record('aborted'); aborted.resolve(); reject(signal.reason); };
                    signal.addEventListener('abort', cancel, {once:true});
                    released.promise.then(() => { signal.removeEventListener('abort', cancel); resolve(); });
                    if (signal.aborted) cancel();
                  });
                }
                signal.throwIfAborted();
                record('prepared');
                return ${result};
              } finally { record('settled'); settled.resolve(); }
            },
            drain() { record('drained'); },
            async teardown() {
              await writeFile(config.root + '/preparation-' + worker.id + '.json', JSON.stringify(events));
              await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
            }
          };
        }
      };
    }`;
}

async function fixtureProject(t, { setup = {}, config = {}, source } = {}) {
  return project(t, {
    config: { setup: './setup.js', browser: visible, timeout: 15000, ...config },
    files: { 'setup.js': setupSource(setup) },
    ...(source === undefined ? {} : { source }),
  });
}

let state = async (t, origin) => (await fetch(new URL('/state', origin), { signal: t.signal })).json();
let barrier = (t, origin, path) => fetch(new URL(path, origin), { signal: t.signal });
let post = (t, url, route, input) => fetch(url + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: t.signal,
});

async function manualOwner(t, url, names = ['prepares once']) {
  let response = await post(t, url, 'capture', {});
  assert.equal(response.status, 200, await response.clone().text());
  let owner = await response.json();
  let started = await post(t, url, 'events', { ...owner, ...reportPayload({ type: 'start', tests: names }) });
  assert.equal(started.status, 200, await started.text());
  return owner;
}

// The finish event proves both replay request bodies were sent while preparation
// is held. Responses still come from the real CLI gateway.
function assignmentRequest(t, url, owner, requestId) {
  let sent = Promise.withResolvers();
  let response = new Promise((resolve, reject) => {
    let outgoing = request(url + 'assignment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: t.signal,
    }, incoming => {
      let chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.once('error', reject);
      incoming.once('end', () => resolve({ status: incoming.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    outgoing.once('error', error => { sent.reject(error); reject(error); });
    outgoing.once('finish', sent.resolve);
    outgoing.end(JSON.stringify({ ...owner, requestId }));
  });
  return { sent: sent.promise, response };
}

test('assignment replays share held preparation and keep consuming the original test budget', { timeout: 30000 }, async t => {
  let fixture = await fixtureProject(t, { setup: { mode: 'held' } });
  let session = fixture.run(['--manual']);
  let { url, appURL } = await session.waitForEvent('ready');
  let owner = await manualOwner(t, url);
  let first = assignmentRequest(t, url, owner, 'same-request');
  await first.sent;
  await barrier(t, appURL, '/entered');
  let replayWhileHeld = assignmentRequest(t, url, owner, 'same-request');
  await replayWhileHeld.sent;
  assert.deepEqual((await state(t, appURL)).map(event => event.phase), ['preparing']);
  await barrier(t, appURL, '/release');
  let responses = await Promise.all([first.response, replayWhileHeld.response]);
  for (let response of responses) assert.equal(response.status, 200, response.text);
  let assignments = responses.map(response => JSON.parse(response.text).assignment);
  assert.equal(assignments[0].id, assignments[1].id);
  assert.deepEqual(assignments[0].preparation.fixtures, { staticValue: 'Shared build', executionName: 'prepares once', preparedWorker: '0' });
  assert.ok(assignments.every(assignment => assignment.preparation.remaining > 0 && assignment.preparation.remaining < 15000));
  await state(t, appURL);
  let later = await post(t, url, 'assignment', { ...owner, requestId: 'same-request' });
  assert.equal(later.status, 200, await later.clone().text());
  let last = (await later.json()).assignment;
  assert.equal(last.id, assignments[0].id);
  assert.ok(last.preparation.remaining < Math.min(...assignments.map(assignment => assignment.preparation.remaining)));
  let events = await state(t, appURL);
  assert.equal(events.filter(event => event.phase === 'preparing').length, 1);
  assert.equal(events.filter(event => event.phase === 'prepared').length, 1);
  assert.equal(events.some(event => ['hook', 'document'].includes(event.phase)), false);
  await post(t, url, 'events', { ...owner, ...reportPayload({ type: 'test', executionId: last.id, index: 0, name: 'prepares once', status: 'passed' }) });
  assert.equal((await post(t, url, 'events', { ...owner, type: 'complete' })).status, 200);
  await session.stop();
});

test('a held worker preparation allows its peer to finish and take another browser assignment', { timeout: 90000 }, async t => {
  let fixture = await fixtureProject(t, {
    setup: { mode: 'held' }, config: { workers: 2 },
    source: `describe('Preparation peers', () => {
      beforeEach(async ({app}) => { await app.request('/hook'); });
      for (let name of ['First task', 'Second task', 'Third task']) test(name, async ({app,I,fixtures,test}) => {
        await app.request('/slow-entered');
        await app.goto('/'); await I.find('Prepared application').visible();
        await I.assert(() => fixtures.staticValue === 'Shared build' && fixtures.executionName === test.name);
      });
    });`,
  });
  let session = fixture.run();
  let ready = await session.waitForEvent('ready');
  let held = ready.workers.find(worker => worker.id === '0');
  await barrier(t, held.appURL, '/entered');
  let third = await session.waitForEvent('test', event => event.name === 'Third task');
  assert.equal(third.workerId, '1');
  assert.equal(third.status, 'passed', JSON.stringify(third.error));
  let peerResults = session.events.filter(event => event.type === 'test');
  assert.equal(peerResults.length, 2);
  assert.ok(peerResults.every(event => event.workerId === '1' && event.status === 'passed'));
  assert.deepEqual((await state(t, held.appURL)).map(event => event.phase), ['preparing']);
  await barrier(t, held.appURL, '/release');
  let result = await session.completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 3);
  let saved = result.events.find(event => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json));
  assert.equal(report.schedule.assignments.length, 3);
});

test('Stop aborts held preparation before browser hooks and cannot reopen it after release', { timeout: 90000 }, async t => {
  let fixture = await fixtureProject(t, {
    setup: { mode: 'held' },
    source: `describe('Stopped preparation', () => {
      beforeEach(async ({app}) => { await app.request('/hook'); });
      test('must not open the app', async ({app}) => { await app.goto('/'); });
      test('must remain unassigned', () => { throw new Error('Unexpected later assignment'); });
    });`,
  });
  let session = fixture.run(['--ui']);
  let { url, appURL } = await session.waitForEvent('ready');
  let owner = await session.waitForEvent('capture');
  await barrier(t, appURL, '/entered');
  let stopping = post(t, url, 'control', { runId: owner.runId, command: 'stop' });
  await barrier(t, appURL, '/aborted');
  await barrier(t, appURL, '/settled');
  await barrier(t, appURL, '/release');
  let stopped = await stopping;
  assert.equal(stopped.status, 200, await stopped.text());
  await session.waitForEvent('fatal');
  let events = await state(t, appURL);
  assert.equal(events.filter(event => event.phase === 'preparing').length, 1);
  assert.equal(events.some(event => ['prepared', 'hook', 'document'].includes(event.phase)), false, JSON.stringify(events));
  let [run] = await (await fetch(url + 'results', { signal: t.signal })).json();
  assert.equal(run.assignments.length, 1);
  assert.equal(run.outcomes.length, 0);
  let rerun = await post(t, url, 'control', { runId: owner.runId, command: 'rerun', ids: [] });
  assert.equal(rerun.status, 409, await rerun.clone().text());
  assert.match(await rerun.text(), /Restart Dyno|preparation failed/i);
  await session.stop();
});

test('preparation uses the selected test timeout and prevents reuse after expiry', { timeout: 90000 }, async t => {
  let fixture = await fixtureProject(t, {
    setup: { mode: 'timeout' }, config: { timeout: 15000 },
    source: `describe('Preparation deadline', () => {
      beforeEach(async ({app}) => { await app.request('/hook'); });
      test('expires during preparation', () => { throw new Error('Timed-out body ran'); }, {timeout:500});
      test('must remain unassigned', () => { throw new Error('Worker was reused'); });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  let report = JSON.parse(await readFile(saved.json));
  assert.match(report.error.message, /preparation.*500 ms timeout/i);
  assert.deepEqual(report.tests.map(test => test.status), ['not-run', 'not-run']);
  assert.equal(report.schedule.assignments.length, 1);
  let events = JSON.parse(await readFile(fixture.directory + '/preparation-0.json'));
  assert.deepEqual(events.filter(event => event.phase !== 'drained').map(event => event.phase), ['preparing', 'aborted', 'settled']);
});

test('skipped tests do not prepare and successful execution fixtures reach browser hooks', { timeout: 90000 }, async t => {
  let fixture = await fixtureProject(t, {
    source: `describe('Prepared fixtures', () => {
      beforeEach(async ({app,I,fixtures,test}) => {
        await I.assert(() => fixtures.executionName === test.name && fixtures.staticValue === 'Shared build');
        await app.request('/hook');
      });
      test.skip('pending first');
      test('uses prepared values', async ({app,I,fixtures}) => {
        await app.goto('/'); await I.find('Prepared application').visible();
        await I.assert(() => fixtures.preparedWorker === '0');
      });
      test.skip('pending last');
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.skipped, 2);
  let events = JSON.parse(await readFile(fixture.directory + '/preparation-0.json'));
  assert.deepEqual(events.filter(event => event.phase === 'preparing').map(event => event.name), ['uses prepared values']);
  assert.equal(events.filter(event => event.phase === 'hook').length, 1);
  assert.ok(events.findIndex(event => event.phase === 'prepared') < events.findIndex(event => event.phase === 'hook'));
});

for (let [label, value, message] of [
  ['static fixture collision', '{fixtures:{staticValue:"overwritten"}}', /conflicts with a static fixture/],
  ['nested undefined', '{fixtures:{value:{missing:undefined}}}', /plain JSON/],
  ['function', '{fixtures:{value:()=>"hidden"}}', /plain JSON/],
  ['custom serializer', '{fixtures:{value:{toJSON(){return "coerced"}}}}', /plain JSON/],
  ['sparse array', '{fixtures:{value:Array(1)}}', /dense/],
  ['nonfinite number', '{fixtures:{value:Infinity}}', /plain JSON/],
]) test(`invalid preparation ${label} fails before delivering an assignment`, { timeout: 30000 }, async t => {
  let fixture = await fixtureProject(t, { setup: { result: value } });
  let session = fixture.run(['--manual']);
  let { url, appURL } = await session.waitForEvent('ready');
  let owner = await manualOwner(t, url);
  let rejected = await post(t, url, 'assignment', { ...owner, requestId: 'invalid-fixtures' });
  assert.ok(rejected.status >= 400, await rejected.clone().text());
  assert.match(await rejected.text(), message);
  let [run] = await (await fetch(url + 'results', { signal: t.signal })).json();
  assert.equal(run.outcomes.length, 0);
  assert.match(run.error.message, message);
  let again = await post(t, url, 'assignment', { ...owner, requestId: 'after-failure' });
  assert.equal(again.status, 409, await again.text());
  let events = await state(t, appURL);
  assert.equal(events.filter(event => event.phase === 'preparing').length, 1);
  assert.equal(events.some(event => ['hook', 'document'].includes(event.phase)), false);
  await session.stop();
});
