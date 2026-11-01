import { openURL } from '../helpers/manual.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, reportPayload, claimAssignment } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let visibleConfig = {
  browser: { name: browser, args: [['firefox', 'webkit'].includes(browser) ? '--headless' : '--headless=new'] }
};
let observerFrame = `
let observer = app.document.createElement('iframe');
Object.assign(observer.style,{position:'fixed',inset:'0',width:'100%',height:'100%',border:'0',zIndex:'2147483647'});
let loaded = new Promise(resolve=>observer.addEventListener('load',resolve,{once:true}));
observer.src='/__dyno__/reporter?run='+new URLSearchParams(location.search).get('run');
app.document.body.append(observer); await loaded;
let UI = new Interactor({root:()=>observer.contentDocument.body});
`;

test(
  'the isolated reporter shows output and diagnostics without changing the actual app',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: visibleConfig,
      source: `
describe('Workflow', () => {
test('saves a contact with console output', async ({ app, I }) => {
  let getterReads = 0;
  let diagnostic = { attempt: 1 };
  Object.defineProperty(diagnostic, 'secret', {
    enumerable: true,
    get() {
      getterReads++;
      return 'private';
    }
  });
  diagnostic.self = diagnostic;
  console.log('Starting save workflow', diagnostic);
  await I.assert(() => getterReads === 0, 'Console evaluated an application getter');
  await app.goto('/');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 1');
  console.error('Diagnostic errors do not fail a passing test');
});
test('reports an actual assertion failure', async ({ app, I }) => {
  await app.goto('/');
  console.warn('Checking archived contact');
  await I.find('$([role=status])').text('Contact archived');
});
test('keeps the current app available for inspection', async ({ app, I }) => {
  await app.goto('/');
  await I.type('Route check').into('$(input[name=name])');
  let appDocument = app.document;
  let appWindow = app.window;
  let originalViewport = { width: appWindow.innerWidth, height: appWindow.innerHeight };
  await I.assert(() => appWindow.top === appWindow && appWindow.frameElement === null, 'The app must be a top-level document');
  let reporter;
  let inspect;
  let inspectReporter = async () => {
    reporter = appDocument.querySelector('#__dynoReporter');
    if (!reporter || reporter.hidden) return;
    if (!reporter.contentDocument?.querySelector('#main')) {
      reporter.addEventListener('load', inspectReporter, { once: true });
      return;
    }
    reporter.removeEventListener('load', inspectReporter);
    inspect.disconnect();
    try {
      let document = reporter.contentDocument;
      let UI = new Interactor({ root: () => document.body });
      let location = reporter.contentWindow.location;
      await UI.find('$(#status)').text('1 test failed');
      await UI.assert(
        () =>
          !document.querySelector('#overview').hidden &&
          document.querySelector('#output-panel').hidden,
        'Expected the reporter overview'
      );
      await UI.click('$(a[aria-label="Passed: saves a contact with console output"])');
      await UI.assert(() => location.hash === '#/tests/' + encodeURIComponent(JSON.stringify(['tests/browser/workflow.test.js','Workflow','saves a contact with console output'])) + '/output');
      await UI.assert(
        () =>
          document.querySelector('#output').textContent.includes('Starting save workflow') &&
          document.querySelector('#output').textContent.includes('Contact saved'),
        'Expected test and app console output'
      );
      await UI.click('Application');
      await UI.find('Run this test to inspect its app').visible();
      await UI.click('All tests');
      await UI.click('$(a[aria-label="Failed: reports an actual assertion failure"])');
      await UI.assert(
        () =>
          document.querySelector('#output').textContent.includes('Contact archived') &&
          document.querySelector('#output').textContent.includes('tests/browser/workflow.test.js'),
        'Expected assertion diagnostics and source location'
      );
      await UI.click('All tests');
      reporter.contentWindow.history.back();
      await UI.assert(
        () =>
          location.hash === '#/tests/' + encodeURIComponent(JSON.stringify(['tests/browser/workflow.test.js','Workflow','reports an actual assertion failure'])) + '/output' && !document.querySelector('#output-panel').hidden,
        'Expected the reporter overview'
      );
      reporter.contentWindow.history.forward();
      await UI.assert(() => location.hash === '#/' && !document.querySelector('#overview').hidden, 'Forward should restore the overview');
      await UI.find('$(#test-search)').then.focus();
      let sameOverview = new Promise((resolve) =>
        reporter.contentWindow.addEventListener('hashchange', resolve, { once: true })
      );
      location.hash = '';
      await sameOverview;
      await UI.find('$(#test-search)').focused();
      await UI.type('actual assertion').into('$(#test-search)');
      await UI.assert(
        () =>
          [...document.querySelectorAll('#results [data-test-id]')].filter((row) => !row.hidden).length === 1
      );
      await UI.click('$(a[aria-label="Failed: reports an actual assertion failure"])');
      await UI.click('All tests');
      await UI.find('$(#test-search)').visible();
      await UI.find('$(#test-search)').value('actual assertion');
      await UI.find('$(#test-search)').then.press('Delete', { replace: true });
      await UI.click('"Failed"$(button[data-filter])');
      await UI.assert(
        () =>
          [...document.querySelectorAll('#results [data-test-id]')].filter((row) => !row.hidden).length === 1
      );
      await UI.click('"All"$(button[data-filter])');
      await UI.click('$(a[aria-label="Passed: keeps the current app available for inspection"])');
      await UI.click('Application');
      await UI.find('$(#viewport)').value(originalViewport.width + 'x' + originalViewport.height);
      await UI.click('$(#show-app)');
      await UI.assert(() => reporter.hidden);
      await UI.assert(
        () =>
          appWindow.document === appDocument && appDocument.querySelector('input').value === 'Route check'
      );
      await UI.assert(
        () =>
          appDocument.defaultView.innerWidth === originalViewport.width && appDocument.defaultView.innerHeight === originalViewport.height,
        'Reporter navigation changed the app viewport'
      );
      let appUI = new Interactor({ root: () => appDocument.documentElement });
      await appUI.click('Show test results');
      await UI.assert(() => !reporter.hidden);
      document.querySelector('#main').focus();
      await UI.find('$(#main)').then.press('Escape');
      await UI.assert(() => reporter.hidden);
      await appUI.click('Show test results');
      await UI.assert(() => !reporter.hidden);
      location.hash = '/tests/999/output';
      await UI.find('Test not found').visible();
      await UI.click('$(#not-found .back-link)');
      await UI.find('$(#overview)').visible();
      await fetch('/api/inspection', { method: 'POST', body: JSON.stringify({ ok: true }) });
    } catch (error) {
      await fetch('/api/inspection', {
        method: 'POST',
        body: JSON.stringify({ error: error.message, stack: error.stack })
      });
    }
  };
  inspect = new appDocument.defaultView.MutationObserver(inspectReporter);
  inspect.observe(appDocument.documentElement, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden'] });
});

});`
    });
    let session = fixture.run(['--ui']);
    let { url } = await session.waitForEvent('ready');
    let complete = await session.waitForEvent('complete');
    let [run] = await (await fetch(url + 'results')).json();
    let outcomes = JSON.stringify(run.outcomes.map(({ name, status, error }) => ({ name, status, error })));
    assert.equal(complete.passed, 2, outcomes);
    assert.equal(complete.failed, 1, outcomes);
    let inspection = await (await fetch(new URL('/api/inspection', url), { signal: t.signal })).json();
    assert.deepEqual(inspection, { ok: true });
    assert.equal(run.outcomes[1].error.source.file, 'tests/browser/workflow.test.js');
    assert.ok(
      run.outcomes[0].output.some((entry) => entry.text.includes('[Getter]') && entry.text.includes('[Circular]'))
    );
    assert.ok(run.outcomes[0].output.some((entry) => entry.source === 'app' && entry.text.includes('Contact saved')));
  }
);

