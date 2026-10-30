import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startProcess } from './process.js';
import { browserNames } from './browsers.js';
import { nativeCapabilities } from './native.js';

let execute = promisify(execFile);

async function stopProfileProcesses(profile) {
  let processes;
  if (process.platform === 'win32') {
    let { stdout } = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { timeout: 5000 },
    );
    let rows = JSON.parse(stdout || '[]');
    processes = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      pid: row.ProcessId,
      parent: row.ParentProcessId,
      command: row.CommandLine ?? '',
    }));
  } else {
    let { stdout } = await execute('ps', ['-axww', '-o', 'pid=,ppid=,command='], { timeout: 5000 });
    processes = stdout
      .trim()
      .split('\n')
      .map((line) => {
        let [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/) ?? [];
        return { pid: Number(pid), parent: Number(parent), command: command ?? '' };
      });
  }
  // Playwright normally closes its browser. The profile also lets the parent
  // find a detached browser if its worker exits before that close completes.
  let owned = new Set(
    processes.filter((item) => item.command.includes(profile)).map((item) => item.pid),
  );
  for (let size = -1; size !== owned.size; ) {
    size = owned.size;
    for (let item of processes) if (owned.has(item.parent)) owned.add(item.pid);
  }
  for (let pid of [...owned].reverse()) {
    try {
      if (process.platform === 'win32')
        await execute('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 5000 });
      else process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error.code === 'ESRCH') continue;
      try {
        process.kill(pid, 0);
      } catch (check) {
        if (check.code === 'ESRCH') continue;
      }
      throw error;
    }
  }
}

export async function resolveSession(browser, { headless = true } = {}) {
  let name = browser.name ?? 'chromium';
  if (!browserNames.includes(name))
    throw new Error(
      `Unknown browser "${name}". Choose ${browserNames.join(', ')} or use --manual.`,
    );
  let path = browser.path;
  if (path) {
    path = resolve(path);
    try {
      await access(path, constants.X_OK);
    } catch {
      throw new Error(`Browser executable is missing or not executable: ${path}`);
    }
  }
  return Object.freeze({
    ...browser,
    name,
    ...(path ? { path } : {}),
    provider: 'playwright',
    headless,
    isolated: true,
  });
}

export async function createBrowserSession(plan, { viewport, signal, onExit } = {}) {
  let profile = await mkdtemp(join(tmpdir(), `dyno-playwright-${process.pid}-`));
  let owned = startProcess(process.execPath, {
    shell: false,
    ipc: true,
    args: [fileURLToPath(new URL('./providers/worker.js', import.meta.url))],
  });
  let requests = new Map();
  let stopping;
  owned.child.on('message', (message) => {
    if (message.kind === 'disconnected') {
      if (!stopping) onExit?.(new Error('The managed browser or execution page closed.'));
      return;
    }
    let pending = requests.get(message.id);
    if (!pending) return;
    requests.delete(message.id);
    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
  });
  owned.child.once('exit', () => {
    let error = new Error(`The Playwright browser session disconnected. ${owned.logs}`.trim());
    for (let pending of requests.values()) pending.reject(error);
    requests.clear();
    if (!stopping) onExit?.(error);
  });
  let invoke = async (method, input = {}, operationSignal) => {
    let id = randomUUID();
    let request = Promise.withResolvers();
    requests.set(id, request);
    let deadline = AbortSignal.any([
      AbortSignal.timeout(
        method === 'initialize' || method === 'open' ? 35000 : method === 'stop' ? 3000 : 15000,
      ),
      ...(signal && !['stop', 'resetNative'].includes(method) ? [signal] : []),
      ...(operationSignal ? [operationSignal] : []),
    ]);
    let submitted = false;
    let abort = () => {
      if (method === 'native' && submitted && owned.child.connected)
        owned.child.send({ kind: 'cancel-native', input }, () => {});
      requests.delete(id);
      request.reject(
        new Error(`Browser ${method} cancelled or exceeded its deadline.`, {
          cause: deadline.reason,
        }),
      );
    };
    deadline.addEventListener('abort', abort, { once: true });
    if (deadline.aborted) abort();
    else {
      submitted = true;
      owned.child.send({ id, method, input }, (error) => {
        if (error) request.reject(error);
      });
    }
    try {
      return await request.promise;
    } finally {
      requests.delete(id);
      deadline.removeEventListener('abort', abort);
    }
  };
  let stop = () =>
    (stopping ??= (async () => {
      let graceful = false;
      try {
        if (owned.child.connected) {
          await invoke('stop');
          graceful = true;
        }
      } catch {
      } finally {
        try {
          await owned.stop();
        } finally {
          try {
            await stopProfileProcesses(profile);
          } finally {
            await rm(profile, { recursive: true, force: true, maxRetries: 3 });
          }
        }
      }
      return Object.freeze({ graceful });
    })());
  try {
    await owned.ready;
    let identity = Object.freeze(
      await invoke('initialize', { plan: { ...plan, profile }, viewport }),
    );
    return Object.freeze({
      identity,
      capabilities: Object.freeze({
        screenshot: true,
        fullPage: true,
        hostViewport: true,
        native: nativeCapabilities(plan.name),
      }),
      open: (url) => invoke('open', { url }),
      activate: () => invoke('activate'),
      resize: (size, operationSignal) => invoke('resize', size, operationSignal),
      capture: async (options, operationSignal) =>
        Buffer.from(await invoke('capture', options, operationSignal), 'base64'),
      native: (input, operationSignal) => invoke('native', input, operationSignal),
      resetNative: async (input, operationSignal) => {
        try {
          await invoke('resetNative', input, operationSignal);
        } catch (error) {
          await stop();
          throw error;
        }
      },
      stop,
      get logs() {
        return owned.logs;
      },
    });
  } catch (error) {
    await stop();
    let help =
      !plan.path &&
      ['chromium', 'firefox', 'webkit'].includes(plan.name) &&
      /executable.*doesn.t exist/i.test(error.message)
        ? ` Install its Playwright build with dyno install --browser ${plan.name}.`
        : '';
    throw new Error(`${error.message}${help}`, { cause: error });
  }
}
