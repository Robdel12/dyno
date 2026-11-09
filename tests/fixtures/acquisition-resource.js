import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function record(root, event) {
  return appendFile(join(root, 'lifecycle.log'), event + '\n');
}

export async function acquireResource({ root, name, parent = root, onCleanup, signal }) {
  let directory = await mkdtemp(join(parent, name + '-'));
  onCleanup(async () => {
    await rm(directory, { recursive: true });
    await record(root, name + ':removed');
  });
  let child = fork(new URL('./acquisition-child.js', import.meta.url), [directory, parent, name], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let exited = once(child, 'exit');
  onCleanup(async () => {
    if (child.connected) child.send('stop');
    let [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    await record(root, name + ':stopped');
  });
  let [ready] = await once(child, 'message', { signal });
  assert.equal(await (await fetch(ready.url, { signal })).text(), name);
  let resource = Object.freeze({ directory, ...ready });
  await writeFile(join(root, name + '.json'), JSON.stringify(resource));
  return resource;
}