test('console output is bounded and malformed output cannot change a run', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `
describe('Workflow', () => {
test('logs bounded output', async ({ app, I }) => {
  await app.goto('/');
  for (let index = 0; index < 150; index++) console.log('message ' + index, 'x'.repeat(3000));
  await I.find('Fixture app').visible();
});

});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let outcome = result.events.find((event) => event.type === 'test');
  assert.equal(outcome.output.length, 100);
  assert.ok(outcome.output.every((entry) => entry.text.length <= 2000));
  let session = fixture.run(['--manual']);
  let { url } = await session.waitForEvent('ready');
  let { runId, connectionKey } = await (await fetch(url + 'capture', { method: 'POST' })).json();
  let post = (event) =>
    fetch(url + 'events', { method: 'POST', body: JSON.stringify({ runId, connectionKey, ...reportPayload(event) }) });
  assert.equal((await post({ type: 'start', tests: ['real reporter boundary'] })).status, 200);
  let assignment = await claimAssignment(url, { runId, connectionKey }, 'malformed-output');
  assert.equal(
    (
      await post({
        type: 'test',
        index: 0,
        name: 'real reporter boundary',
        executionId: assignment.id,
        status: 'passed',
        output: [{ level: 'log', source: 'foreign', text: 'bad', elapsed: 0 }]
      })
    ).status,
    400
  );
  let [run] = await (await fetch(url + 'results')).json();
  assert.deepEqual(run.outcomes, []);
});

test('a developer can stop an active run from the standalone reporter', { timeout: 90000 }, async (t) => {
  let fixture = await project(t, {
    source: `describe('Workflow', () => {

test('stops while the app is open', async ({ app }) => {
  await app.goto('/');
  ${observerFrame}
  await UI.find('Stop run').visible();
  await UI.click('Stop run');
  await new Promise(() => {});
});

});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.find((event) => event.type === 'fatal').error.message, /Run stopped from the reporter/);
  assert.equal(result.summary, undefined);
  await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
});

