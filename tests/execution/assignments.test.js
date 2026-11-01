import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { project } from '../helpers/project.js';
import { observeRun } from '../helpers/observer.js';

let source = `describe('Independent contacts', () => {
  for (let name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'])
    test('saves ' + name, async ({ app, I }) => {
      await app.goto('/');
      await I.find('Name').then.fill(name);
      await I.click('Save');
      await I.find('$([role=status])').text('Saved ' + name + ' · 1');
    });
});`;

test('a runtime that expires during registration still retires its document and runs the next test', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `
      let parameters=new URLSearchParams(location.search);
      if(parameters.get('mode')==='test'&&parameters.get('test')==='0') {
        await fetch('/api/browser-waiting',{method:'POST'});
        await fetch('/api/release-browser');
      }
      describe('Registration timeout',()=>{
        test('expires before app binding',()=>{throw new Error('Unregistered body ran');},{timeout:5000});
        test('recovers with a real save',async({app,I})=>{
          await app.goto('/');await I.find('Name').then.fill('Recovered contact');
          await I.click('Save');await I.find('$([role=status])').text('Saved Recovered contact · 1');
        });
      });`,
  });
  let session = fixture.run();
  let { appURL } = await session.waitForEvent('ready');
  await fetch(new URL('/api/browser-waiting', appURL), { signal: t.signal });
  let failed = await session.waitForEvent('test', event => event.name === 'expires before app binding');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /exceeded 5000 ms/);
  await fetch(new URL('/api/release-browser', appURL), { method: 'POST', signal: t.signal });
  let result = await session.completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(result.summary, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.failed, 1);
});

test('seeded CLI runs record actual execution order while keeping report order stable', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source });
  let results = [];
  for (let args of [['--seed', 'issue-184'], ['--seed', 'issue-184'], ['--random']]) {
    let result = await fixture.run(args).completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.summary.passed, 6);
    let saved = result.events.find(event => event.type === 'report-saved');
    let report = JSON.parse(await readFile(saved.json));
    let schedule = JSON.parse(await readFile(saved.schedule));
    assert.deepEqual(report.schedule, schedule);
    assert.deepEqual(schedule.assignments.map(assignment => assignment.testId), schedule.priority);
    assert.deepEqual(schedule.completion, schedule.priority);
    assert.deepEqual(report.tests.map(test => test.name), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(name => 'saves ' + name));
    assert.ok((await readFile(saved.html, 'utf8')).includes('Seed: ' + schedule.seed));
    results.push(schedule);
  }
  assert.deepEqual(results[0].priority, results[1].priority);
  assert.equal(results[0].seed, 'issue-184');
  assert.notDeepEqual(results[0].priority, results[0].selected);
  assert.equal(typeof results[2].seed, 'string');
  assert.ok(results[2].seed.length);
});

let backgroundFiles = {
      'setup.js': `export default async function setup({config}) {
        return { drain: async ({signal}) => {
          let response = await fetch(config.webServer.url + '/drain', { method:'POST', signal });
          if (!response.ok) throw new Error(await response.text());
        }};
      }`,
      'app.js': `import {createServer} from 'node:http';
        let queued = Promise.withResolvers(), reloadReady = Promise.withResolvers();
        let trace = [], entered = Promise.withResolvers(), release = Promise.withResolvers(), pending;
        let server = createServer(async (request,response) => {
          let path = new URL(request.url,'http://localhost').pathname;
          if (path === '/queue') {
            trace.push('queued');
            pending = (async () => { await release.promise; trace.push('committed'); })();
            queued.resolve(); response.end('Queued');
          } else if (path === '/drain') {
            trace.push('drain-start'); entered.resolve();
            await pending; trace.push('drained'); response.end('drained');
          } else if (path === '/queued') { await queued.promise; response.end('queued'); }
          else if (path === '/reload-ready') { await reloadReady.promise; response.end('reload ready'); }
          else if (path === '/allow-reload') { reloadReady.resolve(); response.end('allowed'); }
          else if (path === '/drain-entered') { await entered.promise; response.end('entered'); }
          else if (path === '/release') { release.resolve(); response.end('released'); }
          else if (path === '/trace') {
            response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(trace));
          } else {
            if (path === '/next') trace.push('next');
            response.setHeader('Content-Type','text/html');
            response.end('<!doctype html><h1>Background saves</h1><button>Queue save</button><p role="status">Ready</p><button id="restart">Restart tests</button><script>document.querySelector("button").onclick=async()=>{document.querySelector("p").textContent=await(await fetch("/queue",{method:"POST"})).text()};document.querySelector("#restart").onclick=()=>window.open("",JSON.parse(window.name).controller).location.reload();</script>');
          }
        });
        server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('DRAIN_APP_READY'));
      `,
    };
