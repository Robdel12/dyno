import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

let json = async path => JSON.parse(await readFile(path, 'utf8'));
async function evidence(result) {
  let event = result.events.find(event => event.type === 'repeat-complete');
  assert.ok(event, result.stdout + result.stderr);
  let batch = await json(event.json);
  let rounds = (await readFile(event.ledger, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  let schedules = await Promise.all(rounds.map(round => json(join(event.directory, round.schedule))));
  return { event, batch, rounds, schedules };
}

test('repeated selections reuse resources, prepare every execution and retain evidence beyond live history', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import {appendFile} from 'node:fs/promises';
      export default async function setup({config}) {
        let log=phase=>appendFile(config.root+'/lifecycle',phase+'\\n');await log('setup');let execution=0;
        return {beforeExecution:()=>({fixtures:{execution:++execution}}),drain:()=>log('drain'),teardown:()=>log('teardown')};
      }` },
    source: `describe('Repeated workflow',()=>{
      test('opens the app',async({app,I,fixtures})=>{
        await app.goto('/');await I.find('Fixture app').visible();
        let visits=Number(localStorage.getItem('visits')||0)+1;localStorage.setItem('visits',String(visits));
        await I.assert(()=>visits===fixtures.execution,'Storage and execution fixtures must survive each round');
        console.log('Visit '+visits);
      });
      test('unselected failure',()=>{throw new Error('Selection was lost')});
    });`
  });
  let result = await fixture.run(['--test', 'opens the app', '--repeat', '22']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let { event, batch, rounds } = await evidence(result);
  assert.equal(batch.status, 'passed');
  assert.equal(batch.completed, 22);
  assert.equal(batch.tests.length, 1);
  assert.equal(batch.tests[0].passed, 22);
  assert.equal(rounds.length, 22);
  assert.equal(new Set(rounds.map(round => round.runId)).size, 22);
  let lifecycle = (await readFile(join(fixture.directory, 'lifecycle'), 'utf8')).trim().split('\n');
  assert.equal(lifecycle.filter(item => item === 'setup').length, 1);
  assert.equal(lifecycle.filter(item => item === 'drain').length, 22);
  assert.equal(lifecycle.at(-1), 'teardown');
  let full = result.events.filter(event => event.type === 'report-saved');
  assert.equal(full.length, 1);
  let report = await json(full[0].json);
  assert.ok(report.tests[0].output.some(entry => entry.text.includes('Visit 22')));
  assert.equal((await readdir(join(event.directory, 'runs'))).length, 1);
});

test('a later passing round preserves the first failure, image and aggregate JUnit result', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `export default ()=>{let execution=0;return {
      beforeExecution:()=>({fixtures:{execution:++execution}})
    }};` },
    source: `describe('Checkout',()=>{test('confirms the order',async({app,I,fixtures})=>{
      await app.goto('/');await I.find('Fixture app').visible();
      await app.screenshot('Order');
      await I.assert(()=>fixtures.execution>1,'Order was not confirmed');
    });});`
  });
  let result = await fixture.run(['--repeat', '3', '--seed', 'checkout-race']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let { event, batch, rounds } = await evidence(result);
  assert.equal(batch.status, 'failed');
  assert.equal(batch.completed, 3);
  assert.equal(batch.failedRounds, 1);
  assert.equal(batch.tests[0].failed, 1);
  assert.equal(batch.tests[0].passed, 2);
  assert.equal(batch.firstFailure.round, 1);
  assert.match(event.prefixCommand, /--repeat 1 --seed 'checkout-race'/);
  let failed = await json(join(event.directory, 'runs', rounds[0].runId, 'run.json'));
  let image = failed.tests[0].attachments[0];
  assert.equal(image.status, 'captured');
  assert.ok((await readFile(join(event.directory, 'runs', rounds[0].runId, image.path))).length > 0);
  assert.equal((await readdir(join(fixture.directory, '.dyno/artifacts'))).filter(name => name.endsWith('.png')).length, 0);
  let junit = await readFile(event.junit, 'utf8');
  assert.equal((junit.match(/<failure /g) ?? []).length, 1);
  for (let round of [1, 2, 3]) assert.ok(junit.includes(`confirms the order (round ${round})`));
  assert.equal(result.events.filter(event => event.type === 'report-saved').length, 2);
});

test('a generated root reproduces varying round priorities and queue replay stays fixed', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `describe('Ordering',()=>{for(let name of ['Alpha','Bravo','Charlie','Delta'])
      test(name,async({app,I})=>{await app.goto('/');await I.find('Fixture app').visible()});});`
  });
  let first = await fixture.run(['--repeat', '4', '--random']).completion;
  assert.equal(first.code, 0, first.stdout + first.stderr);
  let original = await evidence(first);
  assert.equal(new Set(original.schedules.map(schedule => schedule.seed)).size, 4);
  let second = await fixture.run(['--repeat', '4', '--seed', original.batch.seed]).completion;
  assert.equal(second.code, 0, second.stdout + second.stderr);
  let reproduced = await evidence(second);
  assert.deepEqual(reproduced.schedules.map(schedule => [schedule.seed, schedule.priority]),
    original.schedules.map(schedule => [schedule.seed, schedule.priority]));
  let prefix = await fixture.run(['--repeat', '1', '--seed', original.batch.seed]).completion;
  assert.equal(prefix.code, 0, prefix.stdout + prefix.stderr);
  assert.deepEqual((await evidence(prefix)).schedules[0].priority, original.schedules[0].priority);
  let replay = await fixture.run(['--repeat', '2', '--replay', join(original.event.directory, original.rounds[1].schedule)]).completion;
  assert.equal(replay.code, 0, replay.stdout + replay.stderr);
  for (let schedule of (await evidence(replay)).schedules)
    assert.deepEqual(schedule.assignments.map(item => [item.workerId, item.testId]),
      original.schedules[1].assignments.map(item => [item.workerId, item.testId]));
});

test('interruption preserves accepted outcomes and admits no later round', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `describe('Interrupted repetition',()=>{test('finishes',async({app,I})=>{
      await app.goto('/');await I.find('Fixture app').visible();
    });test('waits on a real request',async({app})=>{
      await app.request('/api/browser-waiting',{method:'POST'});await app.request('/api/release-browser');
    });});`
  });
  let session = fixture.run(['--repeat', '10']);
  let ready = await session.waitForEvent('ready');
  await fetch(new URL('/api/browser-waiting', ready.appURL), { signal: t.signal });
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  let { batch } = await evidence(result);
  assert.equal(batch.status, 'interrupted');
  assert.equal(batch.completed, 0);
  assert.equal(batch.tests.find(test => test.name === 'finishes').passed, 1);
  assert.equal(batch.tests.find(test => test.name === 'waits on a real request').notRun, 1);
  assert.equal(result.events.filter(event => event.type === 'repeat-round').length, 1);
});

test('each automatic final document retires before project drain and the next round', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', cleanupTimeout: 2000,
      webServer: { command: [process.execPath, 'app.js'], ready: 'RETIRE_READY' } },
    files: {
      'setup.js': `import {appendFile} from 'node:fs/promises';export default({config})=>({drain:async({signal})=>{
        let response=await fetch(config.webServer.url+'/drain',{signal});
        await appendFile(config.root+'/drains',await response.text()+'\\n');
      }});`,
      'app.js': `import {createServer} from 'node:http';
        let entered=Promise.withResolvers(),retired=Promise.withResolvers(),held,visits=0,writes=0;
        let server=createServer(async(request,response)=>{
          if(request.url==='/held'){held=response;response.once('close',()=>retired.resolve());entered.resolve();}
          else if(request.url==='/entered'){await entered.promise;response.end('entered');}
          else if(request.url==='/late-write'){writes++;response.end('written');}
          else if(request.url==='/drain'){await retired.promise;held.end('released');response.end(JSON.stringify({retired:true,writes}));}
          else if(request.url==='/state'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({writes}));}
          else {response.setHeader('Content-Type','text/html');response.end('<h1>Retirement app</h1>'+(request.url==='/workflow'&&++visits===1?'<script>fetch("/held").then(()=>fetch("/late-write"))</script>':''));}
        });server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('RETIRE_READY'));`
    },
    source: `describe('Safe reuse',()=>{test('leaves no document work behind',async({app,I})=>{
      await app.goto('/workflow');await I.find('Retirement app').visible();await app.request('/entered');
      let state=await(await app.request('/state')).json();await I.assert(()=>state.writes===0);
    });});`
  });
  let result = await fixture.run(['--repeat', '2']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let drains = (await readFile(join(fixture.directory, 'drains'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(drains, [{ retired: true, writes: 0 }, { retired: true, writes: 0 }]);
  assert.equal((await evidence(result)).batch.completed, 2);
});

test('a failed project drain stops repetition without replacing accepted test outcomes', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `export default()=>({drain:()=>{throw new Error('Could not join project work')}});` }
  });
  let result = await fixture.run(['--repeat', '5']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let { batch } = await evidence(result);
  assert.equal(batch.status, 'interrupted');
  assert.equal(batch.tests[0].passed, 1);
  assert.equal(batch.tests[0].failed, 0);
  assert.match(batch.firstFailure.error.message, /Could not join project work/);
  assert.equal(result.events.filter(event => event.type === 'repeat-round').length, 1);
});

test('a later round gets its own result deadline and cannot admit another round after expiry', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', runTimeout: 3000 },
    files: { 'setup.js': `export default()=>{let execution=0;return {beforeExecution:()=>({fixtures:{execution:++execution}})}};` },
    source: `describe('Round deadlines',()=>{test('opens the app',async({app,I,fixtures})=>{
      await app.goto('/');await I.find('Fixture app').visible();
      if(fixtures.execution>1)await app.request('/api/release-browser');
    });});`
  });
  let result = await fixture.run(['--repeat', '5']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let { batch } = await evidence(result);
  assert.equal(batch.completed, 1);
  assert.equal(batch.status, 'interrupted');
  assert.match(batch.reason, /No complete browser result within 3000 ms/);
  assert.equal(result.events.filter(event => event.type === 'repeat-round').length, 2);
});

test('private workers keep their assignment ownership and drains across repeated runs', { timeout: 90000 }, async t => {
  let setup = await readFile(new URL('../fixtures/concurrent-setup.js', import.meta.url), 'utf8');
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Private workers',()=>{for(let name of ['Alpha','Bravo','Charlie','Delta'])test(name,async({app,I,fixtures})=>{
      await app.goto('/');await I.find('Worker '+fixtures.worker).visible();
      await I.find('Name').then.fill(name);await I.click('Save');await I.find('$([role=status])').text('Saved '+name);
    });});`
  });
  let result = await fixture.run(['--repeat', '3', '--seed', 'private-workers']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let { batch, schedules } = await evidence(result);
  assert.equal(batch.completed, 3);
  assert.ok(batch.tests.every(test => test.passed === 3));
  for (let schedule of schedules) {
    assert.deepEqual(schedule.workers, ['0', '1']);
    assert.equal(new Set(schedule.assignments.map(assignment => assignment.testId)).size, 4);
    assert.ok(schedule.assignments.every(assignment => assignment.status === 'released'));
  }
  let workers = await json(join(fixture.directory, 'workers.json'));
  assert.equal(workers.drains.length, 12);
  assert.equal(new Set(workers.arrivals.map(arrival => arrival.worker)).size, 2);
});

