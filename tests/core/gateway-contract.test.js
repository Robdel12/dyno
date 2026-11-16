import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { EventEmitter, once } from 'node:events';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { project } from '../helpers/project.js';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createGateway } from '../../src/server.js';

let descriptor = { id: JSON.stringify(['workflow.test.js', 'Workflow', 'saves']), file: 'workflow.test.js', suites: ['Workflow'], name: 'saves', index: 0,
  resources: [], skipReason: null };

async function gateway(t, webServer = {}, options = {}) {
  let fixture = await project(t, { config: { ...options, webServer } });
  let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
  let events = new EventEmitter();
  let app = await createGateway(config, await buildSuite(config), { onEvent: event => events.emit('event', event) });
  t.after(() => app.close());
  let response = await fetch(app.url + 'capture', { method: 'POST', signal: t.signal });
  assert.equal(response.status, 200);
  let owner = await response.json();
  let post = (route, value, headers = {}) => fetch(app.url + route, { method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...owner, ...value }) });
  let start = async () => {
    assert.equal((await post('events', { type: 'start', tests: [descriptor] })).status, 200);
    let claimed = await post('assignment', { requestId: 'claim' });
    assert.equal(claimed.status, 200);
    return (await claimed.json()).assignment;
  };
  let finish = async (assignment, { release = false } = {}) => {
    assert.equal((await post('events', { type: 'test', executionId: assignment.id, testId: descriptor.id,
      index: 0, name: descriptor.name, status: 'passed', output: [] })).status, 200);
    if (release)
      assert.equal((await post('released', { requestId: 'release', executionId: assignment.id })).status, 200);
    assert.equal((await post('events', { type: 'complete', duration: 1 })).status, 200);
    let [run] = await (await fetch(app.url + 'results', { signal: t.signal })).json();
    assert.equal(run.outcomes[0].status, 'passed');
    return run;
  };
  return { ...app, owner, post, start, finish, events, directory: fixture.directory };
}

test('malformed reporter commands and execution contexts cannot replace an owned test result', { timeout: 15000 }, async t => {
  let app = await gateway(t);
  let assignment = await app.start();
  for (let command of [
    { command: 'unknown' },
    { command: 'inspect', runId: 'foreign' },
    { command: 'pause-on-failure', value: 'yes' },
    { command: 'viewport', viewport: { width: 0, height: 600 } },
    { command: 'rerun', ids: [42] },
  ]) {
    let response = await app.post('control', command);
    assert.equal(response.status, 400, await response.text());
  }
  for (let route of ['operations', 'assignment', 'events']) {
    let response = await fetch(app.url + route, { method: 'POST', signal: t.signal,
      headers: { 'Content-Type': 'application/json' }, body: '[]' });
    assert.equal(response.status, 400, await response.text());
    response = await app.post(route, {}, { Origin: 'https://foreign.example' });
    assert.equal(response.status, 400, await response.text());
  }
  assert.equal((await app.post('assignment', { requestId: '' })).status, 400);
  assert.equal((await app.post('connection-status', { status: 'unknown' })).status, 400);
  assert.equal((await app.post('connection-status', { status: 'reconnecting' })).status, 200);
  assert.equal((await app.post('command-result', { requestId: 'foreign' })).status, 409);
  let context = { executionId: assignment.id, documentId: 'document', revision: 0, width: 800, height: 600 };
  assert.equal((await app.post('context', { context: { ...context, executionId: 'foreign' } })).status, 409);
  for (let change of [{ width: 0 }, { revision: 0.5 }, { documentId: 42 }])
    assert.equal((await app.post('context', { context: { ...context, ...change } })).status, 400);
  assert.equal((await app.post('context', { context })).status, 200);
  assert.equal((await app.post('operations/cancel', { executionId: 42, requestId: 'cancel' })).status, 400);
  assert.equal((await app.post('operations', { operation: 'resize', viewport: { width: 0, height: 600 } })).status, 400);
  assert.equal((await app.post('operations', { operation: 'resize', viewport: { width: 800, height: 600 } })).status, 200);
  assert.equal((await app.post('operations', { operation: 'reset-native', executionId: '' })).status, 400);
  assert.equal((await app.post('operations', { operation: 'reset-native', executionId: assignment.id })).status, 200);
  assert.equal((await app.post('operations', { operation: 'unknown' })).status, 400);
  await app.finish(assignment);
});

