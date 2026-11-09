import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  connectFixtureControl, createFixtureController, createFixtureHttpHandler, defineFixtureOperations
} from '../../src/fixtures.js';
import {
  fixtureRequestLimit, readFixtureResponse, snapshotJson, snapshotFixtureTransport
} from '../../src/fixture-protocol.js';

let identity = (workerId, executionId = 'one', runId = 'run') => ({ runId, workerId, executionId });
let post = (url, value, options = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
  body: JSON.stringify(value), ...options, redirect: 'error'
});

// A real app with private SQLite state and admission holds, independent of Dyno internals.
async function app(t, { workerId = 'worker', reset, drain, operations = {}, resumeFailure = false, onResume = () => {} } = {}) {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-fixture-http-'));
  let db = new DatabaseSync(join(directory, 'app.sqlite'));
  db.exec('CREATE TABLE users (name TEXT, ready INTEGER DEFAULT 0); CREATE TABLE audit (event TEXT)');
  let events = new EventEmitter(), gates = new Map(), jobs = [], active = new Set(), holds = new Set();
  let gate = name => {
    let pending = Promise.withResolvers(); gates.set(name, pending);
    return pending.promise.finally(() => gates.delete(name));
  };
  let context = Object.freeze({ db, events, gate, jobs });
  let token = randomBytes(32).toString('hex');
  let pause = () => {
    let hold = Object.freeze({
      idle: () => Promise.allSettled([...active]),
      resume: () => {
        holds.delete(hold);
        onResume();
        if (resumeFailure) throw new Error('App resume failed after releasing its hold.');
      }
    });
    holds.add(hold); return hold;
  };
  let controller = createFixtureController({ workerId, context, pause,
    reset: reset ?? (({ db }) => { db.exec('DELETE FROM users'); return { workerId }; }),
    drain: async (context, execution) => {
      db.prepare('INSERT INTO audit VALUES (?)').run('drain');
      events.emit('drain-started');
      if (drain) await drain(context, execution);
      await Promise.all(jobs);
    },
    operations: defineFixtureOperations({
      'seed.user'({ db }, { name }) {
        db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
        return { name };
      },
      async 'seed.held'({ db, gate, events }, { name }, { signal }) {
        db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
        let waiting = gate('fixture');
        signal.addEventListener('abort', () => events.emit('fixture-aborted'), { once: true });
        events.emit('fixture-started');
        await waiting;
        db.prepare('UPDATE users SET ready = 1 WHERE name = ?').run(name);
        return { name };
      },
      'seed.job'({ db, gate, jobs }, { name, fail }) {
        db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
        let work = gate('job').then(() => {
          if (fail) throw new Error('private app failure');
          db.prepare('UPDATE users SET ready = 1 WHERE name = ?').run(name);
        });
        void work.catch(() => {}); jobs.push(work);
        return { name };
      }
    }, operations)
  });
  let handle = createFixtureHttpHandler(controller, { token });
  let server = createServer((request, response) => {
    let work = (async () => {
      if (await handle(request, response)) return;
      if (holds.size) { response.writeHead(503).end(); return; }
      let finished = once(response, 'close');
      let running = (async () => {
        if (request.url === '/held-write') {
          db.prepare('INSERT INTO users (name) VALUES (?)').run('HTTP write');
          let waiting = gate('http'); events.emit('http-started'); await waiting;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          users: db.prepare('SELECT * FROM users').all(),
          audit: db.prepare('SELECT * FROM audit').all()
        }));
        await finished;
      })();
      active.add(running);
      try { await running; } finally { active.delete(running); }
    })();
    void work.catch(error => {
      if (!response.destroyed && !response.headersSent) response.writeHead(500).end(error.message);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let url = `http://127.0.0.1:${server.address().port}`;
  let control = connectFixtureControl({ url, workerId, token });
  let release = name => gates.get(name)?.resolve();
  t.after(async () => {
    for (let value of gates.values()) value.resolve();
    await controller.close().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    db.close(); await rm(directory, { recursive: true, force: true });
  });
  return { url, token, control, controller, events, release,
    read: async () => (await fetch(url + '/users')).json(),
    call: (binding, name, input = null, options) => post(url + binding.path, { scope: binding.scope, name, input }, options),
    raw: (action, body, options = {}) => post(url + '/__dyno_fixtures__/' + action, body, {
      ...options, headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}`, ...options.headers }
    })
  };
}

test('named operations seed real isolated apps and reject stale capabilities across runs', async t => {
  let [one, two] = await Promise.all([app(t, { workerId: 'one' }), app(t, { workerId: 'two' })]);
  assert.equal((await fetch(one.url + '/users')).status, 503);
  let [first, second] = await Promise.all([
    one.control.begin(identity('one')), two.control.begin(identity('two'))
  ]);
  assert.deepEqual(first.fixtures, { workerId: 'one' });
  assert.equal(first.fixtureTransport.path, '/__dyno_fixtures__/call');
  assert.ok(!JSON.stringify(first).includes(one.token));
  let [alice, bob] = await Promise.all([
    one.call(first.fixtureTransport, 'seed.user', { name: 'Alice' }),
    two.call(second.fixtureTransport, 'seed.user', { name: 'Bob' })
  ]);
  assert.deepEqual(await alice.json(), { value: { name: 'Alice' } });
  assert.equal(bob.status, 200);
  assert.deepEqual((await one.read()).users.map(user => user.name), ['Alice']);
  assert.deepEqual((await two.read()).users.map(user => user.name), ['Bob']);
  assert.equal((await two.call(first.fixtureTransport, 'seed.user', { name: 'Wrong' })).status, 409);
  assert.equal((await one.call(first.fixtureTransport, 'constructor')).status, 404);
  await one.control.drain(identity('one'));
  let next = await one.control.begin(identity('one', 'next', 'rerun'));
  assert.equal((await one.read()).users.length, 0);
  assert.equal((await one.call(first.fixtureTransport, 'seed.user', { name: 'Late' })).status, 409);
  assert.equal((await one.call(next.fixtureTransport, 'seed.user', { name: 'Next' })).status, 200);
});

test('HTTP abort cannot undo a committed write; drain still joins the original fixture', async t => {
  let project = await app(t);
  let scope = identity('worker');
  let prepared = await project.control.begin(scope);
  let abort = new AbortController();
  let started = once(project.events, 'fixture-started');
  let canceled = once(project.events, 'fixture-aborted');
  let response = project.call(prepared.fixtureTransport, 'seed.held', { name: 'Committed' }, { signal: abort.signal });
  let rejected = assert.rejects(response);
  await started; abort.abort(new Error('caller canceled')); await rejected; await canceled;
  assert.equal((await project.read()).users[0].name, 'Committed');
  let draining = once(project.events, 'drain-started');
  let cleanup = project.control.drain(scope);
  await draining;
  assert.equal((await fetch(project.url + '/users')).status, 503);
  assert.equal((await project.call(prepared.fixtureTransport, 'seed.user', { name: 'Late' })).status, 409);
  await assert.rejects(project.control.begin(identity('worker', 'next')), { code: 'execution_conflict' });
  project.release('fixture'); await cleanup;
  let next = await project.control.begin(identity('worker', 'next'));
  assert.equal((await project.call(next.fixtureTransport, 'seed.user', { name: 'Reusable' })).status, 200);
});

test('app drain releases held HTTP work before waiting for idle, and duplicate drain runs once', async t => {
  let releaseHttp;
  let project = await app(t, { drain: () => releaseHttp() });
  releaseHttp = () => project.release('http');
  let scope = identity('worker');
  await project.control.begin(scope);
  let started = once(project.events, 'http-started');
  let response = fetch(project.url + '/held-write'); await started;
  await Promise.all([project.control.drain(scope), project.control.drain(scope)]);
  assert.equal((await response).status, 200);
  await project.control.begin(identity('worker', 'next'));
  assert.deepEqual((await project.read()).audit, [{ event: 'drain' }]);
});

test('background job failure leaves reset and app admission closed', async t => {
  let project = await app(t);
  let scope = identity('worker');
  let prepared = await project.control.begin(scope);
  await project.call(prepared.fixtureTransport, 'seed.job', { name: 'Job', fail: true });
  let entered = once(project.events, 'drain-started');
  let draining = project.control.drain(scope);
  let rejected = assert.rejects(draining, { code: 'drain_failed', message: 'Fixture drain failed.' });
  await entered; project.release('job'); await rejected;
  await assert.rejects(project.control.begin(identity('worker', 'next')), { code: 'execution_conflict' });
  assert.equal((await fetch(project.url + '/users')).status, 503);
  assert.equal((await project.call(prepared.fixtureTransport, 'seed.user', { name: 'Late' })).status, 409);
});

test('canceled reset never reopens and close joins its actual work using a fresh signal', async t => {
  let entered = Promise.withResolvers(), resetDone = Promise.withResolvers();
  let drainSignal;
  let project = await app(t, { reset: async ({ db }, { signal }) => {
    entered.resolve(signal); await resetDone.promise;
    db.prepare('INSERT INTO users (name) VALUES (?)').run('late reset');
    return {};
  }, drain: (_context, { signal }) => { drainSignal = signal; signal.throwIfAborted(); } });
  let abort = new AbortController();
  let beginning = project.control.begin({ ...identity('worker'), signal: abort.signal });
  let rejected = assert.rejects(beginning);
  let resetSignal = await entered.promise;
  abort.abort(new Error('private cancellation')); await rejected;
  let drained = once(project.events, 'drain-started');
  let closed = project.controller.close();
  let closeResult = assert.rejects(closed);
  await drained;
  assert.ok(resetSignal.aborted);
  assert.ok(drainSignal instanceof AbortSignal);
  assert.equal(drainSignal.aborted, false);
  assert.equal((await fetch(project.url + '/users')).status, 503);
  resetDone.resolve(); await closeResult;
  await assert.rejects(project.controller.begin(identity('worker', 'next')), { code: 'execution_conflict' });
  assert.equal((await fetch(project.url + '/users')).status, 503);
});

test('a canceled drain retains app work and never reopens after it eventually finishes', async t => {
  let project = await app(t);
  let scope = identity('worker');
  let prepared = await project.control.begin(scope);
  await project.call(prepared.fixtureTransport, 'seed.job', { name: 'Delayed job' });
  let started = once(project.events, 'drain-started');
  let abort = new AbortController();
  let draining = project.control.drain({ ...scope, signal: abort.signal });
  let failed = assert.rejects(draining);
  await started; abort.abort(); await failed;
  let closed = project.controller.close();
  project.release('job'); await closed;
  assert.equal((await fetch(project.url + '/users')).status, 503);
  await assert.rejects(project.controller.begin(identity('worker', 'late')), { code: 'execution_conflict' });
});

test('failed reset or resume closes admission and cannot be retried', async t => {
  for (let options of [{ reset: () => { throw new Error('private reset details'); } }, { resumeFailure: true }]) {
    let project = await app(t, options);
    await assert.rejects(project.control.begin(identity('worker')), { code: 'reset_failed', message: 'Fixture reset failed.' });
    assert.equal((await fetch(project.url + '/users')).status, 503);
    await assert.rejects(project.control.begin(identity('worker', 'retry')), { code: 'execution_conflict' });
  }
});

test('abort reentered during admission resume keeps the committed execution open and drainable', async t => {
  let abort = new AbortController();
  let project = await app(t, { onResume: () => abort.abort(new Error('caller disconnected')) });
  let scope = identity('worker');
  let prepared = await project.controller.begin(scope, { signal: abort.signal });
  let binding = { path: '/__dyno_fixtures__/call', scope: prepared.scope };

  assert.ok(abort.signal.aborted);
  assert.deepEqual(prepared.fixtures, { workerId: 'worker' });
  assert.equal((await project.call(binding, 'seed.user', { name: 'Committed' })).status, 200);
  assert.deepEqual((await project.read()).users.map(user => user.name), ['Committed']);

  await project.control.drain(scope);
  assert.equal((await fetch(project.url + '/users')).status, 503);
  let next = await project.control.begin(identity('worker', 'next'));
  assert.equal((await project.call(next.fixtureTransport, 'seed.user', { name: 'Next' })).status, 200);
});

test('codec authenticates control before parsing, bounds JSON, and sanitizes callback failures', async t => {
  let secret = randomBytes(32).toString('hex');
  let project = await app(t, { operations: {
    'fail.private': () => { throw new Error(secret); },
    'invalid.result': () => ({ secret: undefined }),
    'large.result': () => 'x'.repeat(1_048_576)
  } });
  let denied = await fetch(project.url + '/__dyno_fixtures__/begin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'invalid JSON'
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: { code: 'forbidden', message: 'Fixture access denied.' } });
  let malformed = await fetch(project.url + '/__dyno_fixtures__/begin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${project.token}` }, body: '{'
  });
  assert.equal(malformed.status, 400);
  assert.equal((await project.raw('begin', identity('worker'), { headers: { Origin: 'https://foreign.test' } })).status, 403);
  let method = await fetch(project.url + '/__dyno_fixtures__/begin');
  assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'POST');
  assert.equal((await project.raw('other', {})).status, 404);
  let prepared = await project.control.begin(identity('worker'));
  for (let name of ['fail.private', 'invalid.result', 'large.result']) {
    let result = await project.call(prepared.fixtureTransport, name);
    assert.equal(result.status, 500);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    let body = await result.text(); assert.ok(!body.includes(secret));
    assert.ok(!body.includes(project.token)); assert.ok(!body.includes(prepared.fixtureTransport.scope.token));
  }
  let tooLarge = await project.call(prepared.fixtureTransport, 'seed.user', { name: 'x'.repeat(fixtureRequestLimit) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, 'input_too_large');
});