test(
  'pause on failure preserves the top-level app and unsupported resizing stays honest before Continue',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: visibleConfig,
      source: `describe('Workflow', () => {

test('pauses with the failed app', async ({ app, I }) => {
  await app.goto('/');
  ${observerFrame}
  await UI.find('$(#run-options)').visible();
  observer.contentDocument.querySelector('#run-options').open = true;
  await UI.click('$(#pause-on-failure)');
  await UI.assert(() => observer.contentDocument.querySelector('#pause-on-failure').checked);
  observer.remove();
  let appDocument = app.document;
  let originalViewport = { width: app.window.innerWidth, height: app.window.innerHeight };
  let reporter;
  let inspect;
  let inspectReporter = async () => {
    reporter = appDocument.querySelector('#__dynoReporter');
    if (!reporter || reporter.hidden) return;
    if (!reporter.contentDocument?.querySelector('#main')) {
      reporter.addEventListener('load', inspectReporter, { once: true });
      return;
    }
    reporter.removeEventListener('load', inspectReporter);
    inspect.disconnect();
    try {
      let UI = new Interactor({ root: () => reporter.contentDocument.body });
      await UI.find('$(#continue)').visible();
      await UI.click('$(#inspect-paused)');
      await UI.find('$(#viewport)').visible();
      await fetch('/api/lifecycle', {
        method: 'POST',
        body: 'inspected: ' + appDocument.querySelector('[role=status]').textContent
      });
      appDocument.defaultView.localStorage.setItem('inspected-viewport', JSON.stringify(originalViewport));
      let viewport = reporter.contentDocument.querySelector('#viewport');
      viewport.value = originalViewport.width === 390 && originalViewport.height === 844 ? '1280x800' : '390x844';
      viewport.dispatchEvent(new reporter.contentWindow.Event('change', { bubbles: true }));
      await UI.find('$(#command-status)').text('This browser cannot resize the application viewport. Resize its window manually or select a managed provider.');
      await UI.assert(() => appDocument.defaultView.innerWidth === originalViewport.width && appDocument.defaultView.innerHeight === originalViewport.height, 'An unsupported resize changed the app');
      await UI.assert(() => !reporter.contentDocument.querySelector('#continue').disabled, 'Resize failure should leave Continue usable');
      await UI.click('$(#continue)');
    } catch (error) {
      await fetch('/api/lifecycle', { method: 'POST', body: 'inspection error: ' + error.message });
    }
  };
  inspect = new appDocument.defaultView.MutationObserver(inspectReporter);
  inspect.observe(appDocument.documentElement, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden'] });
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 2');
});
test('continues with a fresh app', async ({ app, I }) => {
  await app.goto('/');
  let inspections = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => inspections.join(',') === 'inspected: Saved Robert · 1');
  await I.assert(
    () => { let size = JSON.parse(app.window.localStorage.getItem('inspected-viewport')); return app.window.innerWidth === size.width && app.window.innerHeight === size.height; },
    'Inspection changed the actual app viewport'
  );
  await I.assert(() => app.window.top === app.window && app.window.frameElement === null);
  await I.find('$(input[name=name])').value('');
  await I.find('$([role=status])').text('Ready');
});

});`
    });
    let session = fixture.run(['--manual']);
    let { url } = await session.waitForEvent('ready');
    await openURL(t, url);
    let result = await session.waitForEvent('complete');
    let runs = await (await fetch(url + 'results')).json();
    assert.equal(result.passed, 1, JSON.stringify(runs));
    assert.equal(result.failed, 1);
  }
);

