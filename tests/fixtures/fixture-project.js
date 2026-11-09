import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectFixtureControl } from '../../src/fixtures.js';

export default function setup() {
  return {
    async createWorker({ worker, signal, onCleanup }) {
      let directory = await mkdtemp(join(tmpdir(), 'dyno-fixture-app-'));
      onCleanup(() => rm(directory, { recursive: true, force: true }));
      let token = randomUUID();
      let child = fork(new URL('./fixture-app.js', import.meta.url), [], {
        env: { ...process.env, FIXTURE_DATABASE: join(directory, 'users.sqlite'),
          FIXTURE_WORKER: worker.id, FIXTURE_TOKEN: token },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      let exited = once(child, 'exit');
      void exited.catch(() => {});
      onCleanup(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await exited;
      });
      let [ready] = await Promise.race([
        once(child, 'message', { signal }),
        exited.then(() => { throw new Error('Fixture app exited before listening.'); }),
      ]);
      let control = connectFixtureControl({ url: ready.url, workerId: worker.id, token });
      return {
        webServer: { url: ready.url, command: undefined, reuseExistingServer: true },
        beforeExecution: control.begin,
        drain: control.drain,
      };
    },
  };
}
