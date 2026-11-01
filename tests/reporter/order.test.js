import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';
import { inspectOfflineReport } from '../helpers/offline-report.js';

test('a developer can find the run seed in the live and offline reporters', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { seed: 'issue-184' },
    source: `describe('Repeatable execution', () => {
      test('reads its run information', async ({app,I}) => {
        await app.goto('/');
        let frame = app.document.createElement('iframe');
        Object.assign(frame.style, {position:'fixed',inset:'0',width:'100%',height:'100%',border:'0'});
        let loaded = new Promise(resolve => frame.addEventListener('load',resolve,{once:true}));
        frame.src = '/__dyno__/reporter?run=' + new URLSearchParams(location.search).get('run');
        app.document.body.append(frame);
        await loaded;
        let UI = I.scope(() => frame.contentDocument.body);
        await UI.find('$(#status)').text('Running 1 of 1 tests');
        await UI.click('Run info');
        await UI.find('Seed: issue-184').visible();
      });
    });`,
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'report-saved');
  let inspected = await inspectOfflineReport(t, saved.html, { name: process.env.DYNO_TEST_BROWSER ?? 'chromium' }, { seed: 'issue-184' });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
});
