import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';

test('Interactor scopes compose, retain the current document, and isolate same-named fields', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
    test('edit contacts', async ({ app, I }) => {
      Interactor.defineAction('renameContact', function* (name) {
        yield this.find('Name').then.fill(name);
      });
      let work = I.scope('$(#work)');
      let personal = I.scope('$(#personal)');
      await app.goto('/interactor');
      await work.find('Name').then.fill('Robert');
      await work.find('$(output)').text('Robert');
      await personal.find('Name').value('');
      await work.scope('$(label)').find('$(input)').then.fill('Scoped twice');
      await work.find('Name').value('Scoped twice');
      await work.renameContact('A custom action');
      await work.find('Name').value('A custom action');
      await work.find('Seats').then.fill(12);
      await work.find('Seats').value('12');
      await work.find('Notes').then.fill('Storm notes');
      await work.find('Notes').value('Storm notes');
      await work.find('Notes').then.fill('');
      await work.find('Notes').value('');
      await app.goto('/interactor');
      await work.find('Name').then.fill('New document');
      await work.find('$(output)').text('New document');
      await personal.find('Name').value('');
      await I.find('Below the fold').rendered();
      await I.find('Below the fold').not.visible();
      await I.assert(() => app.window.scrollY === 0, 'Content checks must not scroll');
    });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
});

test('Interactor uploads files in the app realm and can clear the selection', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
    test('attach photos', async ({app,I}) => {
      await app.goto('/interactor');
      await I.find('Photos').then.upload({name:'first.txt',bytes:'First'}, {name:'second.txt',bytes:new TextEncoder().encode('Second'),type:'text/plain'});
      await I.find('$(#uploads)').text('first.txt: First, second.txt: Second');
      await I.find('Photos').then.upload();
      await I.find('$(#uploads)').text('');
    });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
});

test('missing Interactor scopes fail without finding a matching field outside the scope', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: { expectTimeout: 150 }, source: `
    test('missing contact', async ({app,I}) => {
      await app.goto('/interactor');
      await I.scope('$(#missing)').find('Name').then.fill('Wrong contact');
    });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1);
  assert.match(result.events.find(event => event.type === 'test').error.message, /missing/);
});

test('content checks respect transparent ancestors and become visible after a user action', { timeout: 90000 }, async t => {
  let fixture = await project(t, { source: `
    test('reveal notes', async ({app,I}) => {
      await app.goto('/interactor');
      let shadowNote = ({ $root }) => $root.querySelector('#shadow').shadowRoot.querySelector('p');
      await I.find('Private note').not.rendered();
      await I.find('Private note').not.visible();
      await I.find(shadowNote).not.rendered();
      await I.find('Faint control').rendered();
      await I.find('Faint control').not.visible();
      await I.click('Reveal note');
      await I.find('Private note').rendered();
      await I.find('Private note').visible();
      await I.find(shadowNote).rendered();
    });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary.passed, 1);
});

test('filling a read-only field fails instead of changing a value the user cannot edit', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: { expectTimeout: 150 }, source: `
    test('published contact', async ({app,I}) => {
      await app.goto('/interactor');
      await I.find('Published name').then.fill('Changed');
    });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1);
  assert.match(result.events.find(event => event.type === 'test').error.message, /read-only/);
});