test('manual screenshots validate their requests and preserve explicitly skipped captures as accepted evidence', { timeout: 15000 }, async t => {
  let app = await gateway(t);
  let assignment = await app.start();
  let context = { executionId: assignment.id, documentId: 'document', revision: 0, width: 800, height: 600 };
  assert.equal((await app.post('context', { context })).status, 200);
  let screenshot = { operation: 'screenshot', context, requestId: 'optional', name: 'Contact saved', optional: true };
  for (let options of [null, [], { maskColor: [0, 0, 0, 128] }, { animations: 'sometimes' },
    { caret: 'sometimes' }, { mask: [{ x: 0, y: 0, width: -1, height: 1 }] },
    { fullPage: true, clip: { x: 0, y: 0, width: 0, height: 1 } }])
    assert.equal((await app.post('operations', { ...screenshot, options })).status, 400);
  for (let change of [{ name: '' }, { name: 'x'.repeat(201) }, { optional: 'yes' }])
    assert.equal((await app.post('operations', { ...screenshot, ...change })).status, 400);
  assert.equal((await app.post('operations', { ...screenshot, context: { ...context, documentId: 'old' } })).status, 409);
  assert.equal((await app.post('operations', { ...screenshot, requestId: '' })).status, 400);
  assert.equal((await app.post('operations', { ...screenshot, requestId: 'x'.repeat(201) })).status, 400);
  assert.equal((await app.post('operations', { operation: 'activate', context })).status, 422);
  assert.equal((await app.post('operations', { ...screenshot, requestId: 'required', optional: false })).status, 422);
  assert.equal((await app.post('operations/cancel', { executionId: assignment.id, requestId: 'cancelled' })).status, 200);
  assert.equal((await app.post('operations', { ...screenshot, requestId: 'cancelled' })).status, 409);
  let skipped = await app.post('operations', screenshot);
  assert.equal(skipped.status, 200);
  let attachment = await skipped.json();
  assert.equal(attachment.status, 'skipped');
  assert.match(attachment.reason, /no capture provider/);
  assert.equal((await app.post('operations', screenshot)).status, 409);
  assert.equal((await app.post('attachments/commit', { id: attachment.id })).status, 409);
  let run = await app.finish(assignment);
  assert.equal(run.outcomes[0].attachments[0].id, attachment.id);
  assert.equal(run.outcomes[0].attachments[0].status, 'skipped');
  assert.equal((await app.post('attachments/discard', { id: attachment.id })).status, 200);
  assert.equal((await fetch(app.url + 'artifacts/' + attachment.id, { signal: t.signal })).status, 404);
  let [retained] = await (await fetch(app.url + 'results', { signal: t.signal })).json();
  assert.deepEqual(retained.outcomes[0].attachments, run.outcomes[0].attachments);
});

test('reporter streams reject unknown runs and workers and release connection slots when a host disconnects', { timeout: 15000 }, async t => {
  let app = await gateway(t);
  let assignment = await app.start();
  assert.equal((await fetch(app.url + 'stream?run=foreign', { signal: t.signal })).status, 404);
  assert.equal((await fetch(app.url + `stream?run=${app.owner.runId}&worker=foreign`, { signal: t.signal })).status, 400);
  let streams = [];
  t.after(() => Promise.all(streams.map(response => response.body.cancel().catch(() => {}))));
  for (let index = 0; index < 8; index++) {
    let response = await fetch(app.url + `stream?run=${app.owner.runId}${index ? '' : '&role=host'}`, { signal: t.signal });
    assert.equal(response.status, 200);
    streams.push(response);
  }
  assert.equal((await fetch(app.url + `stream?run=${app.owner.runId}`, { signal: t.signal })).status, 429);
  await app.finish(assignment);
  let disconnected = Promise.withResolvers();
  let receive = event => {
    if (event.type === 'browser-connection' && event.source === 'socket' && event.status === 'closed') {
      app.events.removeListener('event', receive);
      disconnected.resolve();
    }
  };
  app.events.on('event', receive);
  await streams.shift().body.cancel();
  await disconnected.promise;
  let reopened = await fetch(app.url + `stream?run=${app.owner.runId}`, { signal: t.signal });
  assert.equal(reopened.status, 200);
  streams.push(reopened);
});

test('invalid capture selections and unknown bundles leave the current execution and its source map intact', { timeout: 15000 }, async t => {
  let app = await gateway(t);
  let assignment = await app.start();
  for (let selection of [[], { unknown: [] }, { ids: 'one' }, { names: [''] }, { files: ['x'.repeat(10001)] }]) {
    let response = await app.post('capture', { selection });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Invalid test selection/);
  }
  let unknown = await fetch(app.url + 'suite.js?run=foreign', { signal: t.signal });
  assert.equal(unknown.status, 400);
  assert.match(await unknown.text(), /Unknown test bundle/);
  let response = await fetch(app.url + 'suite.js.map?run=' + app.owner.runId, { signal: t.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /immutable/);
  let map = await response.json();
  assert.equal(map.version, 3);
  assert(map.sources.some(path => path.endsWith('.test.js')));
  assert.throws(() => app.setDocumentPolicy({ 'cross-origin-opener-policy': 'same-origin' }), /before a browser joins/);
  await app.finish(assignment);
});

