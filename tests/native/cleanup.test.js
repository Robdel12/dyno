import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createBrowserPool, resolveSession } from '../../src/browser-session.js';
import { startWebServer } from '../../src/process.js';
import { createGateway } from '../../src/server.js';
import { createReportWriter } from '../../src/reports.js';
import { exec, project } from '../helpers/project.js';

let browser = { name: process.env.DYNO_TEST_BROWSER ?? 'chromium' };

async function crashOwnedProvider() {
  let processes;
  if (process.platform === 'win32') {
    let { stdout } = await exec(
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
    let { stdout } = await exec('ps', ['-axww', '-o', 'pid=,ppid=,command='], { timeout: 5000 });
    processes = stdout
      .trim()
      .split('\n')
      .map((line) => {
        let [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/) ?? [];
        return { pid: Number(pid), parent: Number(parent), command: command ?? '' };
      });
  }
  let workers = processes.filter(
    (item) =>
      item.parent === process.pid &&
      item.command.replaceAll('"', '').replaceAll('\\', '/').trim().endsWith('/src/providers/worker.js'),
  );
  assert.equal(workers.length, 1, 'Expected this test to own exactly one provider worker');
  let worker = workers[0];
  if (process.platform === 'win32') {
    await exec('taskkill', ['/pid', String(worker.pid), '/T', '/F'], { timeout: 5000 });
    return;
  }
  let owned = new Set([worker.pid]);
  for (let size = -1; size !== owned.size; ) {
    size = owned.size;
    for (let item of processes) if (owned.has(item.parent)) owned.add(item.pid);
  }
  let signal = (pid, value) => {
    try {
      process.kill(pid, value);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  // Crash the IPC worker while its browser server remains owned by the parent.
  // Native cleanup must fail clearly and still close that server.
  try {
    for (let pid of owned) signal(pid, 'SIGSTOP');
  } finally {
    for (let pid of [...owned].reverse()) signal(pid, 'SIGKILL');
  }
}

test(
  'native cleanup failure still delivers and saves the terminal failure',
  { timeout: 90000 },
  async (suite) => {
    for (let terminalType of ['fatal', 'complete'])
      await suite.test(terminalType, async (t) => {
        let fixture = await project(t, {
          config: { browser, timeout: 60000 },
          source: `
describe('Native cleanup failure', () => {
  test('holds real native state until its browser stops', async ({ app }) => {
    await app.goto('/');
    await app.native.setReducedMotion('reduce');
    await app.request('/api/inspection', {
      method: 'POST',
      body: parent.sessionStorage.getItem('dyno:previous'),
    });
    await app.request('/api/release-browser');
  });
});`,
        });
        let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
        let bundle = await buildSuite(config);
        let writer = createReportWriter(config.reportDir);
        let notifications = new EventEmitter();
        let events = [];
        let app, session, gateway, pool;
        try {
          app = await startWebServer(config.webServer, { signal: t.signal });
          gateway = await createGateway(config, bundle, {
            onRun: (run) => writer.save(run),
            onEvent: (event) => {
              events.push(event);
              if (event.type === 'fatal' || event.type === 'complete')
                notifications.emit('terminal', event);
            },
          });
          pool = await createBrowserPool(await resolveSession(browser), { signal: t.signal });
          t.after(pool.stop);
          session = await pool.createWorker('0');
          let launchKey = randomUUID();
          gateway.attachSession(session, launchKey);
          let url = new URL(gateway.url);
          url.hash = new URLSearchParams({ launch: launchKey }).toString();
          await session.open(url.href);
          // The actual runtime publishes its connection after changing browser
          // media. Fixture HTTP lets this client observe that completed effect.
          let credentials = await (
            await fetch(new URL('/api/inspection', config.webServer.url), { signal: t.signal })
          ).json();
          let post = (event) =>
            fetch(gateway.url + 'events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...credentials, ...event }),
              signal: t.signal,
            });
          if (terminalType === 'complete') {
            let runs = await (
              await fetch(gateway.url + 'results', { signal: t.signal })
            ).json();
            let run = runs.find((run) => run.runId === credentials.runId);
            let descriptor = run.tests[0];
            let reported = await post({
              type: 'test',
              testId: descriptor.id,
              executionId: run.assignments[0].id,
              index: 0,
              name: descriptor.name,
              status: 'passed',
              duration: 1,
            });
            assert.equal(reported.status, 200, await reported.text());
          }
          let observed = once(notifications, 'terminal', { signal: t.signal });
          observed.catch(() => {});
          // Crash the real owned provider without allowing browser unload JS.
          // Cleanup still crosses IPC to a stopped worker, with no fake session.
          await crashOwnedProvider();
          let response = await post(
            terminalType === 'fatal'
              ? { type: 'fatal', error: { message: 'Browser ended while native state was active.' } }
              : { type: 'complete', duration: 1 },
          );
          assert.equal(response.status, 200, await response.text());
          let [terminal] = await observed;
          assert.equal(terminal.type, 'fatal');
          let expected =
            terminalType === 'fatal'
              ? /Browser ended while native state was active\. Native cleanup:/
              : /Native browser cleanup failed:/;
          assert.match(terminal.error.message, expected);
          assert.ok(!events.some((event) => event.type === 'complete'));
          let report = JSON.parse(
            await readFile(join(config.reportDir, credentials.runId, 'run.json'), 'utf8'),
          );
          assert.equal(report.status, 'interrupted');
          assert.match(report.error.message, expected);
          assert.match(report.error.message, /closed|disconnect|IPC|channel|resetNative/i);
          await gateway.close();
          gateway = undefined;
        } finally {
          let cleanup = await Promise.allSettled([gateway?.close(), pool?.stop(), app?.stop()]);
          let failures = cleanup
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason);
          if (failures.length)
            throw new AggregateError(failures, 'Could not close the native cleanup fixture.');
        }
      });
  },
);
