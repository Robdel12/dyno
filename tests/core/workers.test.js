import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

let resourceModule = new URL('../fixtures/acquisition-resource.js', import.meta.url).href;

async function expectReleased(fixture, name) {
  let resource = JSON.parse(await readFile(join(fixture.directory, name + '.json'), 'utf8'));
  await assert.rejects(access(resource.directory), { code: 'ENOENT' });
  await assert.rejects(fetch(resource.url));
  assert.throws(() => process.kill(resource.pid, 0), { code: 'ESRCH' });
}

test('a failing setup releases registered child processes and directories before returning a descriptor', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import {acquireResource} from ${JSON.stringify(resourceModule)};
      export default async ({config,signal,onCleanup}) => {
        await acquireResource({root:config.root,name:'shared',signal,onCleanup});
        throw new Error('Shared acquisition failed');
      };` },
  });
  let result = await fixture.run(['--manual']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /Shared acquisition failed/);
  assert.equal(await readFile(join(fixture.directory, 'lifecycle.log'), 'utf8'), 'shared:stopped\nshared:removed\n');
  await expectReleased(fixture, 'shared');
});

test('a failing worker releases its partial resources before shared resources', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import {acquireResource} from ${JSON.stringify(resourceModule)};
      export default async ({config,signal,onCleanup}) => {
        let shared = await acquireResource({root:config.root,name:'shared',signal,onCleanup});
        return {createWorker:async ({signal,onCleanup}) => {
          await acquireResource({root:config.root,parent:shared.directory,name:'worker',signal,onCleanup});
          throw new Error('Worker acquisition failed');
        }};
      };` },
  });
  let result = await fixture.run(['--manual']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /Worker acquisition failed/);
  assert.equal(await readFile(join(fixture.directory, 'lifecycle.log'), 'utf8'), 'worker:stopped\nworker:removed\nshared:stopped\nshared:removed\n');
  await expectReleased(fixture, 'worker');
  await expectReleased(fixture, 'shared');
});

test('returned teardown shares registered cleanup order and cleanup failures do not skip releases', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import {acquireResource,record} from ${JSON.stringify(resourceModule)};
      export default async ({config,signal,onCleanup}) => {
        await acquireResource({root:config.root,name:'shared',signal,onCleanup});
        return {
          teardown:() => record(config.root,'shared:returned'),
          createWorker:async ({signal,onCleanup}) => {
            await acquireResource({root:config.root,name:'worker',signal,onCleanup});
            onCleanup(() => {throw new Error('Expected cleanup failure');});
            return {fixtures:[],teardown:() => record(config.root,'worker:returned')};
          }
        };
      };` },
  });
  let result = await fixture.run(['--manual']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /fixtures must be an object/);
  assert.equal(result.events.filter(event => event.type === 'error' && event.phase === 'cleanup').length, 1);
  assert.match(result.events.find(event => event.phase === 'cleanup').message, /Expected cleanup failure/);
  assert.equal(await readFile(join(fixture.directory, 'lifecycle.log'), 'utf8'), 'worker:returned\nworker:stopped\nworker:removed\nshared:returned\nshared:stopped\nshared:removed\n');
  await expectReleased(fixture, 'worker');
  await expectReleased(fixture, 'shared');
});

test('the app process stops before registered worker and shared resources release', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', webServer: { command: [process.execPath, 'app.js'] } },
    files: {
      'setup.js': `import assert from 'node:assert/strict';
        import {readFile} from 'node:fs/promises';
        import {join} from 'node:path';
        import {acquireResource,record} from ${JSON.stringify(resourceModule)};
        export default async ({config,onCleanup,signal}) => {
          let shared=await acquireResource({root:config.root,name:'shared',onCleanup,signal});
          return {createWorker:async ({onCleanup,signal}) => {
            let worker=await acquireResource({root:config.root,parent:shared.directory,name:'worker',onCleanup,signal});
            onCleanup(async () => {
              assert.equal(await readFile(join(config.root,'app-stopped'),'utf8'),'resources still available');
              await assert.rejects(fetch(config.webServer.url));
              await record(config.root,'app:stopped');
            });
            return {env:{WORKER_DIRECTORY:worker.directory,SHARED_DIRECTORY:shared.directory}};
          }};
        };`,
      'app.js': `import {access,writeFile} from 'node:fs/promises';
        import {createServer} from 'node:http';
        let server=createServer((request,response)=>response.end('app'));
        process.once('SIGTERM',async () => {
          await access(process.env.WORKER_DIRECTORY);
          await access(process.env.SHARED_DIRECTORY);
          await writeFile('app-stopped','resources still available');
          server.close();
        });
        server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('FIXTURE_READY'));`,
    },
  });
  let session = fixture.run(['--manual']);
  await session.waitForEvent('ready');
  assert.equal((await session.stop()).code, 143);
  assert.equal(await readFile(join(fixture.directory, 'lifecycle.log'), 'utf8'), 'app:stopped\nworker:stopped\nworker:removed\nshared:stopped\nshared:removed\n');
  await expectReleased(fixture, 'worker');
  await expectReleased(fixture, 'shared');
});

test('session identity is frozen and shared during startup while registration closes after acquisition', { timeout: 15000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `import assert from 'node:assert/strict';
      import {writeFile} from 'node:fs/promises';
      import {join} from 'node:path';
      export default ({config,session,onCleanup}) => {
        assert.ok(Object.isFrozen(session));
        let sharedCleanup=onCleanup;
        onCleanup(() => assert.throws(() => sharedCleanup(() => {}),/registration is closed/));
        return {createWorker:({session:workerSession,onCleanup}) => {
          assert.equal(session,workerSession);
          assert.throws(() => sharedCleanup(() => {}),/registration is closed/);
          onCleanup(() => assert.throws(() => onCleanup(() => {}),/registration is closed/));
          return {teardown:() => writeFile(join(config.root,'session.json'),JSON.stringify(session))};
        }};
      };` },
  });
  let ids = [];
  for (let index of [0, 1]) {
    let session = fixture.run(['--manual']);
    await session.waitForEvent('ready');
    assert.equal((await session.stop()).code, 143);
    let identity = JSON.parse(await readFile(join(fixture.directory, 'session.json'), 'utf8'));
    ids = [...ids, identity.id];
    assert.equal(session.events.find(event => event.type === 'session-timing').sessionId, identity.id);
  }
  assert.notEqual(ids[0], ids[1]);
});

test('invalid project workers fail before app startup and still run project teardown', { timeout: 15000 }, async t => {
  for (let [value, message] of [
    ['undefined', /must return a project worker/],
    ['null', /must return a project worker/],
    ['false', /must return a project worker/],
    ["{webserver:{url:'http://127.0.0.1:3000'}}", /Unknown project worker option: webserver/],
    ['{fixtures:[]}', /fixtures must be an object/],
    ['{fixtures:new Date()}', /fixtures must be JSON-serializable/],
    ["{fixtures:{get user(){return 'Alice'}}}", /fixtures must be JSON-serializable/],
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
