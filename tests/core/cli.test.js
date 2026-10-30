import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { project, exec, repository, launch } from '../helpers/project.js';

let cli = join(repository, 'bin/dyno.js');
let eventsFrom = (stdout) =>
  stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

async function failedCLI(args, directory = repository) {
  let session = launch(process.execPath, [cli, ...args, '--json'], directory);
  let result = await session.completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let events = eventsFrom(result.stdout);
  assert.equal(events.at(-1).type, 'error', result.stdout);
  return events.at(-1).message;
}

test('help, version, and browser discovery work without an app config', { timeout: 10000 }, async () => {
  for (let args of [['--help'], ['--version'], ['browsers'], ['--help', '--browser', 'bogus'], ['--version', '--port', 'nope']]) {
    let { stdout } = await exec(process.execPath, [cli, ...args, '--json'], { cwd: tmpdir(), timeout: 5000 });
    let [event] = eventsFrom(stdout);
    assert.equal(event.type, args[0] === 'browsers' ? 'browsers' : args[0].slice(2));
    if (event.type === 'browsers') {
      assert.deepEqual(
        event.browsers.map((browser) => browser.name),
        ['chromium', 'firefox', 'webkit']
      );
      assert.ok(event.browsers.every(browser => typeof browser.installed === 'boolean' && browser.path));
    }
  }
});

test('CLI mistakes are structured errors and never partially initialize a project', { timeout: 15000 }, async (t) => {
  let fixture = await project(t);
  let original = await readFile(join(fixture.directory, 'dyno.config.js'), 'utf8');
  for (let [args, message] of [
    [['init', 'extra'], /too many arguments/i],
    [['init', '--ui'], /unknown option/i],
    [['--ui', '--manual'], /cannot be used/],
    [['--port', ''], /--port/],
    [['--browser', 'netscape'], /Allowed choices/],
    [['--manual', '--browser', 'firefox'], /cannot be used/],
    [['--test', '  '], /non-empty/],
    [['--unknown'], /unknown option/i]
  ])
    assert.match(await failedCLI(args, fixture.directory), message);
  assert.equal(await readFile(join(fixture.directory, 'dyno.config.js'), 'utf8'), original);
  await assert.rejects(readFile(join(fixture.directory, 'tests/browser/home.test.js')), { code: 'ENOENT' });
});

test('each command explains its own options and examples without loading an app', { timeout: 15000 }, async () => {
  for (let [command, present, absent] of [
    ['run', '--watch', 'Engine build to download'],
    ['doctor', '--ui', '--watch'],
    ['install', '--with-deps', '--test'],
    ['init', 'without overwriting', '--browser'],
    ['browsers', 'installed Playwright browser builds', '--provider'],
  ]) {
    let { stdout, stderr } = await exec(process.execPath, [cli, command, '--help', '--json'], { cwd: tmpdir(), timeout: 5000 });
    let [event] = eventsFrom(stdout);
    assert.equal(event.type, 'help');
    assert.ok(event.text.includes(`Usage: dyno ${command}`), event.text);
    assert.ok(event.text.includes(present), event.text);
    assert.ok(!event.text.includes(absent), event.text);
    assert.equal(stderr, '');
  }
  let direct = await exec(process.execPath, [cli, 'doctor', '--help'], { cwd: tmpdir(), timeout: 5000 });
  assert.match(direct.stdout, /Usage: dyno doctor/);
  assert.equal(direct.stderr, '');
  let help = await exec(process.execPath, [cli, 'help', 'run', '--json'], { cwd: tmpdir(), timeout: 5000 });
  assert.match(eventsFrom(help.stdout)[0].text, /Usage: dyno run/);
});

test('usage errors name the problem, suggest corrections, and link to the relevant help', { timeout: 15000 }, async () => {
  for (let [args, code, content, hint] of [
    [['--brower', 'firefox'], 'commander.unknownOption', /Did you mean --browser/, 'dyno run --help'],
    [['install', '--browser', 'safari'], 'commander.invalidArgument', /Allowed choices.*chromium.*firefox.*webkit/, 'dyno install --help'],
    [['doctor', '--watch'], 'commander.unknownOption', /unknown option '--watch'/i, 'dyno doctor --help'],
    [['run', '--manual', '--ui'], 'commander.conflictingOption', /--manual.*cannot be used.*--ui/, 'dyno run --help'],
    [['run', '--port', '65536'], 'commander.invalidArgument', /between 0 and 65535/, 'dyno run --help'],
    [['init', 'unexpected'], 'commander.excessArguments', /too many arguments.*unexpected/i, 'dyno init --help'],
  ]) {
    let result = await launch(process.execPath, [cli, ...args, '--json'], tmpdir()).completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    let [error] = eventsFrom(result.stdout);
    assert.equal(error.type, 'error');
    assert.equal(error.code, code);
    assert.match(error.message, content);
    assert.ok(error.message.includes(hint), error.message);
    assert.ok(result.stderr.includes(hint), result.stderr);
    assert.equal(result.events.length, 1);
  }
});

