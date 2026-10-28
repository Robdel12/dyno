import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, writeFile, readFile } from 'node:fs/promises';
import { project, exec, repository } from '../helpers/project.js';

test('the packaged artifact installs and runs the documented first-test workflow', { timeout: 150000 }, async t => {
  let fixture = await project(t);
  let { stdout: packed } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', fixture.directory], { cwd: repository, timeout: 10000 });
  let [pack] = JSON.parse(packed);
  assert.ok(pack.files.some(file => file.path === 'src/browsers.js'));
  assert.ok(pack.files.some(file => file.path === 'docs/browsers.md'));
  assert.ok(pack.files.some(file => file.path === 'docs/architecture.md'));
  assert.equal(pack.files.some(file => file.path.startsWith('tests/')), false);
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(fixture.directory, '.npm-cache'), join(fixture.directory, pack.filename)], { cwd: fixture.directory, timeout: 60000 });
  await rm(join(fixture.directory, 'dyno.config.js'));
  let bin = join(fixture.directory, 'node_modules/dyno/bin/dyno.js');
  await exec(process.execPath, [bin, 'init'], { cwd: fixture.directory, timeout: 5000 });
  await writeFile(join(fixture.directory, 'tests/browser/home.test.js'), `import {test} from 'dyno'; test('installed package opens the app', async ({app,I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });`);
  await writeFile(join(fixture.directory, 'dyno.config.js'), `import {defineConfig} from 'dyno/config'; export default defineConfig({port:0, browser:{name:${JSON.stringify(process.env.DYNO_TEST_BROWSER ?? 'chrome')}}, webServer:{command:[${JSON.stringify(process.execPath)},${JSON.stringify(join(repository,'tests/fixtures/app-server.js'))}],url:'http://127.0.0.1:${fixture.port}',env:{PORT:'${fixture.port}'}}});`);
  let { stdout, stderr } = await exec(process.execPath, [bin, '--json'], { cwd: fixture.directory, timeout: 70000 });
  let events = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.find(event => event.type === 'complete').passed, 2, stderr + stdout);
  await assert.rejects(exec(process.execPath, [bin, '--provider', 'playwright'], { cwd: fixture.directory, timeout: 10000 }), /requires playwright-core/);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('a developer can install the checkout, initialize a project, and run its first browser test', { timeout: 90000 }, async t => {
  let fixture = await project(t);
  await exec('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(fixture.directory, '.npm-cache'), repository], { cwd: fixture.directory, timeout: 15000 });
  await rm(join(fixture.directory, 'dyno.config.js'));
  let bin = join(fixture.directory, 'node_modules/.bin/dyno');
  await exec(bin, ['init'], { cwd: fixture.directory, timeout: 5000 });
  assert.match(await readFile(join(fixture.directory, 'tests/browser/home.test.js'), 'utf8'), /from 'dyno'/);
  await writeFile(join(fixture.directory, 'tests/browser/home.test.js'), `import { test } from 'dyno'; test('my first test', async ({ app, I }) => { await app.goto('/'); await I.find('Fixture app').visible(); });`);
  await writeFile(join(fixture.directory, 'dyno.config.js'), `import { defineConfig } from 'dyno/config'; export default defineConfig({ port: 0, browser: {name: ${JSON.stringify(process.env.DYNO_TEST_BROWSER ?? 'chrome')}}, webServer: { command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(join(repository, 'tests/fixtures/app-server.js'))}], url: 'http://127.0.0.1:${fixture.port}', env: {PORT: '${fixture.port}'} } });`);
  let { stdout, stderr } = await exec(bin, ['--json'], { cwd: fixture.directory, timeout: 70000 });
  let events = stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.equal(events.find(event => event.type === 'complete')?.passed, 2, stderr + stdout);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});
