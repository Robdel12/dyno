import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

let name = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let visible = { name, args: [['firefox', 'webkit'].includes(name) ? '--headless' : '--headless=new'] };

test('tests and hooks outside describe fail with clear guidance before any test runs', { timeout: 90000 }, async t => {
  for (let [source, declaration] of [
    ["test('loose test', () => {});", 'test'],
    ["test.skip('loose skipped test');", 'test'],
    ["test.only('loose focused test', () => {});", 'test'],
    ["beforeEach(() => {}); describe('Contacts', () => test('saves', () => {}));", 'beforeEach'],
    ["afterEach(() => {}); describe('Contacts', () => test('saves', () => {}));", 'afterEach'],
    ["describe('Contacts', () => test('saves', () => {})); beforeEach(() => {});", 'beforeEach'],
  ]) {
    let fixture = await project(t, { source, config: { forbidOnly: false } });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    let error = result.events.find(event => event.type === 'fatal').error;
    assert.match(error.message, new RegExp(declaration + '\\(\\).*describe block'));
    assert.equal(result.events.some(event => event.type === 'start' || event.type === 'test'), false);
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  }
});

test('nested suites isolate file hooks and allow duplicate short names', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
import { sharedSetup } from '../../support.js';
await Promise.resolve();
describe('Workflow', () => {
beforeEach(({ app }) => app.request('/api/lifecycle', { method: 'POST', body: 'file.before' }));
afterEach(({ app }) => app.request('/api/lifecycle', { method: 'POST', body: 'file.after' }));
describe('Accounts', () => {
  sharedSetup();
  afterEach(({ app }) => app.request('/api/lifecycle', { method: 'POST', body: 'group.after' }));
  describe('nested', () => {
    test('saves', async ({ app, I }) => {
      await app.goto('/');
      await I.find('Fixture app').visible();
      await app.request('/api/lifecycle', { method: 'POST', body: 'one' });
    });
  });
});
describe('Projects', () => {
  test('saves', ({ app }) => app.request('/api/lifecycle', { method: 'POST', body: 'two' }));
});

});`,
    files: {
      'support.js': `import { beforeEach } from 'dyno'; export function sharedSetup() { beforeEach(({app}) => app.request('/api/lifecycle', {method:'POST', body:'group.before'})); }`,
      'tests/browser/z.test.js': `
import { describe, test, beforeEach } from 'dyno';
describe('Workflow', () => {
beforeEach(({app})=>app.request('/api/lifecycle',{method:'POST',body:'other.before'}));
describe('Accounts',()=>{
 test('saves',async({app,I})=>{
  let log=await(await app.request('/api/lifecycle')).json();
  await I.assert(()=>log.join(',')==='file.before,group.before,one,group.after,file.after,file.before,two,file.after,other.before','Hooks leaked across a file or suite');
 });
});
});`
    }
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 3);
  let outcomes = result.events.filter((event) => event.type === 'test');
  assert.equal(new Set(outcomes.map((event) => event.testId)).size, 3);
  assert.deepEqual(
    outcomes.map((event) => event.suites),
    [['Workflow', 'Accounts', 'nested'], ['Workflow', 'Projects'], ['Workflow', 'Accounts']]
  );
});

test('skip and only produce honest outcomes without running skipped hooks or bodies', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    config: { forbidOnly: false },
    source: `
describe('Workflow', () => {
beforeEach(({app})=>app.request('/api/lifecycle',{method:'POST',body:'entered'}));
test('excluded',()=>{throw new Error('Excluded test executed');});
describe.skip('Later',()=>{
 beforeEach(()=>{throw new Error('Skipped hook executed');});
 test('never executes',()=>{throw new Error('Skipped body executed');});
});
test.skip('pending work');
describe.only('Focused',()=>{
 test('runs',async({app,I})=>{
  let log=await(await app.request('/api/lifecycle')).json();
  await I.assert(()=>log.join(',')==='entered','Skipped tests ran hooks');
 });
});
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.skipped, 3);
  assert.equal(result.events.filter((event) => event.type === 'test' && event.status === 'skipped').length, 3);
});

