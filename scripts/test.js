import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { resolveBrowser } from '../src/launcher.js';

let browser = process.argv[2] ?? 'chrome';
let selected = await resolveBrowser({ name: browser });
console.log(`[browser] ${browser}: ${selected.path}`);
let files = (await readdir(new URL('../tests/', import.meta.url))).filter(file => file.endsWith('.test.js')).sort().map(file => `tests/${file}`);
let child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: new URL('../', import.meta.url), env: { ...process.env, DYNO_TEST_BROWSER: browser }, stdio: 'inherit'
});
let [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
