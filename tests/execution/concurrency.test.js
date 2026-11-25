import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { project } from '../helpers/project.js';
import { observeRun } from '../helpers/observer.js';
import { openURL } from '../helpers/manual.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let visible = { name: browser, args: [['firefox', 'webkit'].includes(browser) ? '--headless' : '--headless=new'] };
let setup = await readFile(new URL('../fixtures/concurrent-setup.js', import.meta.url), 'utf8');

test('native workers overlap real saves with private apps and one canonical report', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, runTimeout: 15000, browser: visible, reportImages: true },
    files: { 'setup.js': setup },
    source: `await fetch('/registration');
    describe('Concurrent contacts',()=>{
      for(let name of ['First contact','Second contact'])test(name,async({app,I,fixtures,test})=>{
        await I.assert(()=>fixtures.shared==='Shared immutable build');
        await app.goto('/');await I.find('Worker '+fixtures.worker).visible();
        await I.find('Name').then.fill(test.name);await I.click('Save');
        await I.find('$([role=status])').text('Saved '+test.name);
        await app.screenshot('Contact saved');
        if(test.name==='First contact'){
          let paused=app.pause('Inspect the worker');
          let reporter;
          await I.assert(()=>!!(reporter=app.document.querySelector('#__dynoReporter'))?.contentDocument?.querySelector('.bay-select[data-worker]')&&!reporter.hidden);
          await new Promise(resolve=>{
            if(reporter.contentDocument.readyState==='complete')resolve();
            else reporter.addEventListener('load',resolve,{once:true});
          });
          let UI=I.scope(()=>reporter.contentDocument.body);
          let reporterDocument=reporter.contentDocument;
          // A pressed bay means the list is filtered to that worker. Showing every worker presses none.
          let pressed=()=>[...reporterDocument.querySelectorAll('.bay-select[aria-pressed=true]')].map(bay=>bay.dataset.worker).join();
          let filtered=id=>UI.assert(()=>pressed()===id,'Expected only worker '+id+' to be pressed');
          await filtered('');
          await UI.find('$(a[aria-label="Passed: Second contact"])').visible();
          let other=fixtures.worker==='0'?'1':'0';
          await UI.click('$(.bay-select[data-worker="'+other+'"])');
          await I.assert(()=>new URL(reporter.contentDocument?.querySelector('#standalone-reporter')?.href??reporter.src).searchParams.get('worker')===other);
          // Pressing a bay inspects that worker and filters to it; show every worker's rows again.
          await filtered(other);
          await UI.find('$(#worker-scope)').visible();
          await UI.click('Show every worker');
          await filtered('');
          await UI.find('$(a[aria-label="Running: First contact"])').visible();
          await UI.find('$(a[aria-label="Passed: Second contact"])').visible();
          await UI.click('$(.bay-select[data-worker="'+fixtures.worker+'"])');
          await I.assert(()=>new URL(reporter.contentDocument?.querySelector('#standalone-reporter')?.href??reporter.src).searchParams.get('worker')===fixtures.worker);
          await filtered(fixtures.worker);
          await UI.assert(()=>reporter.contentDocument===reporterDocument,'Switching workers should preserve the reporter document');
          await UI.click('$(#continue)');
          await paused;
        }
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  await session.waitForEvent('start');
  let discovering = await (await fetch(ready.url + 'results', { signal: t.signal })).json();
  assert.deepEqual(discovering[0].assignments, [], 'Dispatch waits for every worker catalog.');
  await fetch(new URL('/release-registration', ready.workers[1].url), { signal: t.signal });
  await session.waitForEvent('complete');
  // Each worker keeps its last test's app open for Show app, not just the worker that finished last.
  let [finished] = await (await fetch(ready.url + 'results', { signal: t.signal })).json();
  assert.deepEqual(finished.assignments.filter(item => item.status === 'retained').map(item => item.workerId).sort(), ['0', '1']);
  let saved = await session.waitForEvent('report-saved');
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  assert.equal(report.coordination.workers.length, 2);
  assert.equal(report.summary.duration, report.coordination.wallDuration);
  assert.equal(Object.hasOwn(report.performance, 'outsideTestsDuration'), false);
  assert.ok(report.coordination.workers.every(worker => ['executionDuration', 'handoffDuration', 'queueDuration', 'unassignedDuration', 'projectCleanupDuration']
    .every(key => Number.isFinite(worker[key]) && worker[key] >= 0)));
  for (let worker of ready.workers)
    for (let image of report.tests.flatMap(test => test.attachments)) {
      let response = await fetch(worker.url + 'artifacts/' + image.id, { signal: t.signal });
      assert.equal(response.status, 200);
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
    }
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.equal(result.events.filter(event => event.type === 'start').length, 1);
  assert.equal(result.events.filter(event => event.type === 'complete').length, 1);
  assert.equal(result.events.filter(event => event.type === 'report-saved').length, 1);
  let outcomes = result.events.filter(event => event.type === 'test');
  assert.equal(result.summary.failed, 0, JSON.stringify(outcomes.map(({ name, error }) => ({ name, error }))));
  assert.deepEqual(outcomes.map(event => event.status), ['passed', 'passed']);
  assert.equal(new Set(outcomes.map(event => event.workerId)).size, 2);
  assert.equal(new Set(outcomes.map(event => event.runId)).size, 1);
  assert.deepEqual(report.tests.map(test => test.name), ['First contact', 'Second contact']);
  assert.deepEqual(report.schedule.workers, ['0', '1']);
  let images = report.tests.flatMap(test => test.attachments);
  assert.equal(new Set(images.map(image => image.id)).size, 2);
  for (let outcome of outcomes) {
    let image = images.find(image => image.id === outcome.attachments[0].id);
    let png = PNG.sync.read(await readFile(join(saved.directory, image.path)));
    assert.deepEqual([...png.data.subarray(0, 4)], outcome.workerId === '0' ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  }
  let workers = JSON.parse(await readFile(join(fixture.directory, 'workers.json'), 'utf8'));
  assert.equal(new Set(workers.arrivals.map(arrival => arrival.worker)).size, 2);
  assert.equal(workers.drains.length, 2);
  assert.deepEqual(new Set(workers.drains.map(drain => drain.name)), new Set(['First contact', 'Second contact']));
});

test('resource reservations survive draining and global Pause across native workers', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Shared service',()=>{
      for(let name of ['Reserved first','Reserved second','Independent save'])test(name,async({app,I,test})=>{
        await app.goto('/');await I.find('Name').then.fill(test.name);await I.click('Save');
        await I.find('$([role=status])').text('Saved '+test.name);
      },{resources:name.startsWith('Reserved')?['shared-service']:[]});
    });`,
  });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  let { runId } = await session.waitForEvent('capture');
  await fetch(new URL('/drain-entered', ready.url), { signal: t.signal });
  await session.waitForEvent('test', event => event.name === 'Independent save');
  let [draining] = await (await fetch(ready.url + 'results', { signal: t.signal })).json();
  assert.equal(draining.assignments.some(assignment => assignment.testId.includes('Reserved second')), false);
  let first = draining.assignments.find(assignment => assignment.testId.includes('Reserved first'));
  assert.equal(first.status, 'reported');
  assert.deepEqual(first.resources, ['shared-service']);
  let command = command => fetch(ready.url + 'control', {
    method: 'POST', body: JSON.stringify({ runId, command }), signal: t.signal,
  });
  assert.equal((await command('pause')).status, 200);
  let observer = await observeRun(t, ready.url + 'stream?run=' + runId);
  await fetch(new URL('/release-drain', ready.url), { method: 'POST', signal: t.signal });
  await observer.until(view => view.phase === 'paused' && view.workers.every(worker => worker.phase === 'paused'));
  let [paused] = await (await fetch(ready.url + 'results', { signal: t.signal })).json();
  assert.equal(paused.outcomes.length, 2);
  assert.equal(paused.assignments.some(assignment => assignment.testId.includes('Reserved second')), false);
  assert.equal((await command('continue')).status, 200);
  let completed = await session.waitForEvent('complete');
  assert.equal(completed.passed, 3);
  assert.equal(completed.failed, 0);
  assert.equal((await session.stop()).code, 143);
});

