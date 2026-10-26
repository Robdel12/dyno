import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { resolveBrowser } from '../src/launcher.js';

let browser = process.argv[2] ?? 'chrome';
let selected = await resolveBrowser({ name: browser });
let { stdout, stderr } = await promisify(execFile)(selected.path, ['--version'], { timeout: 10000 });
console.log(`[browser] ${browser}: ${selected.path}\n${(stdout || stderr).trim()}`);
let files = (await readdir(new URL('../tests/', import.meta.url))).filter(file => file.endsWith('.test.js')).sort().map(file => `tests/${file}`);
let child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: new URL('../', import.meta.url), env: { ...process.env, DYNO_TEST_BROWSER: browser }, stdio: 'inherit'
});
let [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
