import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { project } from '../helpers/project.js';
import { inspectOfflineReport } from '../helpers/offline-report.js';
import { validTimings } from '../../src/browser/timings.js';

let browser = { name: process.env.DYNO_TEST_BROWSER ?? 'chromium' };

test('a developer can identify slow work in JSON, the live reporter, and an offline report', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: {
      'setup.js': 'export default () => ({ fixtures: { contact: "Robert" }, teardown() {} });',
      'tests/browser/contacts.js': `
import { defineInteractor } from 'dyno';
export let Contact = defineInteractor({ actions: {
  async save(name) {
    await this.find('$(input[name=name])').then.fill(name);
    await this.click('Save');
    await this.find('$([role=status])').text('Saved ' + name + ' · 1');
    return 'saved';
  },
} });`,
    },
    source: `
import { Contact } from './contacts.js';
describe('Workflow', () => {
beforeEach(async ({app,step}) => { await step('Open contacts', () => app.goto('/?token=never-record-this-query')); });
afterEach(async ({app,step}) => { await step('Reset contacts', () => app.request('/api/lifecycle', {method:'POST',body:'never-record-this-body'})); });
test('saves a contact', async ({app,I,step,fixtures}) => {
  let saved = await step('Save <contact>', () => Contact(I).save(fixtures.contact));
  await I.assert(() => saved === 'saved');
});
test('failed save', async ({step}) => { await step('Failed save', () => { throw new Error('Cannot save'); }); });
test('cancelled wait', async ({step}) => { await step('Waiting for save', () => new Promise(() => {})); }, {timeout:2000});
test('unawaited step', ({step}) => { step('Unfinished step', () => new Promise(() => {})); });
test.skip('later');
test('inspects the timings', async ({app,I}) => {
  let observer = app.document.createElement('iframe');
  Object.assign(observer.style,{position:'fixed',inset:'0',width:'390px',height:'844px',border:'0'});
  let loaded = new Promise(resolve => observer.addEventListener('load',resolve,{once:true}));
  observer.src='/__dyno__/reporter?run='+new URLSearchParams(location.search).get('run');
  app.document.body.append(observer); await loaded;
  let UI = new Interactor({root:()=>observer.contentDocument.body});
  await UI.click('$(#slow-tests summary)');
  await UI.assert(()=>observer.contentDocument.querySelector('#slow-test-list').textContent.includes('cancelled wait'));
  await UI.click('$(a[aria-label="Passed: saves a contact"])');
  await UI.click('Timings');
  await UI.find('$(#timings)').contains('Save <contact>');
  await UI.find('$(#timings)').contains('Setup hook');
  await UI.find('$(#timings)').contains('Cleanup hook');
  await UI.assert(()=>!observer.contentDocument.querySelector('contact'),'Timing label was inserted as HTML');
  await UI.assert(()=>observer.contentWindow.location.hash.endsWith('/timings'));
  await UI.assert(()=>observer.contentDocument.documentElement.scrollWidth<=390,'Timings overflow the mobile viewport');
});
});`
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.deepEqual([result.summary.passed, result.summary.failed, result.summary.skipped], [2, 3, 1], JSON.stringify(result.events.filter(event=>event.type==='test').map(event=>({name:event.name,error:event.error})),null,2));
  let saved = result.events.find(event => event.type === 'report-saved');
  let report = JSON.parse(await readFile(saved.json, 'utf8'));
  let contact = report.tests[0];
  assert.ok(validTimings(contact.timings));
  assert.equal(contact.duration, contact.timings.duration);
  assert.ok(['reset','beforeEach','test','afterEach','drain','navigation','request','step'].every(kind => contact.timings.entries.some(entry => entry.kind === kind)));
  assert.equal(report.tests[1].timings.entries.find(entry => entry.name === 'Failed save').status, 'failed');
  assert.equal(report.tests[2].timings.entries.find(entry => entry.name === 'Waiting for save').status, 'cancelled');
  assert.match(report.tests[3].error.message, /Await step\(\)/);
  assert.equal(report.tests[4].timings, undefined);
  assert.equal(report.tests[5].status, 'passed', result.stdout + result.stderr);
  let session = JSON.parse(await readFile(saved.session, 'utf8'));
  assert.ok(validTimings(session.timings));
  assert.equal(session.status, 'failed');
  for (let name of ['Project setup','Bundle tests','App server ready','Browser results','Cleanup','Stop browser','Stop app server','Project teardown','Save reports and close gateway'])
    assert.ok(session.timings.entries.some(entry => entry.name === name && entry.status === 'passed'), name);
  assert.deepEqual(result.events.find(event => event.type === 'session-timing').timings, session.timings);
  assert.doesNotMatch(JSON.stringify(contact.timings), /never-record-this/);
  assert.deepEqual(result.summary.performance, report.performance);
  assert.equal(new Set(report.performance.slowestTests.map(test => test.id)).size, report.performance.slowestTests.length);
  assert.deepEqual(await inspectOfflineReport(t, saved.html, browser, { timings: true }), {ok:true,images:0,overflow:false});
});
