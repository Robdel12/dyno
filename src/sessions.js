import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { signalProcessGroup } from './process.js';

let execute = promisify(execFile);

// A record per live session: its own pid and every process group Dyno started
// for it. A session that dies before cleanup runs (a crash, kill -9, a closed
// laptop) is cleaned up by the next run, which ends those processes and hands
// the session to the project's `reclaim` export.
let folder = (root) => join(root, '.dyno', 'sessions');
let file = (root, id) => join(folder(root), `${id}.json`);

export let running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// The command a pid is running now. A process is only ended when this still
// matches what was recorded, so a reused pid is never touched.
let commandOf = async (pid) => {
  if (process.platform === 'win32') return '';
  try { return (await execute('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 3000 })).stdout.trim(); }
  catch { return ''; }
};

export async function recordSession(root, session) {
  let record = { id: session.id, pid: process.pid, startedAt: session.startedAt, processes: [] };
  let writing = Promise.resolve();
  let save = () => {
    let snapshot = JSON.stringify(record);
    writing = writing.then(() => writeFile(file(root, session.id), snapshot)).catch(() => {});
    return writing;
  };
  await mkdir(folder(root), { recursive: true });
  await save();
  return Object.freeze({
    async track(pid) {
      let command = await commandOf(pid);
      if (!command) return;
      record = { ...record, processes: [...record.processes, { pid, command }] };
      await save();
    },
    async forget() {
      await writing;
      await rm(file(root, session.id), { force: true });
    },
  });
}

// Sessions whose process is gone without removing its record.
export async function interruptedSessions(root, alive = running) {
  let names;
  try { names = await readdir(folder(root)); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let records = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
    try { return JSON.parse(await readFile(join(folder(root), name), 'utf8')); }
    catch { return null; }
  }));
  return records.filter((record) => record?.id && Number.isSafeInteger(record.pid) && !alive(record.pid));
}

async function endProcesses(processes = []) {
  for (let { pid, command } of processes)
    if (Number.isSafeInteger(pid) && command && await commandOf(pid) === command)
      await signalProcessGroup(pid, 'SIGKILL');
}

// Ends a session's leftover Dyno processes, then hands the session to the
// project's `reclaim` export. A session stays recorded when reclaim fails, so
// the next run tries again.
export async function reclaimSessions(root, reclaim, { config, report }) {
  for (let session of await interruptedSessions(root)) {
    let started = new Date(session.startedAt).toLocaleString();
    let forget = () => rm(file(root, session.id), { force: true });
    try {
      await endProcesses(session.processes);
      if (typeof reclaim === 'function')
        await reclaim({ session: Object.freeze({ id: session.id, startedAt: session.startedAt }), config });
      else if (config.setup)
        report(`A Dyno session started ${started} ended before its cleanup ran. Export reclaim({ session }) from your setup module so Dyno can clean up what it started.`);
      await forget();
      report(`Cleaned up after an interrupted Dyno session started ${started}.`);
    } catch (error) {
      report(`Could not clean up the interrupted session started ${started}: ${error.message} Dyno tries again on the next run.`);
    }
  }
}
