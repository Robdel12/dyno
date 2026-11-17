import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { project } from '../helpers/project.js';
import { openURL } from '../helpers/manual.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let appServer = `import {createServer} from 'node:http';
let created = null;
let client = ${JSON.stringify(`
let root = document.querySelector('#surface').attachShadow({mode:'open'});
root.innerHTML = '<style nonce="api-nonce">:host{display:block;width:200px;height:100px;background:rgb(20,150,80)}button{width:200px;height:40px}input{caret-color:rgb(200,30,50)}</style><button><span>Shadow action</span></button><input aria-label="Shadow note">';
let button = root.querySelector('button');
button.addEventListener('mouseenter', () => document.querySelector('output').textContent = 'Pointer inside');
button.addEventListener('mouseleave', () => document.querySelector('output').textContent = 'Pointer outside');
document.querySelector('#values').onclick = () => {
  let reads = 0;
  let state = {name:'Contact'}; state.self = state;
  let getters = Object.defineProperty({}, 'secret', {enumerable:true,get(){reads++;throw new Error('Do not invoke getters while logging');}});
  console.log('debug values', 42n, function save(){}, function(){}, new Error('Save failed'), new Error(),
    [1,{deep:[2]}], {deep:{nested:{value:1}},items:[[1]]}, state, getters);
  console.log(new Proxy({}, {ownKeys(){throw new Error('Unavailable proxy target');}}));
  console.log('large value', 'x'.repeat(2500));
  document.querySelector('output').textContent = reads === 0 ? 'Logged safely' : 'Getter invoked';
};
document.querySelector('#burst').onclick = () => {
  for(let index=0;index<20;index++) console.log('app burst', index);
  document.querySelector('output').textContent = 'Burst completed';
};
document.querySelector('#attachment').onchange = async event => {
  let file = event.currentTarget.files[0];
  document.querySelector('#uploads').textContent = file.name + ': ' + await file.text();
};
`)};
let server = createServer(async (request,response) => {
  if(request.url === '/client.js') {response.writeHead(200,{'Content-Type':'text/javascript'});response.end(client);return;}
  if(request.url === '/ping') {response.end('Connected');return;}
  if(request.url === '/app-fixtures/call') {
    let chunks=[];for await(let chunk of request)chunks.push(chunk);
    let input=JSON.parse(Buffer.concat(chunks).toString());
    if(input.name==='contacts.noContent'){response.writeHead(204);response.end();return;}
    created=input.input.name;response.writeHead(200,{'Content-Type':'application/json'});
    response.end(JSON.stringify({value:{name:created}}));return;
  }
  let strict = request.url === '/strict';
  response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store',
    'Content-Security-Policy':"script-src 'self' 'nonce-api-nonce'; style-src " + (strict ? "'none'" : "'nonce-api-nonce'")});
  response.end('<!doctype html><html><head><style nonce="api-nonce">body{margin:0}h1{height:40px;margin:0}#covered,#cover{position:absolute;top:250px;left:10px;width:200px;height:60px}#cover{background:white;z-index:2}#below{position:absolute;top:1000px;left:10px;width:50px;height:50px}#empty{display:inline-block;width:0;height:0}</style></head><body><h1>API fixture</h1><div id="surface"></div><span id="empty"></span><button id="covered">Covered action</button><div id="cover">An open overlay</div><button id="values">Log values</button><button id="burst">Log burst</button><output role="status">Ready</output><label>Single attachment<input id="attachment" type="file"></label><div id="editor" contenteditable="true" role="textbox" aria-label="Editable note">Original note</div><p id="uploads"></p><p id="fixture-name">'+(created??'No fixture')+'</p><div id="below">Below viewport</div><script nonce="api-nonce" src="/client.js"></script></body></html>');
});
server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('API_READY'));
`;

async function apiProject(t, source, { config = {}, files = {} } = {}) {
  return project(t, { source,
    config: { viewport: {width:800,height:600}, ...config,
      webServer: {command:[process.execPath,'api-app.js'],ready:'API_READY',...config.webServer} },
    files: {'api-app.js':appServer,...files} });
}

async function savedReport(result) {
  let saved = result.events.findLast(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  return {saved,report:JSON.parse(await readFile(saved.json,'utf8'))};
}

function outcomes(result, errors) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let tests = result.events.filter(event => event.type === 'test');
  for(let [name, message] of Object.entries(errors)) {
    let outcome = tests.find(test => test.name === name);
    assert.equal(outcome?.status, 'failed', result.stdout + result.stderr);
    assert.match(outcome.error.message, message);
    assert.equal(outcome.error.phase, 'test');
  }
  return tests;
}

test('saved console diagnostics safely format complex values and bound noisy output', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Console diagnostics', () => {
    test('prints diagnostic values', async ({app,I}) => {
      await app.goto('/');await I.click('Log values');await I.find('$([role=status])').text('Logged safely');
    });
    test('bounds a noisy app and test', async ({app,I}) => {
      await app.goto('/');for(let index=0;index<110;index++)console.log('test line',index);
      await I.click('Log burst');await I.find('$([role=status])').text('Burst completed');
    });
  });`);
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let {saved,report} = await savedReport(result);
  let values = report.tests[0].output.map(entry => entry.text).join('\n');
  for(let text of ['42n','[Function save]','[Function anonymous]','Error: Save failed','[Array]',
    '[Object]','[Circular]','[Getter]','[Value could not be printed]']) assert.ok(values.includes(text), values);
  assert.ok(report.tests[0].output.every(entry => entry.text.length <= 2000));
  assert.equal(report.tests[1].output.length, 100);
  assert.equal(report.tests[1].output[0].text, 'test line 0');
  assert.equal(report.tests[1].output.at(-1).text, 'test line 99');
  let page = await openURL(t, pathToFileURL(saved.html).href);
  await page.locator('summary').filter({hasText:'prints diagnostic values'}).click();
  await page.getByText('[Value could not be printed]', {exact:false}).waitFor();
});