test('chunked oversized requests receive a bounded JSON error without parsing the body', async t => {
  let project = await app(t);
  let request = httpRequest(project.url + '/__dyno_fixtures__/begin', { method: 'POST', headers: {
    'Content-Type': 'application/json', authorization: `Bearer ${project.token}`
  } });
  let received = once(request, 'response');
  request.end('x'.repeat(fixtureRequestLimit + 1));
  let [response] = await received;
  let chunks = []; for await (let chunk of response) chunks.push(chunk);
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(Buffer.concat(chunks)).error.code, 'input_too_large');
});

test('strict JSON snapshots preserve values without running getters or serializers', () => {
  let source = { nested: [{ value: 'original' }] };
  let result = snapshotJson(source);
  source.nested[0].value = 'changed';
  assert.equal(result.nested[0].value, 'original');
  assert.ok(Object.isFrozen(result.nested[0]));
  for (let value of [undefined, Infinity, NaN, 1n, () => {}, new Date(), new Map(), [, 1],
    { value: undefined }, { get value() { throw new Error('getter ran'); } }, { toJSON() { throw new Error('serializer ran'); } }])
    assert.throws(() => snapshotJson(value), TypeError);
  let cyclic = {}; cyclic.value = cyclic;
  assert.throws(() => snapshotJson(cyclic), TypeError);
  assert.throws(() => snapshotJson({ key: 'four' }, { maxBytes: 2 }), RangeError);
  assert.equal(snapshotJson('larger', { maxBytes: 100 }), 'larger');
  let deep = null; for (let i = 0; i < 65; i++) deep = [deep];
  assert.throws(() => snapshotJson(deep), TypeError);
  assert.throws(() => defineFixtureOperations({ seed() {} }, { seed() {} }), /unique/);
  assert.throws(() => createFixtureController({ workerId: 'one', reset() {} }), /requires pause/);
  assert.throws(() => snapshotFixtureTransport({ path: 'https://foreign.test/call', scope: {} }));
});

test('response reader bounds hostile HTTP results and never trusts remote error messages', async t => {
  let requests = [], token = randomBytes(32).toString('hex');
  let server = createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/large') return response.end(JSON.stringify({ value: 'x'.repeat(1_048_576) }));
    if (request.url === '/error') return response.writeHead(400).end(JSON.stringify({
      error: { code: 'constructor', message: token }
    }));
    response.writeHead(307, { Location: '/private-token-leak' }).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let url = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(readFixtureResponse(await fetch(url + '/large')), { code: 'invalid_result' });
  await assert.rejects(readFixtureResponse(await fetch(url + '/error')), {
    code: 'operation_failed', message: 'Fixture operation failed.'
  });
  let control = connectFixtureControl({ url, workerId: 'worker', token });
  await assert.rejects(control.begin(identity('worker')), { code: 'operation_failed' });
  assert.deepEqual(requests, ['/large', '/error', '/__dyno_fixtures__/begin']);
});
