import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { project } from '../helpers/project.js';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createGateway } from '../../src/server.js';
import { createReportWriter } from '../../src/reports.js';
import { acceptObserverFrame } from '../../src/browser/reporting.js';

let descriptors = (count) => Array.from({ length: count }, (_, index) => ({
  id: JSON.stringify(['tests/browser/workflow.test.js', 'Contacts', 'case ' + index]),
  file: 'tests/browser/workflow.test.js', suites: ['Contacts'], name: 'case ' + index,
  index: index * 3 + 2, skipReason: null,
}));
let output = (text) => [{ source: 'test', level: 'log', elapsed: 1, text }];

async function gateway(t, { save, expectCloseFailure = false } = {}) {
  let instance;
  t.after(async () => {
    if (!instance) return;
    if (expectCloseFailure) await assert.rejects(instance.close(), /Could not finish/);
    else await instance.close();
  });
  let fixture = await project(t);
  let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
  let writer = createReportWriter(config.reportDir), events = [], errors = [];
  instance = await createGateway(config, await buildSuite(config), {
    onRun: (run) => save ? save(run, writer) : writer.save(run),
    onEvent: (event) => events.push(event), onError: (error) => errors.push(error),
  });
  let owner = await (await fetch(instance.url + 'capture', { method: 'POST', signal: t.signal })).json();
  let post = (route, input) => fetch(instance.url + route, { method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...owner, ...input }) });
  return { ...instance, owner, post, config, events, errors };
}