test('default execution retains repeated filters and numeric overrides through the real CLI', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let session = fixture.run(['--manual', '--file', 'first.test.js', '--file', 'second.test.js', '--suite', 'Contacts', '--suite', 'Support', '--id', 'first', '--id', 'second', '--port', '0']);
  let ready = await session.waitForEvent('ready');
  let url = new URL(ready.url);
  assert.deepEqual(url.searchParams.getAll('file'), ['first.test.js', 'second.test.js']);
  assert.deepEqual(url.searchParams.getAll('suite'), ['Contacts', 'Support']);
  assert.deepEqual(url.searchParams.getAll('id'), ['first', 'second']);
  session.child.kill('SIGTERM');
  assert.equal((await session.completion).code, 143);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('config typos and unsafe profile overrides fail before app startup', { timeout: 15000 }, async (t) => {
  for (let config of [
    { timeuot: 1000 },
    { timeout: 2147483648 },
    { browser: { name: 'netscape' } },
    { browser: { provider: 'playwright' } },
    { browser: { args: ['--user-data-dir=/some/user/profile'] } },
    { webServer: { reuseExistingServer: 'yes' } },
    { webServer: { env: { PORT: 12 } } }
  ]) {
    let fixture = await project(t, { config });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(
      result.events.some((event) => event.type === 'ready'),
      false
    );
    assert.equal(result.events.at(-1).type, 'error');
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  }
});

test('unsupported managed browsers fail before starting an app', { timeout: 10000 }, async (t) => {
  let fixture = await project(t);
  let result = await fixture.run(['--browser', 'safari']).completion;
  assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, /safari.*invalid/i);
  assert.equal(
    result.events.some((event) => event.type === 'ready'),
    false
  );
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test(
  'doctor validates tests, browser prerequisites, and app startup without starting processes',
  { timeout: 15000 },
  async (t) => {
    let fixture = await project(t);
    let result = await fixture.run(['doctor', '--manual']).completion;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    let diagnosis = result.events.find((event) => event.type === 'diagnosis');
    assert.equal(diagnosis.ok, true);
    assert.ok(diagnosis.checks.some((check) => check.name === 'tests' && check.status === 'passed'));
    assert.equal(
      result.events.some((event) => event.type === 'ready'),
      false
    );
    await assert.rejects(fetch('http://127.0.0.1:' + fixture.port));
    let missing = await fixture.run(['doctor', '--browser-path', '/missing/browser']).completion;
    assert.equal(missing.code, 1);
    assert.equal(missing.events.find((event) => event.type === 'diagnosis').ok, false);
    let absent = await fixture.run(['doctor'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(fixture.directory, 'no-browsers') } }).completion;
    assert.equal(absent.code, 1);
    assert.match(absent.events.find(event => event.type === 'diagnosis').checks.find(check => check.name === 'browser').message, /dyno install --browser/);
    let manual = await fixture.run(['doctor', '--manual']).completion;
    assert.equal(manual.code, 0);
    assert.ok(
      manual.events.find((event) => event.type === 'diagnosis').checks.some((check) => check.status === 'info')
    );
  }
);

test('project console diagnostics never corrupt JSON output, including teardown', { timeout: 15000 }, async t => {
  let fixture = await project(t, { config: { setup: './setup.js' }, files: {
    'setup.js': `console.log('setup imported'); export default () => {
      console.log('setup acquired');
      return { teardown() { console.log('setup released'); } };
    };`
  } });
  let config = join(fixture.directory, 'dyno.config.js');
  await writeFile(config, "console.log('config imported');\n" + await readFile(config, 'utf8'));
  let session = fixture.run(['--manual']);
  await session.waitForEvent('ready');
  session.child.kill('SIGTERM');
  let result = await session.completion;
  assert.equal(result.code, 143, result.stderr);
  assert.ok(eventsFrom(result.stdout).some(event => event.type === 'session-timing'));
  for (let message of ['config imported', 'setup imported', 'setup acquired', 'setup released'])
    assert.ok(result.stderr.includes(message), message);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});

test('interrupting browser installation stops its real downloader connection', { timeout: 20000, skip: process.platform === 'win32' }, async t => {
  let requested = Promise.withResolvers();
  let disconnected = Promise.withResolvers();
  let server = createServer((request, response) => {
    requested.resolve();
    response.on('close', disconnected.resolve);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  let fixture = await project(t);
  let session = fixture.run(['install', '--browser', 'chromium'], { env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: join(fixture.directory, 'browser-download'),
    PLAYWRIGHT_DOWNLOAD_HOST: `http://127.0.0.1:${server.address().port}`,
  } });
  await Promise.race([
    requested.promise,
    session.completion.then(result => { throw new Error('Installer exited before downloading: ' + result.stderr); }),
  ]);
  session.child.kill('SIGTERM');
  let result = await session.completion;
  await disconnected.promise;
  assert.equal(result.code, 143, result.stderr);
  assert.equal(result.events.at(-1).signal, 'SIGTERM');
  assert.equal(result.events.some(event => event.type === 'installed'), false);
});

test('init rejects an explicit CommonJS package before writing ES module scaffolds', { timeout: 10000 }, async (t) => {
  let fixture = await project(t, { files: { 'package.json': '{"type":"commonjs"}' } });
  let result = await fixture.run(['init']).completion;
  assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, /config uses ES modules/);
  await assert.rejects(readFile(join(fixture.directory, 'tests/browser/home.test.js')), { code: 'ENOENT' });
});
