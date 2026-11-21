import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { launch, project, repository } from '../helpers/project.js';
import { openURL } from '../helpers/manual.js';

function terminalText(session) {
  let output = '';
  let listeners = new Set();
  let receive = chunk => {
    output += chunk;
    for (let listener of listeners) listener();
  };
  session.child.stdout.on('data', receive);
  session.child.stderr.on('data', receive);
  return pattern => new Promise((resolve, reject) => {
    let inspect = () => {
      let match = output.match(pattern);
      if (match) { listeners.delete(inspect); resolve(match); }
    };
    listeners.add(inspect);
    inspect();
    session.completion.then(result => {
      if (listeners.delete(inspect)) reject(new Error(`CLI exited before ${pattern}: ${result.stdout}${result.stderr}`));
    });
  });
}

// The summary prints the report path relative to the project directory.
let reportPath = (stdout, directory) => resolve(directory, stdout.match(/^ {2}Report +(\S+)$/m)[1]);

function terminalRun(t, fixture, args = []) {
  let session = launch(process.execPath, [join(repository, 'bin/dyno.js'), ...args], fixture.directory, t.signal);
  t.after(() => session.stop());
  return session.completion;
}

test('terminal output explains functional outcomes, saved screenshots, and independent coverage failures', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: {
      coverage: { enabled: true, baseline: '.dyno/coverage-baseline.json', include: ['src/**'],
        reporters: ['text', 'json'], thresholds: { functions: 100 } },
      webServer: { command: [process.execPath, join(repository, 'tests/fixtures/coverage-app-server.js')], ready: 'COVERAGE_READY' },
    },
    files: {
      'src/app.ts': `document.querySelector('#accept').addEventListener('click', () => {
        document.querySelector('output').textContent = 'Accepted';
      });`,
      'src/unvisited.ts': 'export function unused() { return 42; }',
    },
    source: `describe('Terminal workflow', () => {
      test('saves a choice', async ({app, I}) => {
        await app.goto('/'); await I.click('Accept'); await I.find('$([role=status])').text('Accepted');
        await app.screenshot('terminal-state');
      });
      test.skip('unfinished work');
      test('explains a failure', () => {
        let error = new Error('The confirmation is missing');
        error.stack = 'confirm@/src/contact.js:12:3';
        throw error;
      });
    });`,
  });
  let result = await terminalRun(t, fixture);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  for (let text of ['3 tests in 1 file, app at 127.0.0.1:', '\n  Terminal workflow\n', '✓ saves a choice',
    '− unfinished work  skipped', '✗ explains a failure', 'Failures', '1  Terminal workflow › explains a failure',
    "Rerun  dyno --test 'Terminal workflow › explains a failure' --file 'tests/browser/workflow.test.js'",
    '✗ 1 of 3 tests failed in', 'Tests      1 failed, 1 passed, 1 skipped', 'Images     1 screenshot in .dyno/',
    'Coverage', '50% functions', 'in all included files', 'Total']) assert(result.stdout.includes(text), result.stdout);
  assert.doesNotMatch(result.stdout, /Runner/);
  assert.match(result.stdout, /1 {2}Terminal workflow › explains a failure\n {3}The confirmation is missing\n/);
  assert.match(result.stdout, /\n {3}confirm@\/src\/contact.js:12:3\n/);
  assert.doesNotMatch(result.stdout, /Slowest/);
  assert.match(result.stdout, /functions coverage is 50%, below the 100% threshold/);
  assert.equal(result.stderr.includes('The confirmation is missing'), false, result.stderr);
  let html = reportPath(result.stdout, fixture.directory);
  let report = JSON.parse(await readFile(join(dirname(html), 'run.json'), 'utf8'));
  assert.deepEqual(report.tests.map(test => test.status), ['passed', 'skipped', 'failed']);
  assert.equal(report.coverage.failed, true);
  assert.equal(report.tests[0].attachments[0].status, 'captured');
  assert((await readFile(join(dirname(html), report.tests[0].attachments[0].path))).length > 0);
});