test(
  'groups suites, preserves route filters, and reruns the chosen suite from the real reporter',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: visibleConfig,
      source: `
describe('Workflow', () => {
describe('Contacts',()=>{
  test('opens', async ({app,I})=>{await app.goto('/');await I.find('Fixture app').visible();});
  test.skip('later');
});
test('another workflow', async ({app,I})=>{
  await app.goto('/');
  let appDocument=app.document;
  let reporter;
  let inspect;
  let inspectReporter=async()=>{
    reporter=appDocument.querySelector('#__dynoReporter');
    if(!reporter||reporter.hidden)return;
    if(!reporter.contentDocument?.querySelector('#main')){
      reporter.addEventListener('load',inspectReporter,{once:true});
      return;
    }
    reporter.removeEventListener('load', inspectReporter);
    inspect.disconnect();
    try{
      let document=reporter.contentDocument;
      let UI=new Interactor({root:()=>document.body});
      let location=reporter.contentWindow.location;
      await UI.find('$(.group-heading h2)').text('tests/browser/workflow.test.js');
      await UI.find('$(.suite-heading h3)').text('Workflow › Contacts');
      await UI.find('$(#connection-state)').text('Connected to test browser');
      await UI.find('$(#capabilities)').text('Screenshots available');
      await UI.click('"Skipped"$(button[data-filter])');
      await UI.click('$(a[aria-label="Skipped: later"])');
      await UI.assert(()=>location.hash.includes('status=skipped') && location.hash.includes(encodeURIComponent(JSON.stringify(['tests/browser/workflow.test.js','Workflow','Contacts','later']))));
      await UI.find('Skipped: Skipped').visible();
      await UI.click('All tests');
      await UI.assert(()=>document.querySelector('button[data-filter=skipped]').getAttribute('aria-pressed')==='true');
      await UI.click('"All"$(button[data-filter])');
      await fetch('/api/inspection',{method:'POST',body:JSON.stringify({ok:true})});
      await UI.click('$(button[aria-label="Run suite Workflow › Contacts in tests/browser/workflow.test.js"])');
    }catch(error){await fetch('/api/inspection',{method:'POST',body:JSON.stringify({error:error.message})});}
  };
  inspect=new appDocument.defaultView.MutationObserver(inspectReporter);
  inspect.observe(appDocument.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:['hidden']});
});
});`
    });
    let session = fixture.run(['--ui']);
    let { url } = await session.waitForEvent('ready');
    let first = await session.waitForEvent('complete');
    let inspection = await (await fetch(new URL('/api/inspection', url), { signal: t.signal })).json();
    assert.deepEqual(inspection, { ok: true });
    let second = await session.waitForEvent('complete', (event) => event.runId !== first.runId);
    assert.equal(second.passed, 1);
    assert.equal(second.skipped, 1);
    let runs = await (await fetch(url + 'results')).json();
    assert.deepEqual(
      runs.at(-1).tests.map((test) => test.name),
      ['opens', 'later']
    );
  }
);
