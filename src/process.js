import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';

export function startProcess(command, { cwd, env, output = () => {}, shell = true, args = [] } = {}) {
  let events = new EventEmitter();
  let child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  let failed;
  child.on('error', error => { failed = error; events.emit('change'); });
  child.on('exit', (code, signal) => { failed = new Error(`Process exited (${signal ?? code}): ${command}`); events.emit('change'); });
  for (let stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    let message = chunk.toString();
    logs = (logs + message).slice(-12000);
    output(message);
    events.emit('change');
  });
  let stop = async () => {
    if (!child.pid) return;
    let send = signal => {
      try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    send('SIGTERM');
    if (child.exitCode === null && child.signalCode === null && !failed) {
      try { await once(child, 'exit', { signal: AbortSignal.timeout(3000) }); }
      catch (error) { if (error.name !== 'AbortError') throw error; }
    }
    // Descendants may outlive a shell; stop the complete owned process group.
    send('SIGKILL');
  };
  return { child, events, stop, get logs() { return logs; }, get failure() { return failed; } };
}

async function reachable(url) {
  try {
    let response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    return response.status >= 200 && response.status < 400;
  } catch { return false; }
}

export async function startWebServer(config, { output = () => {}, signal } = {}) {
  if (await reachable(config.url)) {
    if (!config.reuseExistingServer) throw new Error(`App server already running at ${config.url}. Set webServer.reuseExistingServer to true to use it.`);
    output(`Reusing app server ${config.url}\n`);
    return { stop: async () => {} };
  }
  if (!config.command) throw new Error(`No app server at ${config.url}; set webServer.command to start it.`);
  let command = Array.isArray(config.command) ? config.command[0] : config.command;
  let args = Array.isArray(config.command) ? config.command.slice(1) : [];
  let owned = startProcess(command, { cwd: config.cwd, env: config.env, output, shell: !Array.isArray(config.command), args });
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
          let ready = !config.ready || (config.ready instanceof RegExp ? config.ready.test(owned.logs) : owned.logs.includes(config.ready));
          if (ready && await reachable(config.url)) finish();
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
    return owned;
  } catch (error) {
    await owned.stop();
    throw new Error(`App server did not become ready at ${config.url}: ${error.message}\n${owned.logs}`, { cause: error });
  }
}