test('terminal repeated-run output retains a failed round and prints reproducible commands', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    config: { setup: './setup.js' },
    files: { 'setup.js': `export default () => { let round = 0;
      return {beforeExecution: () => ({fixtures: {round: ++round}})};
    };` },
    source: `describe('Confirmation', () => { test('appears', async ({app, I, fixtures}) => {
      await app.goto('/'); await I.find('Fixture app').visible();
      await I.assert(() => fixtures.round > 1, 'Confirmation was missing in round one');
    }); });`,
  });
  let result = await terminalRun(t, fixture, ['--repeat', '2', '--seed', 'terminal-rounds']);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  for (let text of ['Root seed  terminal-rounds', 'Round 1/2', 'Round 2/2',
    'Repeat     2 rounds', '✗ Repeated runs failed', '2 of 2 completed, 1 round with failures',
    'Confirmation › appears  1 failed, 1 passed', 'failed in round 1: Confirmation was missing in round one',
    'Replay ', 'Reproduce', '--repeat 1', '--seed', 'Report'])
    assert(result.stdout.includes(text), result.stdout);
  assert.match(result.stdout, /1 {2}Confirmation › appears/);
});

test('a failure with an intentionally empty stack still prints its reason', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `describe('Failure diagnostics', () => { test('keeps the reason', () => {
      let error = new Error('The save was rejected'); error.stack = ''; throw error;
    }); });`,
  });
  let result = await terminalRun(t, fixture);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /1 failed/);
  assert.match(result.stdout, /1 {2}Failure diagnostics › keeps the reason\n {3}The save was rejected/);
});

test('a shell app command can report readiness with a regular expression', {
  timeout: 90000, skip: process.platform === 'win32',
}, async t => {
  let fixture = await project(t);
  let quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  let command = `${quote(process.execPath)} ${quote(join(repository, 'tests/fixtures/app-server.js'))}`;
  await writeFile(join(fixture.directory, 'dyno.config.js'), `export default {
    port: 0, browser: {name: ${JSON.stringify(process.env.DYNO_TEST_BROWSER ?? 'chromium')}},
    webServer: {url: 'http://127.0.0.1:${fixture.port}', command: ${JSON.stringify(command)},
      env: {PORT: '${fixture.port}'}, ready: /FIXTURE_READY/g},
  };`);
  let result = await fixture.run().completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 1);
});

test('parallel execution explains its project isolation requirement before running tests', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: { workers: 2 } });
  let result = await terminalRun(t, fixture);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Concurrent runs need setup.createWorker.*isolated project resources/);
  assert.doesNotMatch(result.stdout, /Running \d+ tests?/);
});

test('the manual terminal session prints its reporter and explains skipped optional images', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `describe('Manual session', () => { test('keeps optional screenshots optional', async ({app, I}) => {
      await app.goto('/'); await I.find('Fixture app').visible();
      let image = await app.screenshot('Optional review image', {optional: true});
      await I.assert(() => image.status === 'skipped');
    }); });`,
  });
  let session = launch(process.execPath, [join(repository, 'bin/dyno.js'), '--manual'], fixture.directory, t.signal);
  t.after(() => session.stop());
  let text = terminalText(session);
  let [, url] = await text(/Open +(http:\/\/[^\s]+)/);
  let page = await openURL(t, url + '#start=managed');
  await page.getByRole('button', { name: 'Start tests', exact: true }).click();
  let [, reporter] = await text(/Reporter +(http:\/\/[^\s]+)/);
  await text(/✓ 1 test passed/);
  assert.equal(new URL(reporter).origin, new URL(url).origin);
  let response = await fetch(reporter);
  assert.equal(response.status, 200);
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.match(result.stdout, /Screenshot "Optional review image" skipped \(.*no capture provider/);
  assert.match(result.stdout, /Report +.*index.html/);
});