async function observe(t, url) {
  let abort = new AbortController();
  let response = await fetch(url, { signal: AbortSignal.any([t.signal, abort.signal]) });
  assert.equal(response.status, 200);
  let reader = response.body.getReader(), decoder = new TextDecoder(), pending = '', observed;
  let phases = [];
  t.after(async () => { abort.abort(); await reader.cancel().catch(() => {}); });
  return {
    phases,
    async until(predicate) {
      while (true) {
        let end;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          let event = pending.slice(0, end);
          pending = pending.slice(end + 2);
          let type = /^event: (.+)$/m.exec(event)?.[1], data = /^data: (.+)$/m.exec(event)?.[1];
          if (!data || !['view-start', 'view-tests', 'snapshot', 'view-change'].includes(type)) continue;
          data = JSON.parse(data);
          observed = acceptObserverFrame(observed, type, data);
          if (!observed.pending) {
            phases.push(observed.view.phase);
            if (predicate(observed.view)) return observed.view;
          }
        }
        let chunk = await reader.read();
        assert.equal(chunk.done, false, 'Reporter disconnected before the requested view.');
        pending += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

test('HTTP reporting validates whole changes, replays exact acknowledgements, and persists canonical outcomes', { timeout: 15000 }, async t => {
  let entered = Promise.withResolvers(), release = Promise.withResolvers(), saves = 0;
  t.after(() => release.resolve());
  let app = await gateway(t, { save: async (run, writer) => {
    saves++;
    entered.resolve();
    await release.promise;
    return writer.save(run);
  } });
  let tests = descriptors(2);
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  let observer = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  await observer.until((view) => view.tests.length === 2);
  let change = { set: { current: 2 }, tests: [{ index: 2, set: { status: 'running' }, output: { start: 0, entries: output('Saving 🦖') } }] };
  assert.equal((await app.post('view', { sequence: 1, change })).status, 200);
  assert.equal((await app.post('view', { sequence: 1, change })).status, 200);
  assert.equal((await app.post('view', { sequence: 1, change: { set: {}, tests: [] } })).status, 409);
  assert.equal((await app.post('view', { sequence: 3, change })).status, 409);
  for (let invalid of [
    { set: { unknown: true }, tests: [] },
    { set: { phase: 'completed' }, tests: [] },
    { set: {}, tests: [{ index: 2, set: {} }, { index: 2, set: {} }] },
    { set: {}, tests: [{ index: 2, set: {}, output: null }] },
    { set: {}, tests: [{ index: 2, set: {}, output: { start: 1, entries: [{ source: 'foreign' }] } }] },
  ]) assert.equal((await app.post('view', { sequence: 2, change: invalid })).status, 400);
  let result = { type: 'test', testId: tests[0].id, index: 0, name: tests[0].name, status: 'passed', output: output('Saved 🦖'), duration: 2 };
  let replies = await Promise.all([app.post('events', result), app.post('events', result)]);
  assert.deepEqual(replies.map((reply) => reply.status), [200, 200]);
  assert.equal(app.events.filter((event) => event.type === 'test').length, 1);
  assert.equal((await app.post('events', { ...result, status: 'skipped', skipReason: 'Changed' })).status, 409);
  let late = { set: {}, tests: [{ index: 2, set: { status: 'running' }, output: { start: 0, entries: output('Stale') } }] };
  assert.equal((await app.post('view', { sequence: 2, change: late })).status, 200);
  assert.equal((await app.post('events', { ...result, testId: tests[1].id, index: 1, name: tests[1].name, output: [] })).status, 200);
  let completing = app.post('events', { type: 'complete', duration: 9 });
  await entered.promise;
  assert.equal(app.events.filter((event) => event.type === 'complete').length, 0, 'No successful completion before persistence.');
  let committing = await (await fetch(app.url + 'results', { signal: t.signal })).json();
  assert.equal(committing[0].status, 'running');
  let duringSave = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  let beforeSave = await duringSave.until((view) => view.tests.length === 2);
  assert.notEqual(beforeSave.phase, 'completed', 'Reporters cannot show completion before the writer succeeds.');
  release.resolve();
  assert.equal((await completing).status, 200);
  assert.equal((await app.post('events', { type: 'complete', duration: 9 })).status, 200);
  assert.equal(saves, 1);
  let final = await observer.until((view) => view.phase === 'completed');
  assert.equal(final.tests[0].status, 'passed');
  assert.deepEqual(final.tests[0].output, output('Saved 🦖'));
  let report = JSON.parse(await readFile(join(app.config.reportDir, app.owner.runId, 'run.json')));
  assert.deepEqual(report.tests.map((test) => test.id), tests.map((test) => test.id));
  assert.deepEqual(report.tests[0].output, final.tests[0].output);
});

test('an unread HTTP acknowledgement can be lost without duplicating its accepted result', { timeout: 15000 }, async t => {
  let app = await gateway(t), tests = descriptors(1);
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  let result = { type: 'test', testId: tests[0].id, name: tests[0].name, index: 0, status: 'passed', output: output('Saved once') };
  let headers = Promise.withResolvers();
  let request = httpRequest(app.url + 'events', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
    response.pause();
    headers.resolve(response.statusCode);
  });
  request.on('error', headers.reject);
  request.end(JSON.stringify({ ...app.owner, ...result }));
  assert.equal(await headers.promise, 200);
  request.destroy();
  assert.equal((await app.post('events', result)).status, 200);
  assert.equal(app.events.filter((event) => event.type === 'test').length, 1);
  assert.equal((await app.post('events', { type: 'complete' })).status, 200);
  let report = JSON.parse(await readFile(join(app.config.reportDir, app.owner.runId, 'run.json')));
  assert.equal(report.summary.passed, 1);
  assert.deepEqual(report.tests[0].output, output('Saved once'));
});

test('late reporters receive snapshots larger than 8 MB while an unread observer cannot block completion', { timeout: 20000 }, async t => {
  let app = await gateway(t), tests = descriptors(45);
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  let blocked = await fetch(app.url + 'stream?run=' + app.owner.runId, { signal: t.signal });
  t.after(() => blocked.body.cancel());
  let entries = Array.from({ length: 100 }, () => ({ source: 'test', level: 'log', elapsed: 1, text: '🦖'.repeat(1000) }));
  for (let [index, test] of tests.entries())
    assert.equal((await app.post('events', { type: 'test', testId: test.id, name: test.name, index, status: 'passed', output: entries })).status, 200);
  assert.equal((await app.post('events', { type: 'complete' })).status, 200);
  let reader = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  let final = await reader.until((view) => view.phase === 'completed');
  assert.ok(Buffer.byteLength(JSON.stringify(final)) > 8_000_000);
  assert.equal(final.tests.length, 45);
  assert.equal(final.tests[44].output[99].text, entries[99].text);
  assert.equal(app.events.filter((event) => event.type === 'complete').length, 1);
});

test('real report storage failure returns 503 and leaves the live run failed with accepted outcomes intact', { timeout: 15000 }, async t => {
  let app = await gateway(t), tests = descriptors(1);
  await mkdir(dirname(app.config.reportDir), { recursive: true });
  await writeFile(app.config.reportDir, 'This path is a file.');
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  assert.equal((await app.post('events', { type: 'test', index: 0, name: tests[0].name, testId: tests[0].id, status: 'passed', output: output('Saved') })).status, 200);
  let observer = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  assert.equal((await app.post('events', { type: 'complete' })).status, 503);
  assert.equal(app.events.some((event) => event.type === 'complete'), false);
  let view = await observer.until((view) => view.phase === 'error');
  assert.equal(observer.phases.includes('completed'), false);
  assert.match(view.error, /Could not save/);
  assert.equal(view.tests[0].status, 'passed');
  assert.deepEqual(view.tests[0].output, output('Saved'));
  assert.equal(app.errors.length, 1);
});

test('fatal output is canonical in live and saved reports, and late progress cannot change it', { timeout: 15000 }, async t => {
  let app = await gateway(t), tests = descriptors(1);
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  let change = { set: { current: 2 }, tests: [{ index: 2, set: { status: 'running' }, output: { start: 0, entries: output('Acknowledged output') } }] };
  assert.equal((await app.post('view', { sequence: 1, change })).status, 200);
  let retained = [...output('Acknowledged output'), ...output('Final unflushed output')];
  assert.equal((await app.post('events', { type: 'fatal', stopped: true, error: { message: 'Stopped by user' }, partial: [{ id: tests[0].id, output: retained }] })).status, 200);
  assert.equal((await app.post('view', { sequence: 2, change: { set: { phase: 'running' }, tests: [] } })).status, 409);
  assert.equal((await app.post('view', { sequence: 1, change })).status, 200);
  let observer = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  let view = await observer.until((view) => view.phase === 'stopped');
  let report = JSON.parse(await readFile(join(app.config.reportDir, app.owner.runId, 'run.json')));
  assert.deepEqual(view.tests[0].output, retained);
  assert.deepEqual(report.tests[0].output, retained);
  assert.equal(report.tests[0].status, 'not-run');
});

test('failed persistence after a user stop stays an error and never appears as a successful stop', { timeout: 15000 }, async t => {
  let app = await gateway(t), tests = descriptors(1);
  await mkdir(dirname(app.config.reportDir), { recursive: true });
  await writeFile(app.config.reportDir, 'Blocked');
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  assert.equal((await app.post('events', { type: 'fatal', stopped: true, error: { message: 'Stopped by user' }, partial: [{ id: tests[0].id, output: output('Preserved') }] })).status, 503);
  let observer = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  let view = await observer.until((view) => view.tests.length === 1);
  assert.equal(view.phase, 'error');
  assert.match(view.error, /Could not save/);
  assert.deepEqual(view.tests[0].output, output('Preserved'));
});

test('replacing a browser reports a real save failure instead of hiding it behind the replacement', { timeout: 15000 }, async t => {
  let app = await gateway(t, { expectCloseFailure: true }), tests = descriptors(1);
  await mkdir(dirname(app.config.reportDir), { recursive: true });
  await writeFile(app.config.reportDir, 'Blocked');
  assert.equal((await app.post('events', { type: 'start', tests })).status, 200);
  let change = { set: {}, tests: [{ index: 2, set: { status: 'running' }, output: { start: 0, entries: output('Before replacement') } }] };
  assert.equal((await app.post('view', { sequence: 1, change })).status, 200);
  let observer = await observe(t, app.url + 'stream?run=' + app.owner.runId);
  assert.equal((await app.post('capture', { previous: app.owner })).status, 200);
  let view = await observer.until((view) => view.phase === 'error');
  assert.match(view.error, /Could not save/);
  assert.deepEqual(view.tests[0].output, output('Before replacement'));
  assert.equal(app.errors.length, 1);
});

test('gateway shutdown rejects its real write failure and closes all HTTP connections', { timeout: 15000 }, async t => {
  let app = await gateway(t, { expectCloseFailure: true });
  await mkdir(dirname(app.config.reportDir), { recursive: true });
  await writeFile(app.config.reportDir, 'Blocked');
  await assert.rejects(app.close(), /Could not finish/);
  assert.equal(app.errors.length, 1);
  await assert.rejects(fetch(app.url + 'results', { signal: t.signal }));
});