test(
  'CI rejects focused definitions and async describe fails with an actionable error',
  { timeout: 90000 },
  async (t) => {
    for (let [source, message] of [
      ["describe('Workflow', () => {\ntest.only('focused',()=>{});\n});", /Focused tests are not allowed in CI/],
      ["describe('Workflow', () => {\ndescribe('async',async()=>{test('nested',()=>{});});\n});", /describe must be synchronous/]
    ]) {
      let fixture = await project(t, { config: { forbidOnly: true }, source });
      let result = await fixture.run().completion;
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.events.find((event) => event.type === 'fatal').error.message, message);
      assert.equal(
        result.events.some((event) => event.type === 'start'),
        false
      );
      await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
    }
  }
);

test(
  'file and suite selections run the requested test and explain ambiguous short names',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      source: `describe('Workflow', () => {
describe('Accounts',()=>test('saves',()=>{})); describe('Projects',()=>test('saves',()=>{}));
});`
    });
    let ambiguous = await fixture.run(['--test', 'saves']).completion;
    assert.equal(ambiguous.code, 1);
    assert.match(ambiguous.events.find((event) => event.type === 'fatal').error.message, /ambiguous/);
    let stillAmbiguous = await fixture.run(['--test', 'saves', '--file', 'workflow.test.js']).completion;
  assert.equal(stillAmbiguous.code, 1);
  assert.match(stillAmbiguous.events.find(event => event.type === 'fatal').error.message, /ambiguous/);
  let selected = await fixture.run(['--suite', 'Workflow › Accounts', '--file', 'workflow.test.js']).completion;
    assert.equal(selected.code, 0, selected.stdout + selected.stderr);
    assert.equal(selected.summary.passed, 1);
    assert.deepEqual(selected.events.find((event) => event.type === 'test').suites, ['Workflow', 'Accounts']);
  }
);

test('a stable ID reruns the same test after another definition is inserted', { timeout: 90000 }, async (t) => {
  let source = `describe('Workflow', () => {
describe('Identity',()=>test('keeps its target',({app})=>app.request('/api/lifecycle',{method:'POST',body:'target'})));
});`;
  let fixture = await project(t, { config: { browser: visible }, source });
  let session = fixture.run(['--ui']);
  let { url } = await session.waitForEvent('ready');
  let first = await session.waitForEvent('complete');
  let [run] = await (await fetch(url + 'results')).json();
  let original = run.tests[0];
  await writeFile(
    join(fixture.directory, 'tests/browser/workflow.test.js'),
    `import {describe,test} from 'dyno';describe('Inserted',()=>test('inserted',()=>{throw new Error('Wrong test selected');}));${source}`
  );
  let response = await fetch(url + 'control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: first.runId, command: 'rerun', ids: [original.id] })
  });
  assert.equal(response.status, 200);
  let second = await session.waitForEvent('complete', (event) => event.runId !== first.runId);
  assert.equal(second.passed, 1);
  assert.equal(second.failed, 0);
  let updated = (await (await fetch(url + 'results')).json()).find((item) => item.runId === second.runId);
  assert.equal(updated.tests[0].id, original.id);
  assert.notEqual(updated.tests[0].index, original.index);
  assert.deepEqual(await (await fetch(new URL('/api/lifecycle', url))).json(), ['target', 'target']);
});

test('runtime dispatch uses stable identity when registration order changes after discovery', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
describe('Workflow', () => {
if (localStorage.getItem('registered')) test('inserted during execution', () => {});
localStorage.setItem('registered', 'true');
test('target body', () => { throw new Error('The actual target ran'); });

});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.summary?.failed, 1, result.stdout + result.stderr);
  let outcome = result.events.find((event) => event.type === 'test');
  assert.equal(outcome.name, 'target body');
  assert.match(outcome.error.message, /The actual target ran/);
  assert.equal(outcome.testId, result.events.find((event) => event.type === 'start').tests[0].id);
});
