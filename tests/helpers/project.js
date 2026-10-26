import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export let repository = fileURLToPath(new URL('../../', import.meta.url));
export let exec = promisify(execFile);
let appServer = join(repository, 'tests/fixtures/app-server.js');

export function launch(command, args, cwd, signal) {
  let child = spawn(command, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let pending = '';
  let events = [];
  let subscribers = new Set();
  let closed = false;
  let spawnError;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
    pending += chunk;
    let lines = pending.split('\n');
    pending = lines.pop();
    for (let line of lines) {
      if (!line.startsWith('{')) continue;
      try {
        let event = JSON.parse(line);
        events = [...events, event];
        for (let receive of subscribers) receive(event);
      } catch {}
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => { spawnError = error; });
  let completion = new Promise(resolve => child.once('close', (code, exitSignal) => {
    closed = true;
    for (let receive of subscribers) receive(null);
    resolve({ code, signal: exitSignal, stdout, stderr, events, summary: events.find(event => event.type === 'complete') });
  }));
  let stopping;
  return {
    child, completion,
    waitForEvent(type) {
      let found = events.find(event => event.type === type);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        let cleanup = () => { subscribers.delete(receive); signal?.removeEventListener('abort', aborted); };
        let aborted = () => { cleanup(); reject(signal.reason); };
        let receive = event => {
          if (!event) { cleanup(); reject(spawnError ?? new Error(`CLI exited before ${type}: ${stderr}${stdout}`)); }
          else if (event.type === type) { cleanup(); resolve(event); }
        };
        subscribers.add(receive);
        signal?.addEventListener('abort', aborted, { once: true });
        if (closed) receive(null);
        if (signal?.aborted) aborted();
      });
    },
    stop() {
      stopping ??= (async () => {
        if (!closed) {
          child.kill('SIGTERM');
          try { await once(child, 'close', { signal: AbortSignal.timeout(7000) }); }
          catch (error) {
            if (error.name !== 'AbortError') throw error;
            if (child.pid) process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL');
          }
        }
        return completion;
      })();
      return stopping;
    }
  };
}

async function availablePort() {
  let socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  let port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

export async function project(t, { source = "test('opens the app', async ({ app, I }) => { await app.goto('/'); await I.find('Fixture app').visible(); });", config: overrides = {}, files = {} } = {}) {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-workflow-'));
  let sessions = [];
  t.after(async () => {
    for (let session of sessions.toReversed()) await session.stop();
    await rm(directory, { recursive: true, force: true });
  });
  let port = await availablePort();
  await mkdir(join(directory, 'tests/browser'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'tests/browser/workflow.test.js'), `import { test, beforeEach, afterEach } from 'dyno';\n${source}`);
  let config = {
    testDir: './tests/browser', port: 0, timeout: 2500, expectTimeout: 500, runTimeout: 15000, ...overrides,
    webServer: { command: [process.execPath, appServer], url: `http://127.0.0.1:${port}`, ready: 'FIXTURE_READY', env: { PORT: String(port) }, ...overrides.webServer }
  };
  await writeFile(join(directory, 'dyno.config.js'), `export default ${JSON.stringify(config)};`);
  for (let [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), contents);
  }
  return Object.freeze({
    directory, port,
    run(args = []) {
      let session = launch(process.execPath, [join(repository, 'bin/dyno.js'), '--json', ...args], directory, t.signal);
      sessions = [...sessions, session];
      return session;
    }
  });
}
