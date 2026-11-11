import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project, repository } from '../helpers/project.js';
import { runURL } from '../helpers/manual.js';

let setup = join(repository, 'tests/fixtures/fixture-project.js');

test('named fixtures seed the owned app process and remain isolated through real UI writes', { timeout: 60000 }, async t => {
  let fixture = await project(t, {
    config: { setup, workers: 2 },
    source: `describe('Contacts',()=>{
      beforeEach(async({app,I,fixtures})=>{
        await I.assert(()=>typeof fixtures.execution==='string'&&fixtures.resetNumber>=1);
        let count=await app.fixture('users.count');
        await I.assert(()=>count===0);
      });
      for(let name of ['Alice','Bob','Carol','David'])test(name,async({app,I,fixtures})=>{
        let user=await app.fixture('users.create',{name});
        await I.assert(()=>user.process===fixtures.appProcess);
        await app.goto('/');
        await I.find(name).rendered();
        await I.find('Name').then.fill('Friend of '+name);
        await I.click('Save');
        await I.find('Friend of '+name).rendered();
        let persisted=await(await app.request('/api/users')).json();
        await I.assert(()=>persisted.length===2&&persisted.every(user=>user.name.includes(name)));
      });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let outcomes = result.events.filter(event => event.type === 'test');
  assert.equal(outcomes.length, 4);
  assert.ok(outcomes.every(event => event.status === 'passed'));
  assert.equal(new Set(outcomes.map(event => event.workerId)).size, 2);
  let saved = result.events.find(event => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  assert.ok(report.coordination.workers.every(worker => worker.projectPreparationDuration > 0));
  assert.ok(report.tests.every(test => test.timings.entries.some(entry => entry.name === 'Fixture users.create')));
  assert.doesNotMatch(JSON.stringify(report), /fixtureTransport|__dyno_fixtures__.*token|appProcess/);
});

test('a URL-only browser can prepare and seed its app without a managed driver', { timeout: 30000 }, async t => {
  let fixture = await project(t, {
    config: { setup },
    source: `describe('Manual contacts',()=>{
      for(let name of ['Alice','Bob'])test(name,async({app,I})=>{
        let count=await app.fixture('users.count');
        await I.assert(()=>count===0);
        await app.fixture('users.create',{name});
        await app.goto('/');
        await I.find(name).rendered();
      });
    });`,
  });
  let result = await runURL(t, fixture);
  assert.equal(result.summary?.passed, 2, result.stdout + result.stderr);
  assert.equal(result.summary.failed, 0);
});

test('unfinished fixture calls fail the browser test before the worker is drained', { timeout: 30000 }, async t => {
  let fixture = await project(t, {
    config: { setup },
    source: `describe('Fixture ownership',()=>{
      test('must await fixture work',({app})=>{ app.fixture('users.wait'); });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let outcome = result.events.find(event => event.type === 'test');
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error.message, /step|unfinished|await/i);
});
