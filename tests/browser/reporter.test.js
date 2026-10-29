import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, reportPayload } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chrome';
let visibleConfig = {
  viewport: { width: 1280, height: 800 },
  browser: { name: browser, args: [browser === 'firefox' ? '--headless' : '--headless=new'] }
};
let observerFrame = `
let observer = document.createElement('iframe');
Object.assign(observer.style,{position:'fixed',inset:'0',width:'100%',height:'100%',border:'0'});
let loaded = new Promise(resolve=>observer.addEventListener('load',resolve,{once:true}));
observer.src='/__dyno__/reporter?run='+new URLSearchParams(location.search).get('run');
document.body.append(observer); await loaded;
let UI = new Interactor({root:()=>observer.contentDocument.body});
`;

test(
  'the isolated reporter shows output and diagnostics without changing the actual app',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: visibleConfig,
      source: `
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
  await app.setViewport({ width: 900, height: 650 });
  await app.goto('/');
  await I.type('Route check').into('$(input[name=name])');
  let appDocument = app.document;
  let host = window.top.document;
  let reporter = host.querySelector('#reporter');
  await I.assert(() => !!reporter.contentDocument?.querySelector('#main'));
  let inspect = new window.top.MutationObserver(async () => {
    if (reporter.hidden) return;
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
      await UI.assert(() => location.hash === '#/tests/0/output');
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
          location.hash === '#/tests/1/output' && !document.querySelector('#output-panel').hidden,
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
          [...document.querySelectorAll('#results li')].filter((row) => !row.hidden).length === 1
      );
      await UI.click('$(a[aria-label="Failed: reports an actual assertion failure"])');
      await UI.click('All tests');
      await UI.find('$(#test-search)').visible();
      await UI.find('$(#test-search)').value('actual assertion');
      await UI.find('$(#test-search)').then.press('Delete', { replace: true });
      await UI.click('"Failed"$(button[data-filter])');
      await UI.assert(
        () =>
          [...document.querySelectorAll('#results li')].filter((row) => !row.hidden).length === 1
      );
      await UI.click('"All"$(button[data-filter])');
      await UI.click('$(a[aria-label="Passed: keeps the current app available for inspection"])');
      await UI.click('Application');
      await UI.find('$(#viewport)').value('900x650');
      await UI.click('$(#show-app)');
      await UI.assert(() => reporter.hidden);
      await UI.assert(
        () =>
          appDocument ===
            host.querySelector('#execution iframe').contentDocument.querySelector('iframe')
              .contentDocument && appDocument.querySelector('input').value === 'Route check'
      );
      await UI.assert(
        () =>
          appDocument.defaultView.innerWidth === 900 && appDocument.defaultView.innerHeight === 650,
        'Reporter navigation changed the app viewport'
      );
      let hostUI = new Interactor({ root: () => host.body });
      await hostUI.click('Show test results');
      await UI.assert(() => !reporter.hidden);
      document.querySelector('#main').focus();
      await UI.find('$(#main)').then.press('Escape');
      await UI.assert(() => reporter.hidden);
      await hostUI.click('Show test results');
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
  });
  inspect.observe(reporter, { attributes: true, attributeFilter: ['hidden'] });
});
`
    });
    let session = fixture.run(['--ui']);
    let { url } = await session.waitForEvent('ready');
    let complete = await session.waitForEvent('complete');
    assert.equal(complete.passed, 2);
    assert.equal(complete.failed, 1);
    let inspection = await (await fetch(new URL('/api/inspection', url), { signal: t.signal })).json();
    assert.deepEqual(inspection, { ok: true });
    let [run] = await (await fetch(url + 'results')).json();
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
test('logs bounded output', async ({ app, I }) => {
  await app.goto('/');
  for (let index = 0; index < 150; index++) console.log('message ' + index, 'x'.repeat(3000));
  await I.find('Fixture app').visible();
});
`
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
  assert.equal(
    (
      await post({
        type: 'test',
        index: 0,
        name: 'real reporter boundary',
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
    source: `
test('stops while the app is open', async ({ app }) => {
  await app.goto('/');
  ${observerFrame}
  await UI.find('Stop run').visible();
  await UI.click('Stop run');
  await new Promise(() => {});
});
`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.find((event) => event.type === 'fatal').error.message, /Run stopped from the reporter/);
  assert.equal(result.summary, undefined);
  await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
});

test(
  'pause on failure preserves the failed app and Continue starts a fresh viewport',
  { timeout: 90000 },
  async (t) => {
    let fixture = await project(t, {
      config: visibleConfig,
      source: `
test('pauses with the failed app', async ({ app, I }) => {
  await app.goto('/');
  ${observerFrame}
  await UI.find('$(#run-options)').visible();
  observer.contentDocument.querySelector('#run-options').open = true;
  await UI.click('$(#pause-on-failure)');
  await UI.assert(() => observer.contentDocument.querySelector('#pause-on-failure').checked);
  observer.remove();
  let host = window.top.document;
  let reporter = host.querySelector('#reporter');
  let appDocument = app.document;
  let inspect = new window.top.MutationObserver(async () => {
    if (reporter.hidden) return;
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
      appDocument.defaultView.addEventListener(
        'resize',
        () =>
          appDocument.defaultView.localStorage.setItem(
            'inspected-width',
            String(appDocument.defaultView.innerWidth)
          ),
        { once: true }
      );
      let viewport = reporter.contentDocument.querySelector('#viewport');
      viewport.value = '390x844';
      viewport.dispatchEvent(new reporter.contentWindow.Event('change', { bubbles: true }));
      reporter.contentDocument.querySelector('#continue').click();
    } catch (error) {
      await fetch('/api/lifecycle', { method: 'POST', body: 'inspection error: ' + error.message });
    }
  });
  inspect.observe(reporter, { attributes: true, attributeFilter: ['hidden'] });
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Saved Robert · 2');
});
test('continues with a fresh app', async ({ app, I }) => {
  await app.goto('/');
  let inspections = await (await app.request('/api/lifecycle')).json();
  await I.assert(() => inspections.join(',') === 'inspected: Saved Robert · 1');
  await I.assert(
    () => app.window.localStorage.getItem('inspected-width') === '390',
    'Inspection resize did not finish before Continue'
  );
  await I.assert(() => app.window.innerWidth === 1280 && app.window.innerHeight === 800);
  await I.find('$(input[name=name])').value('');
  await I.find('$([role=status])').text('Ready');
});
`
    });
    let session = fixture.run(['--ui']);
    let { url } = await session.waitForEvent('ready');
    let result = await session.waitForEvent('complete');
    let runs = await (await fetch(url + 'results')).json();
    assert.equal(result.passed, 1, JSON.stringify(runs));
    assert.equal(result.failed, 1);
  }
);
