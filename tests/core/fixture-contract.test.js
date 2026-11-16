import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { connectFixtureControl, createFixtureController, createFixtureHttpHandler, defineFixtureOperations } from '../../src/fixtures.js';
import { fixtureRequestLimit, readFixtureResponse, snapshotJson } from '../../src/fixture-protocol.js';

let identity = executionId => ({ runId: 'run', workerId: 'worker', executionId });

async function listen(t, handle) {
  let server = createServer(handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('fixture HTTP rejects malformed envelopes and media without changing the open app execution', { timeout: 15000 }, async t => {
  let records = [];
  let controller = createFixtureController({ workerId: 'worker', context: records, operations: defineFixtureOperations({
    add(records, name) { records.push(name); return records.slice(); },
  }) });
  t.after(() => controller.close());
  let token = randomBytes(32).toString('hex');
  let path = '/test/fixtures';
  let handle = createFixtureHttpHandler(controller, { token, path });
  let url = await listen(t, async (request, response) => {
    if (await handle(request, response)) return;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(records));
  });
  let post = (action, input, headers = {}) => fetch(url + path + '/' + action, { method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input) });
  for (let [action, input, headers, status, code] of [
    ['begin?unexpected=1', identity('one'), {}, 404, 'unknown_route'],
    ['begin', identity('one'), { 'Content-Type': 'text/plain' }, 415, 'unsupported_media_type'],
    ['begin', Buffer.from([0xff]), {}, 400, 'invalid_request'],
    ['begin', { ...identity('one'), extra: true }, {}, 400, 'invalid_request'],
    ['begin', { ...identity('one'), workerId: 'foreign' }, {}, 409, 'execution_conflict'],
    ['begin', { ...identity('one'), executionId: 'x'.repeat(fixtureRequestLimit) }, {}, 413, 'input_too_large'],
  ]) {
    let response = await post(action, input, headers);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  let control = connectFixtureControl({ url, workerId: 'worker', token, path });
  let prepared = await control.begin(identity('one'));
  assert.deepEqual(prepared.fixtures, {});
  assert.equal(prepared.fixtureTransport.path, path + '/call');
  let valid = { scope: prepared.fixtureTransport.scope, name: 'add', input: 'Saved' };
  for (let input of [
    { scope: valid.scope, name: valid.name },
    { ...valid, extra: true },
    { ...valid, scope: { ...valid.scope, token: 'short' } },
    { ...valid, name: 'invalid name' },
  ]) {
    let response = await post('call', input);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_request');
  }
  let response = await post('call', valid);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { value: ['Saved'] });
  assert.deepEqual(await (await fetch(url + '/records', { signal: t.signal })).json(), ['Saved']);
  await control.drain(identity('one'));
});

test('fixture setup and parsed requests fail clearly while committed app writes survive result errors', async t => {
  assert.throws(() => createFixtureController(), /worker ID/);
  assert.throws(() => createFixtureController({ workerId: 'worker', drain: true }), /callbacks must be functions/);
  assert.throws(() => createFixtureController({ workerId: 'worker', pause: () => ({}) }), /idle, resume/);
  assert.throws(() => defineFixtureOperations(null), /plain records/);
  assert.throws(() => snapshotJson([], { maxDepth: -1 }), /limits/);
  let records = [];
  let controller = createFixtureController({ workerId: 'worker', context: records, operations: {
    save(records, input) { records.push(input); return input; },
    saveWithoutResult(records, input) { records.push(input); },
  } });
  t.after(() => controller.close());
  let prepared = await controller.begin(identity('one'));
  let request = { scope: prepared.scope, name: 'save', input: 'First' };
  for (let invalid of [undefined, { ...request, input: undefined }, { ...request, extra: true }])
    await assert.rejects(controller.dispatch(invalid), { code: 'invalid_request' });
  await assert.rejects(controller.dispatch({ ...request, input: 'x'.repeat(fixtureRequestLimit) }), { code: 'input_too_large' });
  assert.equal(await controller.dispatch(request), 'First');
  await assert.rejects(controller.dispatch({ ...request, name: 'saveWithoutResult', input: 'Committed' }), { code: 'invalid_result' });
  assert.deepEqual(records, ['First', 'Committed']);
  await assert.rejects(controller.drain({ ...identity('one'), workerId: 'foreign' }), { code: 'execution_conflict' });
  await controller.drain(identity('one'));
  await assert.rejects(controller.dispatch(request), { code: 'execution_conflict' });
  await controller.close();
  await assert.rejects(controller.begin(identity('two')), { code: 'execution_conflict' });
  await assert.rejects(controller.drain(identity('one')), { code: 'execution_conflict' });

  assert.throws(() => createFixtureHttpHandler(controller, { token: 'short' }), /private token/);
  assert.throws(() => createFixtureHttpHandler({}, { token: 'x'.repeat(32) }), /fixture controller/);
});

