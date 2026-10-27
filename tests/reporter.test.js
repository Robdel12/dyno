import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from './helpers/project.js';

test('the reporter shows real app/test output, filters and selects results, and keeps failure diagnostics', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('saves a contact with console output', async ({app,I}) => {
  let getterReads = 0;
  let diagnostic = {attempt: 1};
  Object.defineProperty(diagnostic, 'secret', {enumerable: true, get() { getterReads++; return 'not for logging'; }});
  diagnostic.self = diagnostic;
  console.log('Starting save workflow', diagnostic);
  await I.assert(() => getterReads === 0, 'Console capture evaluated an application getter');
  await app.goto('/');
  await I.type('Robert').into('$(input[name=name])'); await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
  console.error('Diagnostic errors do not fail a passing test');
});
test('reports an actual assertion failure', async ({app,I}) => {
  await app.goto('/'); console.warn('Checking archived contact');
  await I.find('$([role=status])').text('Contact archived');
});
test('uses the reporter as a developer', async ({app,I}) => {
  await app.goto('/');
  let document = window.top.document;
  let UI = new Interactor({ root: () => document.body });
  await UI.assert(() => !document.querySelector('#overview').hidden && document.querySelector('#output-panel').hidden, 'The overview should show results without debugging panels');
  await I.assert(() => app.window.innerWidth === 1280 && app.window.innerHeight === 800, 'The overview changed the test viewport');
  await UI.click('$(a[aria-label="Passed: saves a contact with console output"])');
  await UI.assert(() => window.top.location.hash === '#/tests/0/output');
  await UI.assert(() => document.querySelector('#overview').hidden && !document.querySelector('#output-panel').hidden);
  await UI.assert(() => document.querySelector('#selected-name').textContent === 'saves a contact with console output');
  await UI.assert(() => document.querySelector('#output').textContent.includes('Starting save workflow'));
  await UI.assert(() => document.querySelector('#output').textContent.includes('Contact saved'));
  await UI.click('Application');
  await UI.assert(() => window.top.location.hash === '#/tests/0/app');
  await UI.find('Run this test to inspect its app').visible();
  await UI.assert(() => document.querySelector('#output-panel').hidden, 'Application view should not show output');
  await UI.click('All tests');
  await UI.click('$(a[aria-label="Failed: reports an actual assertion failure"])');
  await UI.assert(() => document.querySelector('#output').textContent.includes('Contact archived'));
  await UI.assert(() => document.querySelector('#output').textContent.includes('tests/browser/workflow.test.js'));
  await UI.click('All tests');
  window.top.history.back();
  await UI.assert(() => window.top.location.hash === '#/tests/1/output' && !document.querySelector('#output-panel').hidden, 'Browser back should reopen the failure');
  window.top.history.forward();
  await UI.assert(() => window.top.location.hash === '#/' && !document.querySelector('#overview').hidden);
  document.querySelector('#test-search').focus();
  await UI.type('actual assertion').into('$(#test-search)');
  await UI.assert(() => [...document.querySelectorAll('#results li')].filter(row => !row.hidden).length === 1);
  await UI.click('$(a[aria-label="Failed: reports an actual assertion failure"])');
  await UI.click('All tests');
  await UI.find('$(#test-search)').value('actual assertion');
  await UI.find('$(#test-search)').then.press('Delete', {replace: true});
  await UI.click('"Failed"$(button[data-filter])');
  await UI.assert(() => [...document.querySelectorAll('#results li')].filter(row => !row.hidden).length === 1);
  await UI.click('"All"$(button[data-filter])');
  await UI.click('$(a[aria-label="Running: uses the reporter as a developer"])');
  await UI.click('Application');
  await UI.assert(() => document.querySelector('#app-panel').dataset.active === 'true' && document.querySelector('#preview-empty').hidden);
  await I.type('Route check').into('$(input[name=name])');
  await UI.click('Output');
  await UI.click('Application');
  await I.find('$(input[name=name])').value('Route check');
  await I.assert(() => app.window.innerWidth === 1280 && app.window.innerHeight === 800, 'Switching routes changed the test viewport');
  await UI.click('All tests');
  await UI.assert(() => window.top.location.hash === '#/' && !document.querySelector('#overview').hidden);
  window.top.location.hash = '/tests/999/output';
  await UI.find('Test not found').visible();
  await UI.click('$(#not-found .back-link)');
  await UI.find('$(#overview)').visible();
});` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stderr + result.stdout);
  assert.equal(result.summary?.passed, 2, result.stderr + result.stdout);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.events.filter(event => event.type === 'capture').length, 1, 'Route changes should not start another capture');
  let saved = result.events.find(event => event.type === 'test' && event.index === 0);
  assert.ok(saved.output.some(entry => entry.source === 'test' && entry.text.includes('[Getter]') && entry.text.includes('[Circular]')));
  assert.ok(saved.output.some(entry => entry.source === 'app' && entry.text === 'Fixture app ready'));
  assert.ok(saved.output.some(entry => entry.source === 'app' && entry.text.includes('Contact saved')));
  assert.ok(saved.output.some(entry => entry.level === 'error'));
  let failed = result.events.find(event => event.type === 'test' && event.index === 1);
  assert.equal(failed.error.source.file, 'tests/browser/workflow.test.js');
  assert.ok(failed.error.source.code.includes("text('Contact archived')"));
  assert.ok(failed.output.some(entry => entry.level === 'warn' && entry.text === 'Checking archived contact'));
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('console output is bounded and malformed output cannot change a run', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('logs bounded output', async ({app,I}) => {
  await app.goto('/');
  for (let index = 0; index < 150; index++) console.log('message ' + index, 'x'.repeat(3000));
  await I.find('Fixture app').visible();
});` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let outcome = result.events.find(event => event.type === 'test');
  assert.equal(outcome.output.length, 100);
  assert.ok(outcome.output.every(entry => entry.text.length <= 2000));
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let { runId } = await (await fetch(url + 'capture', { method: 'POST' })).json();
  let post = event => fetch(url + 'events', { method: 'POST', body: JSON.stringify({ runId, ...event }) });
  assert.equal((await post({ type: 'start', tests: ['real reporter boundary'] })).status, 200);
  assert.equal((await post({ type: 'test', index: 0, name: 'real reporter boundary', status: 'passed', output: [{level: 'log', source: 'foreign', text: 'bad', elapsed: 0}] })).status, 400);
  let [run] = await (await fetch(url + 'results')).json();
  assert.deepEqual(run.outcomes, []);
});