test('a lost controller fails a persistent native run and preserves peer outcomes, images and partial output', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, cleanupTimeout: 500, reportImages: true, webServer: { env: { GATE: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Controller loss',()=>{
      for(let name of ['Loses its controller','Independent peer'])test(name,async({app,I,test})=>{
        await app.goto('/');await I.find('Name').then.fill(test.name);await I.click('Save');
        await I.find('$([role=status])').text('Saved '+test.name);
        if(test.name==='Independent peer')await app.screenshot('Preserved peer image');
        else{
          console.log('Acknowledged before controller loss');
          await app.request('/allow-close');await I.click('Close test controller');
          await new Promise(()=>{});
        }
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  let { runId, workerId } = await session.waitForEvent('capture');
  let worker = ready.workers.find(worker => worker.id === workerId);
  let observer = await observeRun(t, worker.url + 'stream?run=' + runId);
  await session.waitForEvent('test', event => event.name === 'Independent peer');
  await observer.until(view => view.tests.some(test => test.output.some(entry => entry.text.includes('Acknowledged before controller loss'))));
  await fetch(new URL('/release-close', ready.url), { method: 'POST', signal: t.signal });
  let result = await session.completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /lost its controller connection/);
  let saved = result.events.find(event => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  let peer = report.tests.find(test => test.name === 'Independent peer');
  let lost = report.tests.find(test => test.name === 'Loses its controller');
  assert.equal(report.status, 'interrupted');
  assert.equal(peer.status, 'passed');
  assert.equal(peer.attachments.length, 1);
  assert.equal(lost.status, 'not-run');
  assert.ok(lost.workerId);
  assert.ok(lost.executionId);
  assert.ok(lost.output.some(entry => entry.text.includes('Acknowledged before controller loss')));
  assert.equal(PNG.sync.read(await readFile(join(saved.directory, peer.attachments[0].path))).width, peer.attachments[0].width);
  assert.equal(result.events.filter(event => event.type === 'report-saved').length, 1);
  let stopped = result.events.filter(event => event.type === 'browser-stopped');
  assert.equal(stopped.length, 1);
  assert.equal(typeof stopped[0].graceful, 'boolean');
  let timing = JSON.parse(await readFile(saved.session, 'utf8'));
  assert.equal(timing.status, 'failed');
  assert.deepEqual(timing.browserCleanup, { graceful: stopped[0].graceful });
});

for (let mode of ['rerun', 'watch']) test(`managed ${mode} replaces the whole native group and preserves private project storage`, { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, webServer: { env: { GATE: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Managed generations',()=>{
      for(let name of ['First generation contact','Second generation contact'])test(name,async({app,I,test,fixtures})=>{
        await app.goto('/');await I.find('Worker '+fixtures.worker).visible();
        let count=Number(app.window.sessionStorage.getItem('visits')??0)+1;
        app.window.sessionStorage.setItem('visits',String(count));console.log('Worker visits: '+count);
        await I.find('Name').then.fill(test.name);await I.click('Save');
        await I.find('$([role=status])').text('Saved '+test.name);
      });
    });`,
  });
  let session = fixture.run(mode === 'watch' ? ['--watch'] : ['--ui']);
  let ready = await session.waitForEvent('ready');
  let first = await session.waitForEvent('complete');
  let firstOutcomes = session.events.filter(event => event.type === 'test' && event.runId === first.runId);
  assert.equal(first.passed, 2);
  assert.equal(new Set(firstOutcomes.map(event => event.workerId)).size, 2);
  if (mode === 'watch') {
    let path = join(fixture.directory, 'tests/browser/workflow.test.js');
    await writeFile(path, await readFile(path, 'utf8') + '\n// Updated while watching.\n');
  } else {
    let rerun = await fetch(ready.url + 'control', {
      method: 'POST', body: JSON.stringify({ runId: first.runId, command: 'rerun', ids: firstOutcomes.map(event => event.testId) }), signal: t.signal,
    });
    assert.equal(rerun.status, 200, await rerun.text());
  }
  let second = await session.waitForEvent('complete', event => event.runId !== first.runId);
  assert.equal(second.passed, 2);
  assert.equal(second.failed, 0);
  let results = session.events.filter(event => event.type === 'test' && event.runId === second.runId);
  assert.equal(new Set(results.map(event => event.workerId)).size, 2);
  assert.ok(firstOutcomes.every(event => event.output.some(entry => entry.text === 'Worker visits: 1')));
  assert.ok(results.every(event => event.output.some(entry => entry.text === 'Worker visits: 2')));
  let reports = session.events.filter(event => event.type === 'report-saved');
  assert.deepEqual(reports.map(event => event.runId), [first.runId, second.runId]);
  let [before, after] = await Promise.all(reports.map(async saved => JSON.parse(await readFile(saved.json, 'utf8'))));
  assert.deepEqual(after.tests.map(test => test.id), before.tests.map(test => test.id));
  assert.equal((await session.stop()).code, 143);
  let trace = JSON.parse(await readFile(join(fixture.directory, 'workers.json'), 'utf8'));
  assert.equal(trace.arrivals.length, 4);
  assert.equal(trace.drains.length, 4);
});

test('queue replay restores native worker queues, reports interrupted prefixes and rejects changed inputs', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Replay contacts',()=>{
      for(let name of ['Ada','Grace','Margaret','Katherine'])test(name,async({app,I,test})=>{
        await app.goto('/');await I.find('Name').then.fill(test.name);await I.click('Save');
        await I.find('$([role=status])').text('Saved '+test.name);
      });
    });`,
  });
  let original = await fixture.run(['--seed', 'recorded-queues']).completion;
  assert.equal(original.code, 0, original.stdout + original.stderr);
  let saved = original.events.find(event => event.type === 'report-saved');
  let manifest = JSON.parse(await readFile(saved.schedule, 'utf8'));
  assert.equal(manifest.version, 2);
  let replayed = await fixture.run(['--replay', saved.schedule]).completion;
  assert.equal(replayed.code, 0, replayed.stdout + replayed.stderr);
  assert.equal(replayed.summary.passed, 4);
  let replaySaved = replayed.events.find(event => event.type === 'report-saved');
  let replaySchedule = JSON.parse(await readFile(replaySaved.schedule, 'utf8'));
  for (let worker of manifest.workers)
    assert.deepEqual(replaySchedule.assignments.filter(item => item.workerId === worker).map(item => item.testId),
      manifest.assignments.filter(item => item.workerId === worker).map(item => item.testId));
  let prefix = { ...manifest, assignments: manifest.assignments.slice(0, 2).map(item => ({ ...item })) };
  prefix.assignments.at(-1).status = 'running';
  prefix.completion = manifest.completion.filter(id => prefix.assignments.some(item => item.testId === id && item.status !== 'running'));
  let prefixPath = join(fixture.directory, 'interrupted.json');
  await writeFile(prefixPath, JSON.stringify(prefix));
  let attempted = await fixture.run(['--replay', prefixPath]).completion;
  assert.equal(attempted.code, 0, attempted.stdout + attempted.stderr);
  assert.equal(attempted.summary.passed, 2);
  assert.deepEqual(attempted.events.find(event => event.type === 'ready').replay, { selected: 2, omitted: 2 });
  for (let args of [['--replay', saved.schedule, '--workers', '3'], ['--replay', saved.schedule, '--seed', 'changed']]) {
    let invalid = await fixture.run(args).completion;
    assert.equal(invalid.code, 1);
    assert.equal(invalid.events.some(event => event.type === 'ready'), false);
  }
  let foreign = structuredClone(manifest);
  foreign.assignments[0].workerId = '99';
  let foreignPath = join(fixture.directory, 'foreign-worker.json');
  await writeFile(foreignPath, JSON.stringify(foreign));
  let rejected = await fixture.run(['--replay', foreignPath]).completion;
  assert.equal(rejected.code, 1);
  assert.match(rejected.events.at(-1).message, /owned test assignments/);
  assert.equal(rejected.events.some(event => event.type === 'ready'), false);
  let changedCatalog = structuredClone(manifest);
  changedCatalog.catalog[0].resources = ['changed-resource'];
  let changedCatalogPath = join(fixture.directory, 'changed-catalog.json');
  await writeFile(changedCatalogPath, JSON.stringify(changedCatalog));
  let catalogFailure = await fixture.run(['--replay', changedCatalogPath]).completion;
  assert.equal(catalogFailure.code, 1, catalogFailure.stdout + catalogFailure.stderr);
  assert.match(catalogFailure.events.at(-1).message, /replay catalog changed/);
  assert.equal(catalogFailure.events.some(event => event.type === 'test'), false);
  let sourcePath = join(fixture.directory, 'tests/browser/workflow.test.js');
  await writeFile(sourcePath, await readFile(sourcePath, 'utf8') + '\n// Changed replay source.\n');
  let changed = await fixture.run(['--replay', saved.schedule]).completion;
  assert.equal(changed.code, 1);
  assert.match(changed.events.at(-1).message, /source fingerprint changed/);
  assert.equal(changed.events.some(event => event.type === 'ready'), false);
  assert.equal(changed.events.some(event => event.type === 'browser-stopped'), false, 'Changed source fails before browser acquisition.');
});

test('large selections rerun and replay without placing their catalog in launch URLs', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Large contact catalog',()=>{
      for(let index=0;index<8;index++)test(index+' '+${JSON.stringify('A detailed contact workflow '.repeat(90))},async({app,I})=>{
        await app.goto('/');await I.find('Name').then.fill('Contact '+index);await I.click('Save');
        await I.find('$([role=status])').text('Saved Contact '+index);
      });
    });`,
  });
  let session = fixture.run(['--ui', '--seed', 'large-catalog']);
  let ready = await session.waitForEvent('ready');
  let first = await session.waitForEvent('complete');
  assert.equal(first.passed, 8);
  let saved = session.events.find(event => event.type === 'report-saved' && event.runId === first.runId);
  let original = JSON.parse(await readFile(saved.schedule, 'utf8'));
  assert.ok(Buffer.byteLength(new URLSearchParams(original.selected.map(id => ['id', id])).toString()) > 16384);
  let rerun = await fetch(ready.url + 'control', {
    method: 'POST', body: JSON.stringify({ runId: first.runId, command: 'rerun', ids: original.selected }), signal: t.signal,
  });
  assert.equal(rerun.status, 200, await rerun.text());
  let second = await session.waitForEvent('complete', event => event.runId !== first.runId);
  assert.equal(second.passed, 8);
  assert.equal(second.failed, 0);
  assert.equal((await session.stop()).code, 143);
  let replay = await fixture.run(['--replay', saved.schedule]).completion;
  assert.equal(replay.code, 0, replay.stdout + replay.stderr);
  assert.equal(replay.summary.passed, 8);
  let launched = replay.events.find(event => event.type === 'ready');
  assert.ok(launched.workers.every(worker => worker.url.length < 1024));
  assert.deepEqual(launched.replay, { selected: 8, omitted: 0 });
  let replaySaved = replay.events.find(event => event.type === 'report-saved');
  let restored = JSON.parse(await readFile(replaySaved.schedule, 'utf8'));
  for (let worker of original.workers)
    assert.deepEqual(restored.assignments.filter(item => item.workerId === worker).map(item => item.testId),
      original.assignments.filter(item => item.workerId === worker).map(item => item.testId));
});

test('the reporter can run the next pull on fewer workers than were launched', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, autoRun: false, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Fewer workers', () => {
      for (let name of ['Ada', 'Grace', 'Margaret']) test(name, async ({app, I, fixtures}) => {
        await app.goto('/'); await I.find('Worker ' + fixtures.worker).visible();
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  let start = await session.waitForEvent('start');
  let page = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(start.runId), ready.url).href);
  await page.getByRole('heading', { name: 'Ready to run' }).waitFor();
  await page.locator('#run-options summary').click();
  await page.getByRole('combobox', { name: 'Workers per run' }).selectOption('1');
  await page.getByRole('button', { name: 'Run all' }).click();
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 3);
  let tests = session.events.filter(event => event.type === 'test');
  assert.deepEqual([...new Set(tests.map(event => event.workerId))], ['0']);
  await page.getByRole('heading', { name: 'All tests passed' }).waitFor();
});

test('pausing one worker lets it finish its test while the others keep running', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Held worker', () => {
      for (let index = 1; index <= 6; index++) test('step ' + index, async ({app}) => {
        await app.goto('/'); await app.request('/allow-close');
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  let capture = await session.waitForEvent('capture');
  let page = await openURL(t, capture.reporterURL);
  // Both workers wait on the gate inside their first test.
  await page.getByRole('button', { name: 'Pause worker 1' }).click();
  await page.getByRole('button', { name: 'Continue worker 1' }).waitFor();
  await fetch(new URL('/release-close', ready.workers[0].url), { signal: t.signal });
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 6);
  let byWorker = Object.groupBy(session.events.filter(event => event.type === 'test'), event => event.workerId);
  assert.equal(byWorker['1']?.length, 1, 'The held worker only finishes the test it had started.');
  assert.equal(byWorker['0'].length, 5);
});

test('auto workers run a single picked test on one worker', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, browser: visible, autoRun: false, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Auto workers', () => {
      for (let name of ['Ada', 'Grace']) test(name, async ({app, I, fixtures}) => {
        await app.goto('/'); await I.find('Worker ' + fixtures.worker).visible();
      });
    });`,
  });
  let session = fixture.run(['--ui']);
  let ready = await session.waitForEvent('ready');
  let start = await session.waitForEvent('start');
  let page = await openURL(t, new URL('/__dyno__/reporter?run=' + encodeURIComponent(start.runId), ready.url).href);
  await page.getByRole('heading', { name: 'Ready to run' }).waitFor();
  // Tests go to workers when a run starts, so there's no worker to filter to yet.
  let bay = id => page.locator(`.bay-select[data-worker="${id}"]`);
  assert.equal(await bay('0').isDisabled(), true);
  assert.equal(await bay('1').isDisabled(), true);
  await page.getByRole('button', { name: 'Run test Grace' }).click();
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 1);
  let joined = session.events.filter(event => event.type === 'capture' && event.runId === complete.runId);
  assert.deepEqual(joined.map(event => event.workerId), ['0'], 'Only one worker joins a one-test run.');
});