test('fixture control rejects unexpected successful responses and identity changes from a real HTTP service', { timeout: 15000 }, async t => {
  let token = randomBytes(32).toString('hex');
  let requests = [];
  let url = await listen(t, async (request, response) => {
    requests.push(request.url);
    if (request.method === 'HEAD') return response.writeHead(200).end();
    let chunks = [];
    for await (let chunk of request) chunks.push(chunk);
    let input = JSON.parse(Buffer.concat(chunks));
    response.setHeader('Content-Type', 'application/json');
    if (input.executionId === 'empty') return response.writeHead(204).end();
    let result = input.executionId === 'fixtures-array' ? { fixtures: [], scope: { ...input, token } }
      : input.executionId === 'wrong-owner' ? { fixtures: {}, scope: { ...input, workerId: 'foreign', token } }
        : { fixtures: {}, scope: { ...input, token } };
    response.end(JSON.stringify(result));
  });
  let control = connectFixtureControl({ url, workerId: 'worker', token });
  for (let executionId of ['empty', 'fixtures-array', 'wrong-owner'])
    await assert.rejects(control.begin(identity(executionId)), { code: 'invalid_result' });
  await assert.rejects(control.drain(identity('unexpected-body')), { code: 'invalid_result' });
  let sent = requests.length;
  await assert.rejects(control.begin({ ...identity('one'), workerId: 'foreign' }), { code: 'execution_conflict' });
  assert.equal(requests.length, sent, 'A foreign worker cannot send the private control token.');
  await assert.rejects(readFixtureResponse(await fetch(url, { method: 'HEAD', signal: t.signal })), { code: 'invalid_result' });
  for (let target of ['file:///private/tmp/app', url + '/private', url + '?token=secret', url.replace('http://', 'http://name:password@')])
    assert.throws(() => connectFixtureControl({ url: target, workerId: 'worker', token }), /HTTP origin/);
});

test('invalid fixture reset, asynchronous admission resume, and cleanup failures keep the app closed', { timeout: 15000 }, async t => {
  for (let failure of ['reset-result', 'async-resume', 'cleanup']) {
    let holds = new Set();
    let cleaning = false;
    let controller = createFixtureController({ workerId: 'worker',
      pause() {
        let hold = {
          idle() { if (cleaning) throw new Error('Private idle failure'); },
          resume() {
            holds.delete(hold);
            if (failure === 'async-resume') return Promise.resolve();
          },
        };
        holds.add(hold);
        return hold;
      },
      reset() { return failure === 'reset-result' ? [] : {}; },
      drain() { if (cleaning) throw new Error('Private drain failure'); },
    });
    t.after(() => controller.close().catch(() => {}));
    let token = randomBytes(32).toString('hex');
    let handle = createFixtureHttpHandler(controller, { token });
    let url = await listen(t, async (request, response) => {
      if (await handle(request, response)) return;
      response.writeHead(holds.size ? 503 : 200).end();
    });
    let control = connectFixtureControl({ url, workerId: 'worker', token });
    if (failure === 'cleanup') {
      await control.begin(identity('one'));
      assert.equal((await fetch(url, { signal: t.signal })).status, 200);
      cleaning = true;
      await assert.rejects(control.drain(identity('one')), { code: 'drain_failed', message: 'Fixture drain failed.' });
    } else {
      await assert.rejects(control.begin(identity('one')), {
        code: failure === 'reset-result' ? 'invalid_result' : 'reset_failed',
      });
    }
    assert.equal((await fetch(url, { signal: t.signal })).status, 503);
    await assert.rejects(control.begin(identity('two')), { code: 'execution_conflict' });
    await assert.rejects(controller.close(), { code: 'drain_failed' });
  }
});

test('a fixture call racing drain cannot report success after its committed app write outlives the execution', { timeout: 15000 }, async t => {
  let records = [];
  let entered = Promise.withResolvers();
  let released = Promise.withResolvers();
  let holds = new Set();
  t.after(() => released.resolve());
  let controller = createFixtureController({ workerId: 'worker', context: records,
    pause() {
      let hold = { idle() {}, resume() { holds.delete(hold); } };
      holds.add(hold);
      return hold;
    },
    operations: {
      async save(records, input) {
        records.push(input);
        entered.resolve();
        await released.promise;
        return input;
      },
    },
    drain() { released.resolve(); },
  });
  t.after(() => controller.close());
  let token = randomBytes(32).toString('hex');
  let handle = createFixtureHttpHandler(controller, { token });
  let url = await listen(t, async (request, response) => {
    if (await handle(request, response)) return;
    response.writeHead(holds.size ? 503 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(records));
  });
  let control = connectFixtureControl({ url, workerId: 'worker', token });
  let prepared = await control.begin(identity('one'));
  let calling = fetch(url + prepared.fixtureTransport.path, { method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: prepared.fixtureTransport.scope, name: 'save', input: 'Committed' }) });
  void calling.catch(() => {});
  await entered.promise;
  await control.drain(identity('one'));
  let response = await calling;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'execution_conflict');
  assert.equal((await fetch(url, { signal: t.signal })).status, 503);
  await control.begin(identity('two'));
  assert.deepEqual(await (await fetch(url, { signal: t.signal })).json(), ['Committed']);
});