async function hostStream(t, app, owner) {
  let response = await fetch(app.url + `stream?run=${owner.runId}&role=host`, { signal: t.signal });
  assert.equal(response.status, 200);
  let reader = response.body.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  let decoder = new TextDecoder();
  let pending = '';
  return async () => {
    for (;;) {
      let end;
      while ((end = pending.indexOf('\n\n')) !== -1) {
        let frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (!/^event: command$/m.test(frame)) continue;
        return JSON.parse(/^data: (.+)$/m.exec(frame)[1]);
      }
      let chunk = await reader.read();
      assert.equal(chunk.done, false, 'The host disconnected before receiving its command.');
      pending += decoder.decode(chunk.value, { stream: true });
    }
  };
}

test('reporter commands require a connected worker and cannot borrow another pending acknowledgement', { timeout: 15000 }, async t => {
  let app = await gateway(t);
  let assignment = await app.start();
  assert.equal((await app.post('control', { command: 'inspect', workerId: 'foreign' })).status, 400);
  let disconnected = await app.post('control', { command: 'inspect' });
  assert.equal(disconnected.status, 409);
  assert.match(await disconnected.text(), /browser is disconnected/);
  let second = await (await app.post('capture', {})).json();
  let nextCommand = await hostStream(t, app, app.owner);
  await hostStream(t, app, second);
  let pending = app.post('control', { command: 'inspect', requestId: 'shared-request' });
  void pending.catch(() => {});
  assert.equal((await nextCommand()).requestId, 'shared-request');
  let collision = await app.post('control', { ...second, command: 'inspect', requestId: 'shared-request' });
  assert.equal(collision.status, 409);
  assert.match(await collision.text(), /already pending/);
  assert.equal((await app.post('command-result', { ...second, requestId: 'shared-request' })).status, 409);
  assert.equal((await app.post('command-result', { requestId: 'shared-request', error: 'The app could not open inspection.' })).status, 200);
  let acknowledged = await pending;
  assert.equal(acknowledged.status, 200);
  assert.deepEqual(await acknowledged.json(), { requestId: 'shared-request', error: 'The app could not open inspection.' });
  await app.finish(assignment);
});

test('invalid outcome and interruption envelopes cannot complete or fail an otherwise passing execution', { timeout: 15000 }, async t => {
  let app = await gateway(t);
  assert.equal((await app.post('events', { type: 'start', tests: [] })).status, 400);
  let assignment = await app.start();
  let result = { type: 'test', executionId: assignment.id, testId: descriptor.id, index: 0,
    name: descriptor.name, status: 'passed', output: [] };
  for (let [input, message] of [
    [{ ...result, duration: 1, timings: { duration: 2 } }, /Invalid test timings/],
    [{ ...result, error: { message: 'Invalid phase', phase: 'unknown' } }, /event error/],
    [{ ...result, additionalErrors: 'not an array' }, /additional failures/],
    [{ ...result, error: { message: 'A pass cannot contain an error' } }, /Only failed tests/],
    [{ ...result, status: 'skipped', skipReason: null }, /Skipped outcomes/],
    [{ type: 'fatal' }, /fatal event requires an error/],
    [{ type: 'fatal', error: { message: 'Interrupted' }, stopped: 'yes' }, /Invalid stopped status/],
  ]) {
    let response = await app.post('events', input);
    assert.equal(response.status, 400);
    assert.match(await response.text(), message);
  }
  let [running] = await (await fetch(app.url + 'results', { signal: t.signal })).json();
  assert.equal(running.status, 'running');
  assert.deepEqual(running.outcomes, []);
  await app.finish(assignment);
});