test('screenshot authoring errors are saved clearly and do not poison the next capture', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Screenshot options', () => {
    test('capture before navigation', ({app}) => app.screenshot('not loaded'));
    for(let [name,options] of [
      ['null options',null],['translucent mask',{maskColor:'#fff'}],
      ['invalid rendering policy',{fullPage:'yes'}],['non-array masks',{mask:'private'}],
    ]) test(name, async ({app}) => {await app.goto('/');await app.screenshot(name,options);});
    test('conflicting element capture', async ({app}) => {await app.goto('/');
      await app.screenshot('conflict',{element:app.document.querySelector('h1'),fullPage:false});});
    test('stale element capture', async ({app}) => {await app.goto('/');let element=app.document.querySelector('h1');
      await app.goto('/next');await app.screenshot('stale',{element});});
    test('empty element capture', async ({app}) => {await app.goto('/');
      await app.screenshot('empty',{element:app.document.querySelector('#empty')});});
    test('recovers with a valid capture', async ({app,I}) => {await app.goto('/');
      let image=await app.screenshot('recovered');await I.assert(()=>image.status==='captured');});
  });`);
  let result = await fixture.run().completion;
  let tests = outcomes(result, {
    'capture before navigation':/Load the app before requesting a screenshot/,
    'null options':/Screenshot options must be an object/,
    'translucent mask':/opaque #RRGGBB/,
    'invalid rendering policy':/fullPage:boolean/,
    'non-array masks':/masks must be an array/,
    'conflicting element capture':/cannot also specify fullPage or mask/,
    'stale element capture':/connected element from the current app document/,
    'empty element capture':/bounds must fit inside the current app document/,
  });
  assert.equal(tests.at(-1).status, 'passed');
  let {report} = await savedReport(result);
  assert.equal(report.summary.failed, 8);
  assert.equal(report.tests.at(-1).attachments[0].status, 'captured');
  assert.ok(report.tests.slice(0,-1).every(test => !test.attachments.length));
});

test('caret suppression respects shadow-root nonces and explains an app policy that blocks it', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Capture app policy', () => {
    test('restores a shadow input after capture', async ({app,I}) => {
      await app.goto('/');let root=app.document.querySelector('#surface').shadowRoot;
      let input=root.querySelector('input');input.focus();let styles=root.querySelectorAll('style').length;
      let caret=app.window.getComputedStyle(input).caretColor;
      await app.screenshot('shadow input',{caret:'hide',mask:[app.document.querySelector('#below')]});
      await I.assert(()=>root.querySelectorAll('style').length===styles && app.window.getComputedStyle(input).caretColor===caret);
    });
    test('explains blocked capture styling', async ({app}) => {
      await app.goto('/strict');await app.screenshot('blocked styling',{caret:'hide'});
    });
  });`);
  let result = await fixture.run().completion;
  outcomes(result, {'explains blocked capture styling':/Content Security Policy blocked screenshot styling/});
  let {saved,report} = await savedReport(result);
  assert.equal(report.tests[0].status, 'passed');
  let attachment = report.tests[0].attachments[0];
  let image = PNG.sync.read(await readFile(join(saved.directory,attachment.path)));
  let offset = (Math.round(130*attachment.pixelRatio)*image.width + Math.round(20*attachment.pixelRatio))*4;
  assert.deepEqual([...image.data.subarray(offset,offset+4)], [20,150,80,255]);
  assert.equal(report.tests[1].attachments.length, 0);
});

