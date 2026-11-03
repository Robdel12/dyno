import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { project } from '../helpers/project.js';
import { observeRun } from '../helpers/observer.js';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createCoordinator } from '../../src/coordinator.js';
import { createGateway } from '../../src/server.js';
import { createBrowserPool, resolveSession } from '../../src/browser-session.js';
import { createReportWriter } from '../../src/reports.js';

test('private gateways enforce worker ownership and finish their shared run exactly once', { timeout: 90000 }, async t => {
  let pool, gateways = [];
  t.after(async () => {
    try { await Promise.all(gateways.map(gateway => gateway.close())); }
    finally { await pool?.stop(); }
  });
  let fixture = await project(t);
  let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
  let bundle = await buildSuite(config);
  let saved = [], events = [], writer = createReportWriter(config.reportDir);
  let coordinator = createCoordinator(config, bundle, {
    workerIds: ['0', '1'], onEvent: event => events.push(event),
    onRun: async run => { saved.push(await writer.save(run)); },
  });
  pool = await createBrowserPool(await resolveSession(config.browser), { size: 2, signal: t.signal });
  let clients = [];
  for (let workerId of ['0', '1']) {
    let gateway = await createGateway(config, bundle, { coordinator, workerId });
    gateways.push(gateway);
    let browser = await pool.createWorker(workerId);
    gateway.attachSession(browser, 'launch-' + workerId);
    await browser.open(gateway.url + 'blank');
    let owner = await (await fetch(gateway.url + 'capture', {
      method: 'POST', body: JSON.stringify({ launchKey: 'launch-' + workerId }), signal: t.signal,
    })).json();
    clients.push({ owner, post: (route, input) => fetch(gateway.url + route, {
      method: 'POST', body: JSON.stringify({ ...owner, ...input }), signal: t.signal,
    }) });
  }
  assert.equal(clients[0].owner.runId, clients[1].owner.runId);
  let tests = ['First contact', 'Second contact'].map((name, index) => ({
    id: JSON.stringify(['workflow.js', 'Contacts', name]), file: 'workflow.js', suites: ['Contacts'], name, index, skipReason: null,
  }));
  for (let client of clients) assert.equal((await client.post('events', { type: 'start', tests })).status, 200);
  let assignments = [];
  for (let client of clients) assignments.push((await (await client.post('assignment', { requestId: 'next' })).json()).assignment);
  let output = text => [{ source: 'test', level: 'log', text, elapsed: 1 }];
  for (let [index, client] of clients.entries())
    assert.equal((await client.post('view', { sequence: 1, change: { set: { current: index }, tests: [
      { index, set: { status: 'running' }, output: { start: 0, entries: output('Owned ' + index) } },
    ] } })).status, 200);
  assert.equal((await clients[0].post('view', { sequence: 2, change: { set: { current: 1 }, tests: [] } })).status, 403);
  assert.equal((await clients[0].post('view', { sequence: 2, change: { set: {}, tests: [
    { index: 1, set: { status: 'running' } },
  ] } })).status, 403);
  assert.equal((await clients[0].post('events', {
    type: 'fatal', error: { message: 'Forged' }, partial: [{ id: tests[1].id, output: output('Forged peer output') }],
  })).status, 400);
  let observer = await observeRun(t, gateways[0].url + 'stream?run=' + clients[0].owner.runId);
  let view = await observer.until(view => view.tests.every(test => test.output.length === 1));
  assert.equal(view.current, 0, 'A peer cannot replace the selected worker’s current test.');
  assert.deepEqual(view.tests.map(test => test.output[0].text), ['Owned 0', 'Owned 1']);
  assert.equal((await clients[0].post('events', { type: 'test', workerId: '1', executionId: assignments[1].id,
    testId: tests[1].id, index: 1, name: tests[1].name, status: 'passed' })).status, 400);
  for (let [index, client] of clients.entries())
    assert.equal((await client.post('events', { type: 'test', executionId: assignments[index].id,
      testId: tests[index].id, index, name: tests[index].name, status: 'passed', output: output('Accepted ' + index) })).status, 200);
  assert.equal((await clients[0].post('events', { type: 'complete', duration: 1 })).status, 200);
  assert.equal(saved.length, 0, 'All workers must finish before the shared report is saved.');
  assert.equal((await clients[1].post('events', { type: 'complete', duration: 1 })).status, 200);
  assert.equal(saved.length, 1);
  assert.equal(events.filter(event => event.type === 'start').length, 1);
  assert.equal(events.filter(event => event.type === 'complete').length, 1);
  view = await observer.until(view => view.phase === 'completed');
  assert.deepEqual(view.tests.map(test => test.output[0].text), ['Accepted 0', 'Accepted 1']);
});