test('coverage integrations reject malformed maps and retain truthiness counters and acknowledged data through collection failure', { timeout: 15000 }, async t => {
  let app = await gateway(t, {}, { coverage: true });
  let assignment = await app.start();
  let filename = join(app.directory, 'app.js');
  let instrumenter = createInstrumenter({ esModules: true, reportLogic: true,
    coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
  let sandbox = {};
  runInNewContext(instrumenter.instrumentSync('globalThis.choose = value => value && value.enabled; choose({ enabled: true });', filename), sandbox);
  let coverage = JSON.parse(JSON.stringify(sandbox.__coverage__));
  assert(Object.keys(coverage[filename].bT).length > 0);
  let packet = { executionId: assignment.id, documentId: 'first', sequence: 1, coverage };
  assert.equal((await fetch(app.url + 'coverage', { method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json' }, body: '[]' })).status, 400);
  let invalid = [
    { ...packet, coverage: [] },
    { ...packet, error: '' },
    ...[
      { path: filename + '.different' },
      { hash: 42 },
      { bT: {} },
      { inputSourceMap: { version: 3, sources: [], names: [], mappings: '', sourceRoot: 42 } },
    ].map(change => ({ ...packet, coverage: { [filename]: { ...coverage[filename], ...change } } })),
  ];
  for (let input of invalid) {
    let response = await app.post('coverage', input);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Coverage:/);
  }
  assert.equal((await app.post('coverage', packet)).status, 200);
  let otherFilename = join(app.directory, 'other.js');
  let other = {};
  runInNewContext(instrumenter.instrumentSync('globalThis.answer = 42;', otherFilename), other);
  assert.equal((await app.post('coverage', { ...packet, documentId: 'second', coverage: JSON.parse(JSON.stringify(other.__coverage__)) })).status, 200);
  assert.equal((await app.post('coverage', { ...packet, sequence: 2, coverage: null,
    error: 'The app document closed before its final coverage snapshot.' })).status, 200);
  let run = await app.finish(assignment, { release: true });
  assert.equal(run.coverage.status, 'partial');
  assert.equal(run.coverage.failed, true);
  assert.match(run.coverage.failures.join(' '), /closed before its final coverage snapshot/);
  assert.equal(run.coverage.summary.functions.pct, 100);
  assert.deepEqual(run.coverage.data[filename].bT, coverage[filename].bT);
  assert(Object.hasOwn(run.coverage.data, otherFilename));
});

async function upstream(t, handle) {
  let server = createServer(handle);
  let sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    for (let socket of sockets) socket.destroy();
  }));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('the app proxy preserves foreign headers and redirects while rejecting undecodable or oversized HTML', { timeout: 15000 }, async t => {
  let server = await upstream(t, (request, response) => {
    if (request.url === '/encoding') return response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'unsupported' }).end('<p>App</p>');
    if (request.url === '/large') return response.writeHead(200, { 'Content-Type': 'text/html' }).end('x'.repeat(10_000_001));
    if (request.url === '/redirect') return response.writeHead(302, { Location: 'https://external.example/login' }).end();
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': server.origin,
      'Set-Cookie': ['owned=yes; Domain=127.0.0.1; Path=/', 'foreign=yes; Domain=external.example; Path=/'] });
    response.end(JSON.stringify(request.headers));
  });
  let app = await gateway(t, { url: server.origin });
  let response = await fetch(app.origin + '/headers', { signal: t.signal,
    headers: { Origin: 'https://external.example', Referer: 'https://external.example/page' } });
  assert.equal(response.headers.get('access-control-allow-origin'), app.origin);
  assert.deepEqual(response.headers.getSetCookie(), ['owned=yes; Path=/', 'foreign=yes; Domain=external.example; Path=/']);
  let received = await response.json();
  assert.equal(received.origin, 'https://external.example');
  assert.equal(received.referer, 'https://external.example/page');
  response = await fetch(app.origin + '/redirect', { signal: t.signal, redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://external.example/login');
  for (let [path, message] of [['/encoding', /Unsupported HTML encoding/], ['/large', /HTML exceeds/]]) {
    response = await fetch(app.origin + path, { signal: t.signal });
    assert.equal(response.status, 502);
    assert.match(await response.text(), message);
  }
});

test('upgraded app connections preserve initial bytes in both directions', { timeout: 15000 }, async t => {
  let server = await upstream(t);
  let received = Promise.withResolvers();
  server.server.on('upgrade', (_request, socket, head) => {
    t.after(() => socket.destroy());
    let input = head.toString();
    let check = () => { if (input.includes('client-head')) received.resolve(input); };
    socket.on('data', chunk => { input += chunk; check(); });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dyno-test\r\n\r\nserver-head');
    check();
  });
  let app = await gateway(t, { url: server.origin });
  let url = new URL(app.origin);
  let socket = createConnection({ host: url.hostname, port: Number(url.port) });
  t.after(() => socket.destroy());
  let response = Promise.withResolvers();
  let body = '';
  socket.on('error', response.reject);
  socket.on('data', chunk => { body += chunk; if (body.includes('server-head')) response.resolve(body); });
  await once(socket, 'connect');
  socket.write(`GET /socket HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: dyno-test\r\n\r\nclient-head`);
  assert.match(await response.promise, /^HTTP\/1.1 101/);
  assert.match(await received.promise, /client-head/);
});
