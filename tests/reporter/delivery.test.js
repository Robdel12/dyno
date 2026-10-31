import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';

let serviceWorker = (route) => `
  let claimed = new Promise(resolve => {
    if (parent.navigator.serviceWorker.controller) resolve();
    else parent.navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
  });
  await app.window.navigator.serviceWorker.register('/reporting-fault.js');
  let registration = await app.window.navigator.serviceWorker.ready;
  await claimed;
  let channel = new MessageChannel();
  let armed = new Promise(resolve => { channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; });
  registration.active.postMessage({ route: '${route}' }, [channel.port2]);
  await armed;
`;

test('lost live and result acknowledgements recover without rerunning browser actions', { timeout: 90000 }, async t => {
  for (let route of ['view', 'events']) {
    let fixture = await project(t, { source: `
      describe('Contact save', () => {
        test('save once after losing the ${route} acknowledgement', async ({ app, I }) => {
          await app.goto('/');
          ${serviceWorker(route)}
          console.log('Preparing a real contact save');
          ${route === 'view' ? `await app.request('/api/reporting-fault-seen');` : ''}
          await I.find('Name').then.fill('Robert');
          await I.click('Save');
          await I.find('$([role=status])').text('Saved Robert · 1');
        });
      });` });
    let result = await fixture.run().completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.events.filter((event) => event.type === 'test').length, 1);
    assert.match(result.stderr, new RegExp('REPORT_ACK_DROPPED ' + route));
    assert.equal(result.events.find((event) => event.type === 'test').output.filter((entry) => entry.text === 'Preparing a real contact save').length, 1);
  }
});

test('live reporting stays usable when the browser animation clock is suspended', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
    describe('Background reporting', () => {
      test('read the current output', async ({ app, I }) => {
        await app.goto('/');
        ${serviceWorker('clock')}
        let reporter = app.document.createElement('iframe');
        Object.assign(reporter.style, { position:'fixed', inset:'0', width:'100%', height:'100%', border:'0' });
        let loaded = new Promise(resolve => reporter.addEventListener('load', resolve, { once: true }));
        reporter.src = '/__dyno__/reporter?run=' + new URLSearchParams(location.search).get('run');
        app.document.body.append(reporter);
        await loaded;
        let UI = I.scope(() => reporter.contentDocument.body);
        await UI.find('$(#status)').text('Running 1 of 1 tests');
        console.log('Current output while animation frames are suspended');
        await UI.click('$(a[aria-label="Running: read the current output"])');
        await UI.find(/Current output while animation frames are suspended/).visible();
      });
    });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
});
