import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project, repository } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let config = { host: 'localhost', viewport: { width: 800, height: 600 },
  webServer: { command: [process.execPath, join(repository, 'tests/fixtures/native-app-server.js')],
    ready: 'NATIVE_FIXTURE_READY' } };

async function savedReport(result) {
  let saved = result.events.findLast(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  return JSON.parse(await readFile(saved.json, 'utf8'));
}

test('repeated media changes and external-request guards preserve their original cleanup state', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config, source: `describe('Native state cleanup', () => {
    test('changes preferences repeatedly and blocks one external request', async ({app,I}) => {
      await app.goto('/');
      let original = {dark:app.window.matchMedia('(prefers-color-scheme: dark)').matches,
        reduced:app.window.matchMedia('(prefers-reduced-motion: reduce)').matches};
      localStorage.setItem('native-preferences',JSON.stringify(original));
      await app.native.setColorScheme('dark');
      await I.assert(()=>app.window.matchMedia('(prefers-color-scheme: dark)').matches);
      await app.native.setColorScheme('light');
      await I.assert(()=>app.window.matchMedia('(prefers-color-scheme: light)').matches);
      await app.native.setColorScheme('dark');
      await I.assert(()=>app.window.matchMedia('(prefers-color-scheme: dark)').matches);
      await app.native.setReducedMotion('reduce');
      await I.assert(()=>app.window.getComputedStyle(app.document.querySelector('#motion')).animationName==='none');
      await app.native.setReducedMotion('no-preference');
      await I.assert(()=>app.window.getComputedStyle(app.document.querySelector('#motion')).animationName==='native-motion');
      await app.native.setReducedMotion('reduce');
      await I.assert(()=>app.window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      await app.native.blockExternalRequests();await app.native.blockExternalRequests();
      let {url} = await (await app.request('/api/external-url')).json();let blocked=false;
      try{await app.window.fetch(url);}catch{blocked=true;}
      let requests=await app.native.blockedRequests();
      await I.assert(()=>blocked&&requests.length===1&&requests[0]===url,'External request was not recorded exactly once');
      let sameOrigin=await app.window.fetch('/api/status');await I.assert(()=>sameOrigin.ok);
    });
    test('restores original preferences and removes the network guard', async ({app,I}) => {
      await app.goto('/');let original=JSON.parse(localStorage.getItem('native-preferences'));
      await I.assert(()=>app.window.matchMedia('(prefers-color-scheme: dark)').matches===original.dark);
      await I.assert(()=>app.window.matchMedia('(prefers-reduced-motion: reduce)').matches===original.reduced);
      let requests=await app.native.blockedRequests();await I.assert(()=>requests.length===0);
      let {url}=await(await app.request('/api/external-url')).json();
      let response=await app.window.fetch(url);let value=await response.json();
      await I.assert(()=>response.ok&&value.revision>0,'The previous external request guard remained active');
    });
  });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let report = await savedReport(result);
  assert.deepEqual(report.tests.map(test => test.status), ['passed', 'passed']);
});

test('dialog mismatches and nested scopes keep confirmations intact and permit a later accepted confirmation', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config, source: `describe('Dialog contracts', () => {
    test('rejects a mismatched confirmation message', async ({app,I}) => {
      await app.goto('/');await I.click('Save note');await I.find('$(#saved)').text('Saved Robert');
      await app.native.withDialog({action:'accept',message:'A different confirmation'},()=>I.click('Remove saved note'));
    });
    test('rejects prompt input for a confirmation', async ({app,I}) => {
      await app.goto('/');
      await app.native.withDialog({action:'accept',text:'This is not a prompt'},()=>I.click('Remove saved note'));
    });
    test('dismisses a confirmation without deleting the note', async ({app,I}) => {
      await app.goto('/');
      let result=await app.native.withDialog({action:'dismiss',message:'Remove saved note?'},async()=>{
        await I.click('Remove saved note');return 'cancelled';
      });
      let records=await(await app.request('/api/records')).json();
      await I.assert(()=>result==='cancelled'&&records.length===1&&records[0].name==='Robert');
      await I.find('$(#removed)').text('');
    });
    test('rejects a nested scope while keeping its outer confirmation usable', async ({app,I}) => {
      await app.goto('/');let nestedError;
      let result=await app.native.withDialog({action:'dismiss'},async()=>{
        try{await app.native.withDialog({action:'accept'},()=>I.click('Remove saved note'));}
        catch(error){nestedError=error.message;}
        await I.click('Remove saved note');return 'outer scope completed';
      });
      await I.assert(()=>nestedError==='A native dialog scope is already active for this test.');
      await I.assert(()=>result==='outer scope completed');
      let records=await(await app.request('/api/records')).json();await I.assert(()=>records.length===1);
    });
    test('accepts a fresh confirmation after the earlier errors', async ({app,I}) => {
      await app.goto('/');
      await app.native.withDialog({action:'accept',message:'Remove saved note?'},async()=>{
        await I.click('Remove saved note');await I.find('$(#removed)').text('Removed');
      });
      let records=await(await app.request('/api/records')).json();await I.assert(()=>records.length===0);
    });
  });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let report = await savedReport(result);
  assert.deepEqual(report.tests.map(test => test.status), ['failed', 'failed', 'passed', 'passed', 'passed']);
  assert.match(report.tests[0].error.message, /message did not match: expected "A different confirmation", received "Remove saved note\?"/);
  assert.match(report.tests[1].error.message, /text can only be supplied for a prompt/);
  assert.ok(report.tests.slice(0, 2).every(test => test.error.phase === 'test'));
});

test('invalid native coordinates and duplicate authenticators do not prevent later real input and credentials', {
  timeout: 90000, skip: !['chromium', 'chrome', 'edge'].includes(browser),
}, async t => {
  let fixture = await project(t, { config, source: `describe('Native operation recovery', () => {
    test('rejects an out-of-viewport pointer', async ({app}) => {
      await app.goto('/');await app.native.move({x:app.window.innerWidth,y:0});
    });
    test('rejects a second active authenticator', async ({app}) => {
      await app.goto('/');await app.native.enableVirtualAuthenticator();await app.native.enableVirtualAuthenticator();
    });
    test('can create a credential and use real pointer input afterward', async ({app,I}) => {
      await app.goto('/');await app.native.disableVirtualAuthenticator();await app.native.enableVirtualAuthenticator();
      let credential=await app.window.navigator.credentials.create({publicKey:{
        challenge:app.window.crypto.getRandomValues(new Uint8Array(32)),
        rp:{id:app.window.location.hostname,name:'Native recovery'},
        user:{id:new Uint8Array([7,8,9]),name:'robert@example.test',displayName:'Robert'},
        pubKeyCredParams:[{type:'public-key',alg:-7}],
        authenticatorSelection:{residentKey:'required',userVerification:'required'},attestation:'none'
      }});
      await I.assert(()=>credential.type==='public-key'&&credential.id.length>0&&credential.response.clientDataJSON.byteLength>0);
      await app.native.disableVirtualAuthenticator();await app.native.disableVirtualAuthenticator();
      await I.find('$(#hover)').then.nativeHover();await I.find('$(#hover)').text('Pointer inside');
    });
  });` });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let report = await savedReport(result);
  assert.deepEqual(report.tests.map(test => test.status), ['failed', 'failed', 'passed']);
  assert.match(report.tests[0].error.message, /Native pointer coordinates must be inside the app viewport/);
  assert.match(report.tests[1].error.message, /virtual authenticator is already active/);
});
