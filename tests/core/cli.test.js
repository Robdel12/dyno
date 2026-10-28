import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { project, exec, repository, launch } from '../helpers/project.js';

let cli = join(repository, 'bin/dyno.js');
let eventsFrom = stdout => stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

async function failedCLI(args, directory = repository) {
  let session = launch(process.execPath, [cli, ...args, '--json'], directory);
  let result = await session.completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let events = eventsFrom(result.stdout);
  assert.equal(events.at(-1).type, 'error', result.stdout);
  return events.at(-1).message;
}

test('help, version, and browser discovery work without an app config', { timeout: 10000 }, async () => {
  for (let args of [['--help'], ['--version'], ['browsers']]) {
    let { stdout } = await exec(process.execPath, [cli, ...args, '--json'], { cwd: tmpdir(), timeout: 5000 });
    let [event] = eventsFrom(stdout);
    assert.equal(event.type, args[0] === 'browsers' ? 'browsers' : args[0].slice(2));
    if (event.type === 'browsers') {
      assert.deepEqual(event.browsers.map(browser => browser.name), ['chrome', 'chromium', 'edge', 'firefox', 'safari']);
      assert.equal(event.browsers.find(browser => browser.name === 'safari').headless, false);
    }
  }
});

test('CLI mistakes are structured errors and never partially initialize a project', { timeout: 15000 }, async t => {
  let fixture = await project(t);
  let original = await readFile(join(fixture.directory, 'dyno.config.js'), 'utf8');
  for (let [args, message] of [
    [['init', 'extra'], /Unknown command/],
    [['init', '--ui'], /only available/],
    [['--ui', '--manual'], /Choose/],
    [['--port', ''], /--port/],
    [['--browser', 'netscape'], /Unknown browser/],
    [['--manual', '--browser', 'firefox'], /does not launch/],
    [['--test', '  '], /non-empty/],
    [['--unknown'], /Unknown option/]
  ]) assert.match(await failedCLI(args, fixture.directory), message);
  assert.equal(await readFile(join(fixture.directory, 'dyno.config.js'), 'utf8'), original);
  await assert.rejects(readFile(join(fixture.directory, 'tests/browser/home.test.js')), { code: 'ENOENT' });
});

test('config typos and unsafe profile overrides fail before app startup', { timeout: 15000 }, async t => {
  for (let config of [
    { timeuot: 1000 }, { timeout: 2147483648 }, { browser: { name: 'netscape' } },
    { browser: { args: ['--user-data-dir=/some/user/profile'] } },
    { webServer: { reuseExistingServer: 'yes' } }, { webServer: { env: { PORT: 12 } } }
  ]) {
    let fixture = await project(t, { config });
    let result = await fixture.run().completion;
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(result.events.some(event => event.type === 'ready'), false);
    assert.equal(result.events.at(-1).type, 'error');
    await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
  }
});

test('Safari headless requests explain the supported mode before starting an app', { timeout: 10000 }, async t => {
  let fixture = await project(t);
  let result = await fixture.run(['--browser', 'safari']).completion;
  assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, /Safari.*(headless|macOS)/);
  assert.equal(result.events.some(event => event.type === 'ready'), false);
  await assert.rejects(fetch(`http://127.0.0.1:${fixture.port}`));
});
