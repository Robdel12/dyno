import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess } from './process.js';
import { resolveBrowser, launchBrowser } from './launcher.js';

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
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
      ],
      { timeout: 5000 }
    );
    let rows = JSON.parse(stdout || '[]');
    processes = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      pid: row.ProcessId,
      parent: row.ParentProcessId,
      command: row.CommandLine ?? ''
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
  // SDKs can detach their browser from the worker's process group. The unique
  // profile identifies only this session, including after the worker crashes.
  let owned = new Set(processes.filter((item) => item.command.includes(profile)).map((item) => item.pid));
  for (let size = -1; size !== owned.size;) {
    size = owned.size;
    for (let item of processes) if (owned.has(item.parent)) owned.add(item.pid);
  }
  for (let pid of [...owned].reverse()) {
    try {
      if (process.platform === 'win32') await execute('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 5000 });
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
  let provider = browser.provider ?? 'native';
  if (provider !== 'native') {
    let dependency = provider === 'playwright' ? 'playwright-core' : 'selenium-webdriver';
    try {
      import.meta.resolve(dependency);
    } catch {
      throw new Error(
        `${provider} requires ${dependency}. Install it with npm install --save-dev ${dependency}. URL-only runs need no provider.`
      );
    }
  }
  if (provider === 'playwright') {
    if (browser.name === 'safari') throw new Error('Playwright cannot launch Safari. Choose webkit or webdriver.');
    return Object.freeze({ ...browser, provider, headless, isolated: true });
  }
  if (provider === 'webdriver' && browser.name === 'safari' && (browser.path || process.env.SAFARI_PATH))
    throw new Error(
      'WebDriver Safari uses the system safaridriver. Custom Safari paths are unsupported; remove browser.path and SAFARI_PATH.'
    );
  let resolved = await resolveBrowser(browser, { headless });
  return Object.freeze({
    ...resolved,
    provider,
    ...(browser.deviceScaleFactor ? { deviceScaleFactor: browser.deviceScaleFactor } : {}),
    isolated: provider === 'webdriver' || resolved.isolated
  });
}

export async function createBrowserSession(plan, { viewport, signal, onExit } = {}) {
  if (plan.provider === 'native') {
    let native;
    return Object.freeze({
      identity: Object.freeze({ name: plan.name, provider: 'native', build: 'installed' }),
      capabilities: Object.freeze({ screenshot: false, fullPage: false, hostViewport: false }),
      open: async (url) => {
        native = await launchBrowser(url, { resolved: plan, signal, onExit });
      },
      stop: async () => native?.stop(),
      get logs() {
        return native?.logs;
      }
    });
  }
  let profile = await mkdtemp(join(tmpdir(), `dyno-${plan.provider}-${process.pid}-`));
  let owned = startProcess(process.execPath, {
    shell: false,
    ipc: true,
    args: [fileURLToPath(new URL('./providers/worker.js', import.meta.url))],
    env: { SE_AVOID_BROWSER_DOWNLOAD: 'true', SE_TIMEOUT: '25' }
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
    let error = new Error(`The ${plan.provider} browser session disconnected. ${owned.logs}`.trim());
    for (let pending of requests.values()) pending.reject(error);
    requests.clear();
    if (!stopping) onExit?.(error);
  });
  let invoke = async (method, input = {}, operationSignal) => {
    let id = randomUUID();
    let request = Promise.withResolvers();
    requests.set(id, request);
    let deadline = AbortSignal.any([
      AbortSignal.timeout(method === 'initialize' || method === 'open' ? 35000 : method === 'stop' ? 3000 : 15000),
      ...(signal && method !== 'stop' ? [signal] : []),
      ...(operationSignal ? [operationSignal] : [])
    ]);
    let abort = () => {
      requests.delete(id);
      request.reject(new Error(`Browser ${method} cancelled or exceeded its deadline.`, { cause: deadline.reason }));
    };
    deadline.addEventListener('abort', abort, { once: true });
    if (deadline.aborted) abort();
    else
      owned.child.send({ id, method, input }, (error) => {
        if (error) request.reject(error);
      });
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
          try { await stopProfileProcesses(profile); }
          finally { await rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
        }
      }
      return Object.freeze({ graceful });
    })());
  try {
    await owned.ready;
    let identity = Object.freeze(await invoke('initialize', { plan: { ...plan, profile }, viewport }));
    return Object.freeze({
      identity,
      capabilities: Object.freeze({
        screenshot: true,
        fullPage: plan.provider !== 'webdriver' || plan.name !== 'safari',
        hostViewport: true
      }),
      open: (url) => invoke('open', { url }),
      activate: () => invoke('activate'),
      resize: (size, operationSignal) => invoke('resize', size, operationSignal),
      capture: async (options, operationSignal) =>
        Buffer.from(await invoke('capture', options, operationSignal), 'base64'),
      stop,
      get logs() {
        return owned.logs;
      }
    });
  } catch (error) {
    await stop();
    let help = '';
    if (plan.name === 'safari')
      help = ' Enable Safari Remote Automation explicitly before using webdriver, or use --manual for URL-only tests.';
    else if (plan.name === 'firefox' && error.message.includes('Could not find profile folder'))
      help =
        ' This Firefox build cannot start its profile on this macOS release. Use a fixed build, or installed Firefox 158+ through webdriver.';
    else if (plan.provider === 'playwright')
      help = ` Install matching builds with dyno install --browser ${plan.name}.`;
    throw new Error(`${error.message}${help}`, { cause: error });
  }
}
