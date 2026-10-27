import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';

let execute = promisify(execFile);

export async function signalProcessGroup(group, signal) {
  try { process.kill(-group, signal); }
  catch (error) {
    if (error.code === 'ESRCH') return;
    if (process.platform === 'darwin' && error.code === 'EPERM') {
      // macOS excludes zombies from group signalling and can report EPERM even
      // after every member exited. Verify that before accepting cleanup.
      let { stdout } = await execute('ps', ['-axo', 'pid=,pgid=,stat='], { timeout: 3000 });
      let members = stdout.trim().split('\n').map(line => line.trim().split(/\s+/)).filter(([, pgid]) => Number(pgid) === group);
      if (members.every(([, , state]) => state?.startsWith('Z'))) return;
      error.message += ` (${signal}, process group ${group}; remaining processes: ${members.map(([pid, , state]) => `${pid} ${state}`).join(', ')})`;
    }
    throw error;
  }
}

export function startProcess(command, { cwd, env, output = () => {}, shell = true, args = [], signal } = {}) {
  let events = new EventEmitter();
  let child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  let failed;
  let ready = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  ready.catch(() => {});
  let closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  child.on('error', error => { failed = error; events.emit('change'); });
  child.on('exit', (code, signal) => { failed = new Error(`Process exited (${signal ?? code}): ${command}`); events.emit('change'); });
  for (let stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', message => {
      logs = (logs + message).slice(-12000);
      output(message);
      events.emit('change');
    });
  }
  let stopping;
  let stop = () => stopping ??= (async () => {
    await ready.catch(() => {});
    if (!child.pid) return;
    let send = signal => signalProcessGroup(child.pid, signal);
    if (process.platform === 'win32') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      let killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(killer, 'close');
    } else {
      await send('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) {
        try { await once(child, 'exit', { signal: AbortSignal.timeout(3000) }); }
        catch (error) { if (error.name !== 'AbortError') throw error; }
      }
      // Stop descendants even when the command was a short-lived shell.
      await send('SIGKILL');
    }
    await closed;
  })();
  let abort = () => { void stop().catch(error => { failed = error; events.emit('change'); }); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  closed.then(() => signal?.removeEventListener('abort', abort));
  return Object.freeze({ child, events, ready, closed, stop, get logs() { return logs; }, get failure() { return failed; } });
}

async function reachable(url, signal) {
  try {
    let response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]) });
    await response.body?.cancel();
    return true;
  } catch { return false; }
}

export async function startWebServer(config, { output = () => {}, signal } = {}) {
  signal?.throwIfAborted();
  if (await reachable(config.url, signal)) {
    if (!config.reuseExistingServer) throw new Error(`App server already running at ${config.url}. Set webServer.reuseExistingServer to true to use it.`);
    signal?.throwIfAborted();
    output(`Reusing app server ${config.url}\n`);
    return { stop: async () => {} };
  }
  signal?.throwIfAborted();
  if (!config.command) throw new Error(`No app server at ${config.url}; set webServer.command to start it.`);
  let command = Array.isArray(config.command) ? config.command[0] : config.command;
  let args = Array.isArray(config.command) ? config.command.slice(1) : [];
  let owned = startProcess(command, { cwd: config.cwd, env: config.env, output, signal, shell: !Array.isArray(config.command), args });
  let deadline = AbortSignal.any([AbortSignal.timeout(config.timeout), ...(signal ? [signal] : [])]);
  try {
    // Server output is the readiness wakeup. No fixed startup sleep or polling loop.
    await new Promise((resolve, reject) => {
      let checking = false;
      let changedDuringCheck = false;
      let done = false;
      let finish = error => {
        if (done) return;
        done = true;
        owned.events.removeListener('change', check);
        deadline.removeEventListener('abort', expired);
        error ? reject(error) : resolve();
      };
      let expired = () => finish(deadline.reason);
      async function check() {
        if (done) return;
        if (owned.failure) return finish(owned.failure);
        if (checking) { changedDuringCheck = true; return; }
        checking = true;
        changedDuringCheck = false;
        try {
          let ready = !config.ready || (config.ready instanceof RegExp ? new RegExp(config.ready.source, config.ready.flags).test(owned.logs) : owned.logs.includes(config.ready));
          if (ready && await reachable(config.url, deadline)) finish();
        } catch (error) { finish(error); }
        finally {
          checking = false;
          if (changedDuringCheck && !done) void check();
        }
      }
      owned.events.on('change', check);
      deadline.addEventListener('abort', expired, { once: true });
      if (deadline.aborted) expired(); else void check();
    });
    signal?.throwIfAborted();
    if (owned.failure) throw owned.failure;
    return owned;
  } catch (error) {
    await owned.stop();
    throw new Error(`App server did not become ready at ${config.url}: ${deadline.aborted && !signal?.aborted ? `startup exceeded ${config.timeout} ms; log a ready message after the app starts listening` : error.message}\n${owned.logs}`, { cause: error });
  }
}
