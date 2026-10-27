import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { signalProcessGroup } from '../src/process.js';
import { exec, repository } from './helpers/project.js';

test('macOS cleanup accepts a zombie-only group and leaves its supervisor running', { timeout: 15000, skip: process.platform !== 'darwin' }, async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-process-group-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let binary = join(directory, 'zombie-group');
  await exec('cc', [join(repository, 'tests/fixtures/zombie-group.c'), '-o', binary], { timeout: 10000 });
  let supervisor = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let closed = once(supervisor, 'close');
  t.after(async () => { supervisor.stdin.end(); await closed; });
  let [data] = await once(supervisor.stdout, 'data', { signal: t.signal });
  let group = Number(data.toString().trim());
  assert.ok(Number.isInteger(group) && group > 0);
  try { process.kill(-group, 0); }
  catch (error) { assert.ok(['EPERM', 'ESRCH'].includes(error.code)); }
  await signalProcessGroup(group, 'SIGTERM');
  await signalProcessGroup(group, 'SIGKILL');
  assert.equal(supervisor.exitCode, null, 'Cleanup signalled the supervising process outside the group');
});
