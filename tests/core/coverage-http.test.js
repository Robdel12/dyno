import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { project } from '../helpers/project.js';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createGateway } from '../../src/server.js';
import { instrumentCoverage } from '../../src/coverage-instrument.js';

async function endpoint(t, enabled) {
  let fixture = await project(t, { config: { coverage: enabled } });
  let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
  let gateway = await createGateway(config, await buildSuite(config));
  t.after(() => gateway.close());
  let owner = await (await fetch(gateway.url + 'capture', { method: 'POST', signal: t.signal })).json();
  let post = (route, input, headers = {}) => fetch(gateway.url + route, { method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...owner, ...input }) });
  return { fixture, gateway, owner, post };
}

test('the coverage endpoint enforces enabled collection, owned executions, and the final report cutoff', { timeout: 15000 }, async t => {
  let disabled = await endpoint(t, false);
  let response = await disabled.post('coverage', { executionId: 'foreign', documentId: 'doc', sequence: 1, coverage: {} });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /coverage is disabled/);

  let { fixture, gateway, post } = await endpoint(t, true);
  let descriptor = { id: JSON.stringify(['test.js', 'Workflow', 'saves']), file: 'test.js', suites: ['Workflow'],
    name: 'saves', index: 0, resources: [], skipReason: null };
  assert.equal((await post('events', { type: 'start', tests: [descriptor] })).status, 200);
  let assignment = await (await post('assignment', { requestId: 'claim' })).json();
  let filename = join(fixture.directory, 'app.js');
  let output = instrumentCoverage({ code: 'globalThis.choose = () => 42; choose();', filename });
  let sandbox = {};
  runInNewContext(output.code, sandbox);
  let packet = { executionId: assignment.assignment.id, documentId: 'document', sequence: 1,
    coverage: JSON.parse(JSON.stringify(sandbox.__coverage__)) };
  assert.equal((await post('coverage', { ...packet, executionId: 'foreign' })).status, 409);
  assert.equal((await post('coverage', packet, { Origin: 'https://foreign.example' })).status, 400);
  assert.equal((await post('coverage', { ...packet, connectionKey: 'foreign' })).status, 403);
  assert.equal((await post('coverage', packet)).status, 200);
  assert.equal((await post('coverage', packet)).status, 200);
  let changed = structuredClone(packet);
  changed.coverage[filename].s[0]++;
  assert.equal((await post('coverage', changed)).status, 400);
  assert.equal((await post('events', { type: 'test', executionId: packet.executionId, testId: descriptor.id,
    index: 0, name: descriptor.name, status: 'passed', duration: 1 })).status, 200);
  assert.equal((await post('released', { requestId: 'release', executionId: packet.executionId })).status, 200);
  assert.equal((await post('coverage', { ...packet, sequence: 2 })).status, 409);
  assert.equal((await post('events', { type: 'complete', duration: 1 })).status, 200);
  let [saved] = await (await fetch(gateway.url + 'results', { signal: t.signal })).json();
  assert.equal(saved.outcomes[0].status, 'passed');
  assert.equal(saved.coverage.status, 'complete');
  assert.equal(saved.coverage.summary.functions.pct, 100);
  assert.equal((await post('coverage', { ...packet, sequence: 3 })).status, 409);
});
