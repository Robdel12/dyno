import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

test('invalid project workers fail before app startup and still run project teardown', { timeout: 15000 }, async t => {
  for (let [value, message] of [
    ['undefined', /must return a project worker/],
    ['null', /must return a project worker/],
    ['false', /must return a project worker/],
    ["{webserver:{url:'http://127.0.0.1:3000'}}", /Unknown project worker option: webserver/],
    ['{fixtures:[]}', /fixtures must be an object/],
    ['{drain:42}', /drain must be a function/],
  ]) {
    let fixture = await project(t, {
      config: { setup: './setup.js' },
      files: { 'setup.js': `import {writeFile} from 'node:fs/promises';
        export default()=>({createWorker:()=>(${value}),teardown:()=>writeFile('cleaned.txt','done')});` },
    });
    let result = await fixture.run(['--manual']).completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.events.at(-1).message, message);
    assert.equal(result.events.some(event => event.type === 'ready'), false);
    assert.equal(await readFile(join(fixture.directory, 'cleaned.txt'), 'utf8'), 'done');
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  }
});

test('malformed project teardown fails before app startup', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': 'export default()=>({teardown:true});' },
  });
  let result = await fixture.run(['--manual']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /setup.teardown must be a function/);
  assert.equal(result.events.some(event => event.type === 'ready'), false);
});

test('worker settings inherit project defaults while preserving worker-specific values', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', webServer: { command: [process.execPath, 'app.js'] } },
    files: {
      'setup.js': `export default()=>({
        env:{SHARED:'shared',OVERRIDE:'default'},fixtures:{common:'build',override:'default'},
        createWorker:()=>({env:{OVERRIDE:'worker'},fixtures:{override:'worker'}})
      });`,
      'app.js': `import {createServer} from 'node:http';
        createServer((request,response)=>response.end(JSON.stringify({shared:process.env.SHARED,override:process.env.OVERRIDE})))
          .listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('FIXTURE_READY'));`,
    },
  });
  let session = fixture.run(['--manual']);
  let ready = await session.waitForEvent('ready');
  let settings = await (await fetch(ready.url + 'settings', { signal: t.signal })).json();
  assert.deepEqual(settings.fixtures, { common: 'build', override: 'worker' });
  assert.deepEqual(await (await fetch(ready.appURL, { signal: t.signal })).json(), { shared: 'shared', override: 'worker' });
  assert.equal((await session.stop()).code, 143);
});