test('a developer can stop an active run from the reporter', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
test('stops while the app is open', async ({app}) => {
  await app.goto('/');
  window.top.document.querySelector('#stop').click();
  await new Promise(() => {});
});` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.find(event => event.type === 'fatal').error.message, /Run stopped from the reporter/);
  assert.equal(result.summary, undefined);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('pause on failure keeps the failed app inspectable and Continue runs a fresh test', { timeout: 90000 }, async t => {
  let name = process.env.DYNO_TEST_BROWSER ?? 'chrome';
  let fixture = await project(t, { config: { browser: { name, args: [name === 'firefox' ? '--headless' : '--headless=new'] } }, source: `
test('pauses with the failed app', async ({app,I}) => {
  let document = window.top.document;
  document.querySelector('#run-options').open = true;
  document.querySelector('#pause-on-failure').click();
  document.querySelector('#run-options').open = false;
  // Drive the reporter after the assertion finishes, using its visible paused state.
  let observer = new window.top.MutationObserver(async () => {
    if (document.querySelector('#pause-banner').hidden) return;
    observer.disconnect();
    let opened = new Promise(resolve => window.top.addEventListener('hashchange', resolve, {once:true}));
    document.querySelector('#inspect-paused').click();
    await opened;
    let frame = document.querySelector('#frame > iframe:not([hidden])');
    let appDocument = frame.contentDocument.querySelector('iframe').contentDocument;
    let status = appDocument.querySelector('[role=status]').textContent;
    let viewport = document.querySelector('#viewport');
    viewport.value = '390'; viewport.dispatchEvent(new window.top.Event('change', {bubbles:true}));
    await fetch('/api/lifecycle', {method:'POST', body:'inspected: ' + status});
    document.querySelector('#continue').click();
  });
  observer.observe(document.querySelector('#pause-banner'), {attributes:true, attributeFilter:['hidden']});
  await app.goto('/');
  await I.type('Robert').into('$(input[name=name])'); await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 2');
});
test('continues with a fresh app', async ({app,I}) => {
  await app.goto('/');
  let inspections = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => inspections.join(',') === 'inspected: Saved Robert · 1', 'The paused app was not inspectable');
  await I.assert(() => app.window.innerWidth === 1280 && app.window.innerHeight === 800, 'Inspection viewport leaked into the next test');
  await I.find('$(input[name=name])').value('');
  await I.find('$([role=status])').text('Ready');
});` });
  let session = fixture.run(['--ui']);
  let complete = await session.waitForEvent('complete');
  assert.equal(complete.passed, 1);
  assert.equal(complete.failed, 1);
  let { url } = await session.waitForEvent('ready');
  let [run] = await (await fetch(url + 'results')).json();
  assert.equal(run.status, 'completed');
  assert.match(run.outcomes[0].error.message, /Saved Robert · 2/);
});