test('native hover targets shadow content and diagnoses invalid, collapsed and covered targets', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Native pointer targets', () => {
    test('requires a loaded app for native keys', ({app}) => app.native.press('Tab'));
    test('hovers a shadow button at an explicit point', async ({app,I}) => {
      await app.goto('/');let host=app.document.querySelector('#surface');let button=host.shadowRoot.querySelector('button');
      await app.native.hover(button,{position:{x:5,y:5}});await I.find('$([role=status])').text('Pointer inside');
      await app.native.move({x:400,y:200});await I.find('$([role=status])').text('Pointer outside');
      await app.native.hover(host,{position:{x:5,y:5}});await I.find('$([role=status])').text('Pointer inside');
    });
    test('invalid hover options', async ({app}) => {await app.goto('/');
      await app.native.hover(app.document.querySelector('#surface'),{offset:2});});
    test('point outside the target', async ({app}) => {await app.goto('/');
      await app.native.hover(app.document.querySelector('#surface'),{position:{x:-1,y:2}});});
    test('collapsed target', async ({app}) => {await app.goto('/');await app.native.hover(app.document.querySelector('#empty'));});
    test('covered target', async ({app}) => {await app.goto('/');await app.native.hover(app.document.querySelector('#covered'));});
    test('invalid dialog options', async ({app}) => {await app.goto('/');await app.native.withDialog(null,()=>{});});
  });`);
  let result = await fixture.run().completion;
  let tests = outcomes(result, {
    'requires a loaded app for native keys':/Load the app and wait for its current document/,
    'invalid hover options':/hover options only accept an optional position/,
    'point outside the target':/finite point inside the element/,
    'collapsed target':/no visible point that receives pointer input/,
    'covered target':/no visible point that receives pointer input/,
    'invalid dialog options':/withDialog needs action/,
  });
  assert.equal(tests.find(test=>test.name==='hovers a shadow button at an explicit point').status, 'passed', result.stdout + result.stderr);
  let {report} = await savedReport(result);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.failed, 6);
});

test('public navigation, fixture and step errors retain useful authoring diagnostics', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Authoring diagnostics', () => {
    test('external request', ({app}) => app.request('https://example.com/private'));
    test('reserved navigation', ({app}) => app.goto('/__dyno__/reporter'));
    test('fixture without transport', ({app}) => app.fixture('users.create'));
    test('step without a name', ({step}) => step('',()=>{}));
    test('generator step', ({step}) => step('save',function*(){yield 'not awaited';}));
    test('generator callback', function*(){yield 'not awaited';});
    test('recovery', async ({app,I,step}) => {await step('open app',()=>app.goto('/'));await I.find('API fixture').visible();});
  });`);
  let result = await fixture.run().completion;
  outcomes(result, {
    'external request':/app.request requires a same-origin path/,
    'reserved navigation':/app.goto requires an app path on the gateway origin/,
    'fixture without transport':/no execution fixture transport/,
    'step without a name':/step\(\) needs a name/,
    'generator step':/step\(\) callbacks must use ordinary or async functions/,
    'generator callback':/Test callbacks and hooks must use ordinary or async functions/,
  });
  let {report} = await savedReport(result);
  assert.equal(report.tests.at(-1).status, 'passed');
  assert.ok(report.tests.slice(0,-1).every(test=>test.error.source.file==='tests/browser/workflow.test.js'));
});

