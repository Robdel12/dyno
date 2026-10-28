import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { glob, mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowser } from '../src/launcher.js';

let [suite = 'all', browser = 'chrome', ...extra] = process.argv.slice(2);
let directories = ['core', 'browser', 'package', 'capture'];
let suites = ['all', ...directories];
let needsBrowser = ['all', 'browser', 'package'].includes(suite);
if (!suites.includes(suite) || extra.length || (!needsBrowser && process.argv[3]))
  throw new Error('Usage: node scripts/test.js [all|core|browser|package|capture] [browser for all/browser/package]');

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
  let selected = await resolveBrowser({ name: browser });
  console.log(`[browser] ${browser}: ${selected.path}`);
  environment.DYNO_TEST_BROWSER = browser;
}
let args = ['--test', '--test-concurrency=1', '--test-reporter=spec'];
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
let child = spawn(process.execPath, [...args, ...files], { cwd: root, env: environment, stdio: 'inherit' });
let [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
