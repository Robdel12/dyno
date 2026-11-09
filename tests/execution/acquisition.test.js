import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

let resourceModule = new URL('../fixtures/acquisition-resource.js', import.meta.url).href;

test('parallel startup joins cancelled peers before releasing workers and their shared parent', { timeout: 30000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2 },
    files: { 'setup.js': `import assert from 'node:assert/strict';
      import {once} from 'node:events';
      import {acquireResource,record} from ${JSON.stringify(resourceModule)};
      export default async ({config,session,onCleanup,signal}) => {
        let shared=await acquireResource({root:config.root,name:'shared',onCleanup,signal});
        let ready=Promise.withResolvers();
        let count=0;
        return {
          async createWorker({worker,session:identity,onCleanup,signal}) {
            assert.equal(identity,session);
            let cancelled=worker.index===0 ? once(signal,'abort') : null;
            await acquireResource({root:config.root,parent:shared.directory,name:'worker-'+worker.id,onCleanup,signal});
            if (++count===2) ready.resolve();
            await ready.promise;
            if (worker.index===1) throw new Error('Second worker acquisition failed');
            await cancelled;
            await record(config.root,'peer:cancelled-and-settled');
            signal.throwIfAborted();
          }
        };
      };` },
  });
  let result = await fixture.run().completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.events.at(-1).message, /Second worker acquisition failed/);
  assert.equal(await readFile(join(fixture.directory, 'lifecycle.log'), 'utf8'),
    'peer:cancelled-and-settled\nworker-1:stopped\nworker-1:removed\nworker-0:stopped\nworker-0:removed\nshared:stopped\nshared:removed\n');
  for (let name of ['worker-0', 'worker-1', 'shared']) {
    let resource = JSON.parse(await readFile(join(fixture.directory, name + '.json'), 'utf8'));
    await assert.rejects(access(resource.directory), { code: 'ENOENT' });
    await assert.rejects(fetch(resource.url));
    assert.throws(() => process.kill(resource.pid, 0), { code: 'ESRCH' });
  }
});