test('primitive failures keep their message and cleanup phase without stopping later tests', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Failure reporting', () => {
    afterEach(({test})=>{if(test.name==='string failure')throw 'Cleanup text';});
    test('string failure', ()=>{throw 'Contact save failed';});
    test('numeric rejection', ()=>Promise.reject(42));
    test('recovery', async ({app,I})=>{await app.goto('/');await I.find('API fixture').visible();});
  });`);
  let result = await fixture.run().completion;
  outcomes(result, {'string failure':/Contact save failed/,'numeric rejection':/^42$/});
  let {report} = await savedReport(result);
  assert.equal(report.tests[0].additionalErrors[0].message, 'Cleanup text');
  assert.equal(report.tests[0].additionalErrors[0].phase, 'afterEach');
  assert.equal(report.tests.at(-1).status, 'passed');
});

test('interactive pause errors explain cleanup and message misuse while a valid pause can continue', {timeout:90000}, async t => {
  let fixture = await project(t, {source:`describe('Debug pause contracts', () => {
    describe('cleanup',()=>{afterEach(({app})=>app.pause('Too late'));test('cannot pause cleanup',()=>{});});
    test('requires a message string', ({app})=>app.pause({reason:'Inspect'}));
    test('continues after rejecting a duplicate pause', async ({app,I})=>{
      await app.goto('/');let paused=app.pause('Inspect duplicate pause');let failure;
      try{await app.pause('Again');}catch(error){failure=error.message;}
      await paused;await I.assert(()=>failure==='Await app.pause() before pausing again.');
      await I.find('Fixture app').visible();
    });
  });`});
  let session = fixture.run(['--manual']);
  let ready = await session.waitForEvent('ready');
  let page = await openURL(t, ready.url+'#start=managed');
  await page.getByRole('button',{name:'Start tests',exact:true}).click();
  let reporter = page.frameLocator('#__dynoReporter');
  await Promise.race([
    reporter.getByRole('button',{name:'Continue run',exact:true}).waitFor(),
    session.waitForEvent('complete').then(async()=>{let result=await session.stop();throw new Error(result.stdout+result.stderr);}),
  ]);
  await reporter.getByRole('button',{name:'Continue run',exact:true}).click();
  await session.waitForEvent('complete');
  let result = await session.stop();
  let {report} = await savedReport(result);
  assert.equal(report.tests[0].error.phase, 'afterEach');
  assert.match(report.tests[0].error.message, /available during setup or the test, before cleanup/);
  assert.match(report.tests[1].error.message, /needs a message string/);
  assert.equal(report.tests[2].status, 'passed');
});

test('native offline mode can explicitly restore real app network access', {
  timeout:90000,skip:!['chromium','chrome','edge'].includes(browser),
}, async t => {
  let fixture = await apiProject(t, `describe('Network recovery', () => {
    test('goes offline and comes back online', async ({app,I}) => {
      await app.goto('/');await app.native.setOffline(true);let offline=false;
      try{await app.window.fetch('/ping');}catch{offline=true;}
      await I.assert(()=>offline,'Offline app request unexpectedly succeeded');
      await app.native.setOffline(false);let response=await app.window.fetch('/ping');
      await I.assert(()=>response.ok);let text=await response.text();await I.assert(()=>text==='Connected');
    });
  });`);
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let {report} = await savedReport(result);
  assert.equal(report.tests[0].status, 'passed');
  assert.ok(report.tests[0].timings.entries.some(entry=>entry.name==='Set app online'&&entry.status==='passed'));
});

test('Interactor form diagnostics preserve real editable focus and valid single-file uploads', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Form authoring', () => {
    test('requires navigation before reading the document', ({app}) => app.document.querySelector('h1'));
    test('cannot fill a button', async ({app,I}) => {await app.goto('/');await I.find('Log values').then.fill('Robert');});
    test('cannot upload to a button', async ({app,I}) => {await app.goto('/');
      await I.find('Log values').then.upload({name:'note.txt',bytes:'Contact note'});});
    test('requires multiple for two attachments', async ({app,I}) => {await app.goto('/');
      await I.find('Single attachment').then.upload({name:'one.txt',bytes:'One'},{name:'two.txt',bytes:'Two'});});
    test('edits a note and attaches one file', async ({app,I}) => {
      await app.goto('/');await I.find('$(#editor)').then.focus().then.nativePress('ControlOrMeta+A').then.nativePress('!');
      await I.find('$(#editor)').focused();await I.find('$(#editor)').text('!');
      await I.find('Single attachment').then.upload({name:'note.txt',bytes:'Contact note'});
      await I.find('$(#uploads)').text('note.txt: Contact note');
    });
  });`);
  let result = await fixture.run().completion;
  outcomes(result, {
    'requires navigation before reading the document':/App document is navigating or its startup bridge has not loaded/,
    'cannot fill a button':/fill requires an input or textarea/,
    'cannot upload to a button':/upload requires a file input/,
    'requires multiple for two attachments':/Multiple files require a multiple file input/,
  });
  let {report} = await savedReport(result);
  assert.equal(report.tests.at(-1).status, 'passed', JSON.stringify(report.tests.at(-1).error));
  assert.equal(report.summary.failed, 4);
});

test('app-owned fixture responses require a result envelope and later valid calls still render their data', {timeout:90000}, async t => {
  let fixture = await apiProject(t, `describe('Fixture HTTP results', () => {
    test('rejects a no-content result', ({app}) => app.fixture('contacts.noContent'));
    test('renders a contact created by a valid result', async ({app,I}) => {
      let contact=await app.fixture('contacts.create',{name:'Robert'});
      await I.assert(()=>contact.name==='Robert');await app.goto('/');
      await I.find('$(#fixture-name)').text('Robert');
    });
  });`, {
    config: {setup:'./setup.js'},
    files: {'setup.js':`import {randomBytes} from 'node:crypto';
      export default () => ({beforeExecution:({runId,workerId,executionId}) => ({
        fixtureTransport:{path:'/app-fixtures/call',scope:{runId,workerId,executionId,token:randomBytes(32).toString('base64url')}}
      })});`},
  });
  let result = await fixture.run().completion;
  outcomes(result, {'rejects a no-content result':/fixture server returned an invalid result envelope/});
  let {report} = await savedReport(result);
  assert.deepEqual(report.tests.map(test=>test.status), ['failed','passed']);
});