let backgroundConfig = { setup: './setup.js', webServer: { command: [process.execPath, 'app.js'], ready: 'DRAIN_APP_READY' } };

test('real project cleanup joins background writes after document retirement and before the next assignment', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: backgroundConfig,
    files: backgroundFiles,
    source: `describe('Background saves', () => {
      test('queues a real background write', async ({app,I}) => {
        await app.goto('/'); await I.click('Queue save'); await I.find('$([role=status])').text('Queued');
      });
      test('starts after the previous write commits', async ({app,I}) => {
        await app.goto('/next'); await I.find('Background saves').visible();
        let trace = await (await app.request('/trace')).json();
        await I.assert(() => JSON.stringify(trace) === JSON.stringify(['queued','drain-start','committed','drained','next']));
      });
    });`,
  });
  let session = fixture.run();
  let { url } = await session.waitForEvent('ready');
  await fetch(new URL('/drain-entered', url), { signal: t.signal });
  let [running] = await (await fetch(url + 'results', { signal: t.signal })).json();
  assert.equal(running.outcomes.length, 1);
  assert.equal(running.assignments[0].status, 'reported');
  assert.deepEqual(await (await fetch(new URL('/trace', url), { signal: t.signal })).json(), ['queued', 'drain-start']);
  await fetch(new URL('/release', url), { method: 'POST', signal: t.signal });
  let result = await session.completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 2);
});

