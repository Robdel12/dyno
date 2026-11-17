import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  for (let text of ['Dyno:', 'Running 3 browser tests', '✓ Terminal workflow › saves a choice',
    '− Terminal workflow › unfinished work', '✗ Terminal workflow › explains a failure',
    'Screenshot:', 'Coverage (all included files): complete', 'functions: 50%',
    '1 passed, 1 failed, 1 skipped', 'Slow:', 'Session:']) assert(result.stdout.includes(text), result.stdout);
  assert.match(result.stderr, /The confirmation is missing/);
  assert.match(result.stderr, /confirm@\/src\/contact.js:12:3/);
  assert.equal(result.stderr.split('The confirmation is missing').length - 1, 1);
  assert.match(result.stderr, /functions coverage is 50%, below the 100% threshold/);
  let html = result.stdout.split('\n').find(line => line.startsWith('Report: ')).slice('Report: '.length);
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
  for (let text of ['Repeating 2 rounds', 'Root seed: terminal-rounds', 'Round 1/2', 'Round 2/2',
    'Repeated runs: failed · 2/2 rounds completed · 1 with failures',
    'Confirmation › appears: 1 passed, 1 failed', 'First failure: round 1',
    'Replay this round:', 'Rerun through failure:', '--repeat 1', '--seed', 'Repeated-run report:'])
    assert(result.stdout.includes(text), result.stdout);
  assert.match(result.stderr, /Confirmation was missing in round one/);
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
  assert.match(result.stderr, /\[test\] The save was rejected/);
  assert.equal(result.stderr.split('The save was rejected').length - 1, 1);
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
  assert.doesNotMatch(result.stdout, /Running \d+ browser tests/);
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
  let [, url] = await text(/Dyno: (http:\/\/[^\s]+)/);
  let page = await openURL(t, url + '#start=managed');
  await page.getByRole('button', { name: 'Start tests', exact: true }).click();
  let [, reporter] = await text(/Reporter: (http:\/\/[^\s]+)/);
  await text(/1 passed, 0 failed, 0 skipped/);
  assert.equal(new URL(reporter).origin, new URL(url).origin);
  let response = await fetch(reporter);
  assert.equal(response.status, 200);
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.match(result.stdout, /Image skipped: Optional review image \(.*no capture provider/);
  assert.match(result.stdout, /Report: .*index.html/);
});

test('watch terminal output explains a broken edit and recovers after the test is fixed', { timeout: 90000 }, async t => {
  let fixture = await project(t);
  let path = join(fixture.directory, 'tests/browser/workflow.test.js');
  let source = await readFile(path, 'utf8');
  let session = launch(process.execPath, [join(repository, 'bin/dyno.js'), '--watch'], fixture.directory, t.signal);
  t.after(() => session.stop());
  let text = terminalText(session);
  await text(/1 passed, 0 failed, 0 skipped/);
  await writeFile(path, 'describe( invalid syntax');
  await text(/Watch: [\s\S]*(?:Expected|expected)/);
  await writeFile(path, source);
  await text(/1 passed, 0 failed, 0 skipped[\s\S]*1 passed, 0 failed, 0 skipped/);
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  assert.match(result.stderr, /Watch: /);
  assert.equal((result.stdout.match(/✓ Workflow › opens the app/g) ?? []).length, 2);
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
  assert.match(original.stdout, /2 isolated browser workers/);
  assert.match(original.stdout, /2 workers · .* wall · .* summed test work/);
  let html = original.stdout.split('\n').find(line => line.startsWith('Report: ')).slice('Report: '.length);
  let schedule = join(dirname(html), 'schedule.json');
  let replayed = await terminalRun(t, fixture, ['--replay', schedule]);
  assert.equal(replayed.code, 0, replayed.stdout + replayed.stderr);
  assert.match(replayed.stdout, /Replay: 4 assigned tests\n/);
  assert.match(replayed.stdout, /4 passed, 0 failed, 0 skipped/);
  let manifest = JSON.parse(await readFile(schedule, 'utf8'));
  let assignments = manifest.assignments.slice(0, 2);
  let interrupted = join(fixture.directory, 'interrupted.json');
  await writeFile(interrupted, JSON.stringify({ ...manifest, assignments,
    completion: manifest.completion.filter(id => assignments.some(assignment => assignment.testId === id)) }));
  let prefix = await terminalRun(t, fixture, ['--replay', interrupted]);
  assert.equal(prefix.code, 0, prefix.stdout + prefix.stderr);
  assert.match(prefix.stdout, /Replay: 2 assigned tests; 2 unassigned tests omitted/);
  assert.match(prefix.stdout, /2 passed, 0 failed, 0 skipped/);
});
