import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, reportPayload, claimAssignment } from '../helpers/project.js';

test(
  'the launched browser owns CLI completion even when a manual browser finishes first',
  { timeout: 90000, skip: process.platform === 'win32' },
  async (t) => {
    let fixture = await project(t, { source: `describe('Workflow', () => {
      test('owned workflow', async ({app,I}) => { await app.goto('/held-app'); await I.find('Fixture app').visible(); });
    });` });
    let session = fixture.run();
    let { url } = await session.waitForEvent('ready');
    await fetch(new URL('/api/navigation-requested', url), { signal: t.signal });
    let manual = await (await fetch(url + 'capture', { method: 'POST' })).json();
    let post = (event) =>
      fetch(url + 'events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: manual.runId, connectionKey: manual.connectionKey, ...reportPayload(event) })
      });
    assert.equal((await post({ type: 'start', tests: ['manual companion'] })).status, 200);
    let assignment = await claimAssignment(url, manual, 'manual-case');
    assert.equal((await post({ type: 'test', executionId: assignment.id, index: 0, name: 'manual companion', status: 'passed' })).status, 200);
    await post({ type: 'complete' });
    await fetch(new URL('/api/release-navigation', url), { method: 'POST', signal: t.signal });
    let result = await session.completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let owned = result.events.find((event) => event.type === 'capture' && event.owned);
    assert.ok(owned);
    assert.notEqual(owned.runId, manual.runId);
    assert.equal(result.events.findLast((event) => event.type === 'complete').runId, owned.runId);
    assert.equal(result.events.filter((event) => event.type === 'complete').length, 2);
  }
);