test('failed project cleanup preserves accepted user results and attachments without assigning another test', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import {readFile} from 'node:fs/promises';
      export default function setup({config}) {
        return { drain: () => readFile(config.root + '/missing-cleanup-marker') };
      }` },
    source: `describe('Cleanup failure', () => {
      test('saves a real contact', async ({app,I}) => {
        await app.goto('/'); await I.find('Name').then.fill('Robert'); await I.click('Save');
        await I.find('$([role=status])').text('Saved Robert · 1');
        console.log('Contact accepted before project cleanup');
        await app.screenshot('saved contact');
      });
      test('never starts after uncertain cleanup', () => { throw new Error('Unexpected next assignment'); });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  let report = JSON.parse(await readFile(saved.json));
  assert.deepEqual(report.tests.map(test => test.status), ['passed', 'not-run']);
  assert.equal(report.schedule.assignments.length, 1);
  assert.match(report.error.message, /Project execution cleanup failed.*missing-cleanup-marker/);
  assert.ok(report.tests[0].output.some(entry => entry.text === 'Contact accepted before project cleanup'));
  assert.equal(report.tests[0].attachments[0].status, 'captured');
  assert.equal((await readFile(saved.directory + '/' + report.tests[0].attachments[0].path)).readUInt32BE(0), 0x89504e47);
  assert.equal(result.events.some(event => event.type === 'test' && event.name === 'never starts after uncertain cleanup'), false);
});

test('an unfinished project drain reaches its cleanup deadline and cannot start another test', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', cleanupTimeout: 1000 },
    files: { 'setup.js': `export default function setup() {
      return { drain: ({signal}) => new Promise((resolve,reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {once:true});
      }) };
    }` },
    source: `describe('Project deadline', () => {
      test('finishes the user workflow', async ({app,I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });
      test('must remain unassigned', () => { throw new Error('Unexpected next assignment'); });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  let report = JSON.parse(await readFile(saved.json));
  assert.deepEqual(report.tests.map(test => test.status), ['passed', 'not-run']);
  assert.equal(report.schedule.assignments.length, 1);
  assert.match(report.error.message, /cleanup failed.*exceeded 1000 ms/);
});

test('assignment handoff stops both old documents before project drain while keeping the controller and app storage', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', webServer: { command: [process.execPath, 'app.js'], ready: 'DOCUMENT_APP_READY' } },
    files: {
      'setup.js': `export default function setup({config}) { return {
        drain: async ({signal}) => { let response=await fetch(config.webServer.url+'/drain',{signal});
          if(!response.ok)throw new Error(await response.text()); }
      }; }`,
      'app.js': `import {createServer} from 'node:http';
        let held=new Map(), arrived=Promise.withResolvers(), retired=[], writes=[];
        let server=createServer(async(request,response)=>{
          let url=new URL(request.url,'http://localhost');
          if(url.pathname==='/held'){
            let owner=url.searchParams.get('owner'), closed=Promise.withResolvers();
            response.once('close',()=>{retired.push(owner);closed.resolve()});
            held.set(owner,{response,closed:closed.promise});
            if(held.size===2)arrived.resolve();
          }else if(url.pathname==='/both'){await arrived.promise;response.end('both documents started requests')}
          else if(url.pathname==='/old-write'){writes.push(url.searchParams.get('owner'));response.end('written')}
          else if(url.pathname==='/drain'){
            await Promise.all([...held.values()].map(item=>item.closed));
            for(let item of held.values())item.response.end('released after retirement');
            response.end('drained');
          }else if(url.pathname==='/state'){
            response.setHeader('Content-Type','application/json');response.end(JSON.stringify({retired,writes}));
          }else{
            response.setHeader('Content-Type','text/html');
            response.end('<!doctype html><h1>Document app</h1><button>Begin old app request</button><script>document.querySelector("button").onclick=()=>fetch("/held?owner=app").then(()=>fetch("/old-write?owner=app"));</script>');
          }
        });
        server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('DOCUMENT_APP_READY'));`,
    },
    source: `describe('Document handoff',()=>{
      test('starts real work in each old document',async({app,I})=>{
        await app.goto('/');
        app.window.localStorage.setItem('owner','Robert');
        app.window.sessionStorage.setItem('owner','Robert');
        parent.controllerWitness='same companion';
        window.runtimeWitness='old runtime';
        void fetch('/held?owner=runtime').then(()=>fetch('/old-write?owner=runtime'));
        await I.click('Begin old app request');
        await app.request('/both');
      });
      test('receives fresh documents and retained storage',async({app,I})=>{
        await app.goto('/next'); await I.find('Document app').visible();
        await I.assert(()=>parent.controllerWitness==='same companion');
        await I.assert(()=>window.runtimeWitness===undefined);
        await I.assert(()=>app.window.localStorage.getItem('owner')==='Robert');
        await I.assert(()=>app.window.sessionStorage.getItem('owner')==='Robert');
        let state=await(await app.request('/state')).json();
        await I.assert(()=>JSON.stringify([...state.retired].sort())===JSON.stringify(['app','runtime']));
        await I.assert(()=>state.writes.length===0,'An old document resumed after handoff');
      });
    });`,
  });
  let result=await fixture.run().completion;
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.equal(result.summary.passed,2);
});

test('browser reload waits for the previous project drain before admitting a new run', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: backgroundConfig, files: backgroundFiles,
    source: `describe('Replacement',()=>{test('holds old background work',async({app,I})=>{
      await app.goto('/');await I.click('Queue save');await I.find('$([role=status])').text('Queued');
      await app.request('/reload-ready'); await I.click('Restart tests');
      await new Promise(()=>{});
    });});`,
  });
  let session = fixture.run(['--ui']);
  let { url, appURL } = await session.waitForEvent('ready');
  let first = await session.waitForEvent('capture');
  await fetch(new URL('/queued', appURL), { signal: t.signal });
  await writeFile(fixture.directory + '/tests/browser/workflow.test.js', `import {describe,test} from 'dyno';
    describe('Replacement',()=>{test('starts after old work commits',async({app,I})=>{
      await app.goto('/next');await I.find('Background saves').visible();
      let trace=await(await app.request('/trace')).json();
      await I.assert(()=>JSON.stringify(trace)===JSON.stringify(['queued','drain-start','committed','drained','next']));
    });});`);
  await fetch(new URL('/allow-reload', appURL), {method:'POST',signal:t.signal});
  await session.waitForEvent('joining', event => event.previousRunId === first.runId);
  await fetch(new URL('/drain-entered', appURL), { signal: t.signal });
  let runs = await (await fetch(url + 'results', { signal: t.signal })).json();
  assert.deepEqual(runs.map(run => run.runId), [first.runId], 'No replacement run while old writes are draining.');
  await fetch(new URL('/release', appURL), { method: 'POST', signal: t.signal });
  let second = await session.waitForEvent('capture', event => event.runId !== first.runId);
  let complete = await session.waitForEvent('complete', event => event.runId === second.runId);
  assert.equal(complete.passed, 1);
  assert.equal(complete.failed, 0);
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
});

test('Pause during project draining prevents the next assignment until Continue', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: backgroundConfig, files: backgroundFiles,
    source: `describe('Pause during handoff',()=>{
      test('queues a background save',async({app,I})=>{
        await app.goto('/');await I.click('Queue save');await I.find('$([role=status])').text('Queued');
      });
      test('continues after the requested pause',async({app,I})=>{
        await app.goto('/next');await I.find('Background saves').visible();
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let { url, appURL } = await session.waitForEvent('ready');
  let { runId } = await session.waitForEvent('capture');
  await fetch(new URL('/drain-entered', appURL), { signal: t.signal });
  let observer = await observeRun(t, url + 'stream?run=' + runId);
  let command = (value) => fetch(url + 'control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, command: value }), signal: t.signal,
  });
  assert.equal((await command('pause')).status, 200);
  await fetch(new URL('/release', appURL), { method: 'POST', signal: t.signal });
  await observer.until(view => view.phase === 'paused');
  let [run] = await (await fetch(url + 'results', { signal: t.signal })).json();
  assert.equal(run.assignments.length, 1, 'Pause holds new work even after a slow cleanup finishes.');
  assert.equal((await command('continue')).status, 200);
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 2);
  assert.equal(complete.failed, 0);
  await session.stop();
});

test('interrupt drains unfinished project work while its app server is still available', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: backgroundConfig, files: backgroundFiles,
    source: `describe('Interrupted project',()=>{test('holds a real background save',async({app,I})=>{
      await app.goto('/');await I.click('Queue save');await I.find('$([role=status])').text('Queued');
      await new Promise(()=>{});
    });});`,
  });
  let session = fixture.run();
  let { appURL } = await session.waitForEvent('ready');
  await fetch(new URL('/queued', appURL), { signal: t.signal });
  session.child.kill('SIGTERM');
  await fetch(new URL('/drain-entered', appURL), { signal: t.signal });
  await fetch(new URL('/release', appURL), { method: 'POST', signal: t.signal });
  let result = await session.completion;
  assert.equal(result.code, 143, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  let report = JSON.parse(await readFile(saved.json));
  assert.equal(report.tests[0].status, 'not-run');
  assert.doesNotMatch(report.error.message, /Project execution cleanup failed/);
  let timing = result.events.find(event => event.type === 'session-timing').timings.entries
    .find(entry => entry.name.includes('Project cleanup: Interrupted project'));
  assert.equal(timing.status, 'passed');
  await assert.rejects(fetch(appURL));
});

