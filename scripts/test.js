import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, glob, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserEngine } from '../src/browsers.js';

let [suite = 'all', browser = 'chromium', ...extra] = process.argv.slice(2);
let directories = ['core', 'browser', 'package', 'capture'];
let suites = ['all', ...directories];
let needsBrowser = ['all', 'browser', 'package', 'capture'].includes(suite);
if (!suites.includes(suite) || extra.length || (!needsBrowser && process.argv[3]))
  throw new Error('Usage: node scripts/test.js [all|core|browser|package|capture] [chromium|firefox|webkit for browser suites]');

let root = fileURLToPath(new URL('../', import.meta.url));
let files = [];
for await (let file of glob('tests/**/*.test.js', { cwd: root })) {
  let directory = file.split(sep)[1];
  if (!directories.includes(directory))
    throw new Error(`Place ${file} under tests/core, tests/browser, tests/package, or tests/capture so CI runs it.`);
  if (suite === 'all' || directory === suite) files.push(file);
}
files.sort();
if (!files.length) throw new Error(`No tests found for ${suite}.`);

let environment = { ...process.env };
if (needsBrowser) {
  let engine = browserEngine(browser);
  if (!['chromium', 'firefox', 'webkit'].includes(browser)) throw new Error(`Unknown Playwright engine "${browser}". Choose chromium, firefox, or webkit.`);
  let path = engine.executablePath();
  try {
    await access(path);
  } catch {
    throw new Error(`Playwright ${browser} is not installed. Run node bin/dyno.js install --browser ${browser}.`);
  }
  console.log(`[browser] ${browser}: ${path}`);
  environment.DYNO_TEST_BROWSER = browser;
  environment.DYNO_CAPTURE_BROWSER = browser;
}
// Each browser file owns its app, gateway, profiles, and fixture directory.
let args = ['--test', `--test-concurrency=${suite === 'browser' ? 3 : 1}`, '--test-reporter=spec'];
if (process.env.DYNO_TEST_REPORT_DIR) {
  let directory = resolve(root, process.env.DYNO_TEST_REPORT_DIR);
  await mkdir(directory, { recursive: true });
  args.push(
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    `--test-reporter-destination=${join(directory, 'results.xml')}`
  );
}
console.log(`[tests] ${suite}: ${files.length} file(s)`);
let ports = await mkdtemp(join(tmpdir(), 'dyno-test-ports-'));
try {
  let child = spawn(process.execPath, [...args, ...files], {
    cwd: root, env: { ...environment, DYNO_TEST_PORT_DIR: ports }, stdio: 'inherit'
  });
  let [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally { await rm(ports, { recursive: true, force: true }); }