test('teardown failure remains visible even when an earlier round already failed', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `export default()=>{let execution=0;return {
      beforeExecution:()=>({fixtures:{execution:++execution}}),
      teardown:()=>{throw new Error('Could not release project resources')}
    }};` },
    source: `describe('Final cleanup',()=>{test('opens the app',async({app,I,fixtures})=>{
      await app.goto('/');await I.find('Fixture app').visible();await I.assert(()=>fixtures.execution>1,'First-round failure');
    });});`
  });
  let result = await fixture.run(['--repeat', '2']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let { batch } = await evidence(result);
  assert.equal(batch.completed, 2);
  assert.equal(batch.failedRounds, 1);
  assert.equal(batch.status, 'interrupted');
  assert.equal(batch.tests[0].failed, 1);
  assert.match(batch.reason, /Could not release project resources/);
});

test('interrupting after a failed round preserves the signal exit and the earlier failure', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `export default()=>{let execution=0;return {beforeExecution:()=>({fixtures:{execution:++execution}})}};` },
    source: `describe('Interrupted failure',()=>{test('retains its failure',async({app,I,fixtures})=>{
      if(fixtures.execution===1)throw new Error('First-round failure');
      await app.goto('/');await I.find('Fixture app').visible();
      await app.request('/api/browser-waiting',{method:'POST'});await app.request('/api/release-browser');
    });});`
  });
  let session = fixture.run(['--repeat', '10']);
  let ready = await session.waitForEvent('ready');
  await fetch(new URL('/api/browser-waiting', ready.appURL), { signal: t.signal });
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  let { batch } = await evidence(result);
  assert.equal(batch.status, 'interrupted');
  assert.equal(batch.completed, 1);
  assert.equal(batch.tests[0].failed, 1);
  assert.equal(batch.tests[0].notRun, 1);
  assert.equal(batch.firstFailure.round, 1);
  assert.equal(result.events.filter(event => event.type === 'repeat-round').length, 2);
});