test('watch terminal output explains a broken edit and recovers after the test is fixed', { timeout: 90000 }, async t => {
  let fixture = await project(t);
  let path = join(fixture.directory, 'tests/browser/workflow.test.js');
  let source = await readFile(path, 'utf8');
  let session = launch(process.execPath, [join(repository, 'bin/dyno.js'), '--watch'], fixture.directory, t.signal);
  t.after(() => session.stop());
  let text = terminalText(session);
  await text(/✓ 1 test passed/);
  await writeFile(path, 'describe( invalid syntax');
  await text(/Watch: [\s\S]*(?:Expected|expected)/);
  await writeFile(path, source);
  await text(/✓ 1 test passed[\s\S]*✓ 1 test passed/);
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.match(result.stderr, /Watch: /);
  assert.equal((result.stdout.match(/✓ opens the app/g) ?? []).length, 2);
});

test('the terminal explains parallel queue replay and which tests an interrupted schedule omits', { timeout: 90000 }, async t => {
  let setup = await readFile(new URL('../fixtures/concurrent-setup.js', import.meta.url), 'utf8');
  let fixture = await project(t, {
    config: { setup: './setup.js', workers: 2, webServer: { env: { GATE: 'false', OVERLAP: 'false' } } },
    files: { 'setup.js': setup },
    source: `describe('Parallel review', () => {
      for (let name of ['Ada', 'Grace', 'Margaret', 'Katherine']) test(name, async ({app, I, fixtures}) => {
        await app.goto('/'); await I.find('Worker ' + fixtures.worker).visible();
      });
    });`,
  });
  let original = await terminalRun(t, fixture, ['--seed', 'terminal-queues']);
  assert.equal(original.code, 0, original.stdout + original.stderr);
  assert.match(original.stdout, /4 tests in 1 file, 2 workers, app at/);
  assert.match(original.stdout, /Workers +2 workers, .* wall time, .* of test work/);
  let html = reportPath(original.stdout, fixture.directory);
  let schedule = join(dirname(html), 'schedule.json');
  let replayed = await terminalRun(t, fixture, ['--replay', schedule]);
  assert.equal(replayed.code, 0, replayed.stdout + replayed.stderr);
  assert.match(replayed.stdout, /Replay +4 assigned tests\n/);
  assert.match(replayed.stdout, /✓ All 4 tests passed in/);
  let manifest = JSON.parse(await readFile(schedule, 'utf8'));
  let assignments = manifest.assignments.slice(0, 2);
  let interrupted = join(fixture.directory, 'interrupted.json');
  await writeFile(interrupted, JSON.stringify({ ...manifest, assignments,
    completion: manifest.completion.filter(id => assignments.some(assignment => assignment.testId === id)) }));
  let prefix = await terminalRun(t, fixture, ['--replay', interrupted]);
  assert.equal(prefix.code, 0, prefix.stdout + prefix.stderr);
  assert.match(prefix.stdout, /Replay +2 assigned tests, 2 unassigned tests left out/);
  assert.match(prefix.stdout, /✓ All 2 tests passed in/);
});

test('LLM output gives each failure its location, code, console output, and rerun command', { timeout: 90000 }, async t => {
  let fixture = await project(t, {
    source: `describe('Agent review', () => {
      test('passes quietly', async ({app, I}) => { await app.goto('/'); await I.find('Fixture app').visible(); });
      test.skip('waits for later');
      test('explains a failure', () => {
        console.warn('Draft was not saved');
        throw new Error('The confirmation is missing');
      });
    });`,
  });
  let result = await terminalRun(t, fixture, ['--llm']);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  for (let text of ['# Dyno: 1 of 3 tests failed', '1 failed, 1 passed, 1 skipped in',
    '## 1. Agent review › explains a failure', 'Error: The confirmation is missing\nAt: tests/browser/workflow.test.js:', ', in the test body', '```js', "throw new Error('The confirmation is missing')",
    '[warn] Draft was not saved', "Rerun: `dyno --test 'Agent review › explains a failure' --file 'tests/browser/workflow.test.js'`",
    '## Skipped (1)', '- Agent review › waits for later', 'Full results with console output and timings: .dyno/reports/'])
    assert(result.stdout.includes(text), result.stdout);
  assert.doesNotMatch(result.stdout, /passes quietly|\u001b\[/);
  assert.doesNotMatch(result.stdout, /src\/browser\/runtime\.js/);
});