test('invalid project drain fails at startup and still tears down acquired setup resources', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import {writeFile} from 'node:fs/promises';
      export default function setup({config}) { return {
        drain:'not a function', teardown:()=>writeFile(config.root+'/setup-released','released')
      }; }` },
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /setup\.drain must be a function/);
  assert.equal(result.events.some(event => ['start', 'test', 'ready'].includes(event.type)), false);
  assert.equal(await readFile(fixture.directory + '/setup-released', 'utf8'), 'released');
});

test('trailing skips keep the last real app inspectable and drain its execution exactly once', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', forbidOnly: false },
    files: { 'setup.js': `import {appendFile} from 'node:fs/promises';
      export default function setup({config}) { return {
        drain:({test})=>appendFile(config.root+'/drains',test.name+'\\n')
      }; }` },
    source: `describe('Focus with trailing skips',()=>{
      describe.only('Selected',()=>{test('opens the real app',async({app,I})=>{
        await app.goto('/');await I.find('Fixture app').visible();
      },{resources:['clipboard']});});
      test('excluded sibling',()=>{throw new Error('Excluded body ran')});
      describe.skip('Later',()=>{
        beforeEach(()=>{throw new Error('Skipped hook ran')});
        test('pending work',()=>{throw new Error('Skipped body ran')});
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let { url } = await session.waitForEvent('ready');
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 1);
  assert.equal(complete.skipped, 2);
  let saved = await session.waitForEvent('report-saved');
  let report = JSON.parse(await readFile(saved.json));
  let retained = report.schedule.assignments.filter(assignment => assignment.status === 'retained');
  assert.equal(retained.length, 1);
  assert.equal(retained[0].testId, report.tests[0].id);
  assert.equal(report.schedule.assignments.at(-1).status, 'released');
  assert.deepEqual(report.tests.map(test => test.status), ['passed', 'skipped', 'skipped']);
  assert.equal(await readFile(fixture.directory + '/drains', 'utf8'), 'opens the real app\n');
  let observer = await observeRun(t, url + 'stream?run=' + complete.runId);
  let view = await observer.until(view => view.phase === 'completed');
  assert.equal(view.hasApp, true, 'The final real app remains available for inspection.');
  assert.equal(view.current, report.tests[0].index);
  await session.stop();
});

test('an entirely skipped focused selection does not run sibling bodies, hooks or project drains', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', forbidOnly: false },
    files: { 'setup.js': `import {appendFile} from 'node:fs/promises';
      export default function setup({config}) { return {
        drain:()=>appendFile(config.root+'/drains','unexpected drain')
      }; }` },
    source: `describe('Focused but pending',()=>{
      describe.only('Selected',()=>{test.skip('later');});
      describe('Unselected',()=>{
        beforeEach(()=>{throw new Error('Unselected hook ran')});
        test('must not run',()=>{throw new Error('Unselected body ran')});
      });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 0);
  assert.equal(result.summary.skipped, 2);
  let saved = result.events.find(event => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json));
  assert.deepEqual(report.schedule.assignments.map(assignment => assignment.status), ['released', 'released']);
  await assert.rejects(readFile(fixture.directory + '/drains'), { code: 'ENOENT' });
});
