import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { project, repository, launch } from '../helpers/project.js';
import { openURL } from '../helpers/manual.js';

let server = join(repository, 'tests/fixtures/coverage-app-server.js');
let appSource = `function choose(flag: boolean): string {
  if (flag) {
    return 'Accepted';
  }
  return 'Rejected';
}
function finish(): void {
  document.querySelector('output').textContent = 'Finished';
}
document.querySelector('#accept').addEventListener('click', () => {
  document.querySelector('output').textContent = choose(true);
});
document.querySelector('#reject').addEventListener('click', () => {
  document.querySelector('output').textContent = choose(false);
});
document.querySelector('#finish').addEventListener('click', finish);
`;
let oneTest = `describe('Coverage workflow', () => {
  test('accepts a choice', async ({app, I}) => {
    await app.goto('/'); await I.click('Accept'); await I.find('$([role=status])').text('Accepted');
  });
});`;
let json = async path => JSON.parse(await readFile(path, 'utf8'));
let calls = (file, name) => Object.entries(file.fnMap)
  .filter(([, fn]) => fn.name === name).reduce((total, [id]) => total + file.f[id], 0);

async function coverageProject(t, { coverage = {}, config = {}, source = oneTest, files = {} } = {}) {
  let fixture = await project(t, {
    config: { coverage: { baseline: '.dyno/coverage-baseline.json', include: ['src/**'],
      reporters: ['html', 'lcov', 'json'], ...coverage }, ...config,
      webServer: { command: [process.execPath, server], ready: 'COVERAGE_READY', ...config.webServer } },
    source,
    files: { 'src/app.ts': appSource, 'src/unvisited.ts': 'export function neverVisited(): number { return 42; }', ...files },
  });
  return Object.freeze({ ...fixture, directory: await realpath(fixture.directory) });
}

async function savedReport(result) {
  let saved = result.events.findLast(event => event.type === 'report-saved');
  assert.ok(saved, result.stdout + result.stderr);
  let report = await json(saved.json);
  let data = report.coverage ? await json(join(saved.directory, report.coverage.json)) : null;
  return { saved, report, data };
}

test('coverage preserves exact calls through navigation, cleanup and parking and reports original unvisited sources', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { source: `describe('Coverage workflow', () => {
    afterEach(async ({I}) => { await I.click('Finish'); await I.find('$([role=status])').text('Finished'); });
    test('navigates between decisions', async ({app, I}) => {
      await app.goto('/'); await I.click('Accept'); await I.find('$([role=status])').text('Accepted');
      await I.click('Next page'); await I.find('"Next page" $(h1)').visible();
      await I.click('Reject'); await I.find('$([role=status])').text('Rejected');
    });
    test('starts another document', async ({app, I}) => {
      await app.goto('/'); await I.click('Accept'); await I.find('$([role=status])').text('Accepted');
    });
  });` });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 2);
  let { saved, report, data } = await savedReport(result);
  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.coverage.scope, 'all-files');
  assert.deepEqual(Object.keys(data).sort(), [join(fixture.directory, 'src/app.ts'), join(fixture.directory, 'src/unvisited.ts')]);
  let app = data[join(fixture.directory, 'src/app.ts')];
  assert.equal(calls(app, 'choose'), 3);
  assert.equal(calls(app, 'finish'), 2);
  assert.deepEqual(Object.values(app.b), [[2, 1]]);
  let unvisited = data[join(fixture.directory, 'src/unvisited.ts')];
  assert.ok(Object.values(unvisited.s).length > 0);
  assert.ok(Object.values(unvisited.s).every(hits => hits === 0));
  assert.equal(calls(unvisited, 'neverVisited'), 0);
  let lcov = await readFile(join(saved.directory, report.coverage.lcov), 'utf8');
  assert.match(lcov, /SF:.*src\/app\.ts/);
  assert.match(lcov, /SF:.*src\/unvisited\.ts/);
  assert.doesNotMatch(lcov, /SF:.*compiled/);
  let html = await openURL(t, pathToFileURL(saved.html).href);
  await html.getByRole('link', { name: 'Open coverage report', exact: true }).click();
  await html.getByRole('heading', { name: 'All files', exact: true }).waitFor();
  await html.getByRole('link', { name: 'unvisited.ts', exact: true }).waitFor();
});

test('coverage thresholds fail the command while preserving passed test results and JUnit evidence', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { coverage: { thresholds: { functions: 100 } } });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 1);
  assert.equal(result.summary?.failed, 0);
  let { saved, report } = await savedReport(result);
  assert.equal(report.tests[0].status, 'passed');
  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.coverage.failed, true);
  assert.match(report.coverage.failures.join(' '), /functions.*below.*100%/);
  let junit = await readFile(saved.junit, 'utf8');
  assert.match(junit, /testcase name="Application coverage"/);
  assert.match(junit, /type="coverage"/);
  assert.equal((junit.match(/<failure /g) ?? []).length, 1);
});

test('--no-coverage disables configured collection and its thresholds', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { coverage: { enabled: true, thresholds: { functions: 100 } } });
  let result = await fixture.run(['--no-coverage']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 1);
  let { saved, report } = await savedReport(result);
  assert.equal(report.coverage, undefined);
  assert.equal(result.events.some(event => event.type === 'coverage'), false);
  await assert.rejects(readFile(join(saved.directory, 'coverage/coverage-final.json')), { code: 'ENOENT' });
});

test('requested coverage explains missing app instrumentation without changing a passing test', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { coverage: { baseline: undefined },
    config: { webServer: { env: { COVERAGE_BUILD: 'disabled' } } } });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 1);
  assert.equal(result.summary?.failed, 0);
  let { report } = await savedReport(result);
  assert.equal(report.coverage.status, 'unavailable');
  assert.equal(report.coverage.failed, true);
  assert.match(report.coverage.failures.join(' '), /Enable Istanbul instrumentation/);
});

test('a manually connected browser collects coverage through the same app lifecycle', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { coverage: { enabled: true } });
  let session = fixture.run(['--manual']);
  let ready = await session.waitForEvent('ready');
  let page = await openURL(t, ready.url + '#start=managed');
  await page.getByRole('button', { name: 'Start tests', exact: true }).click();
  let completed = await session.waitForEvent('complete');
  assert.equal(completed.passed, 1);
  let result = await session.stop();
  let { report, data } = await savedReport(result);
  assert.equal(report.coverage.status, 'complete');
  assert.equal(calls(data[join(fixture.directory, 'src/app.ts')], 'choose'), 1);
});

test('repeated rounds combine complementary branches before evaluating coverage thresholds', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, {
    coverage: { include: ['src/app.ts'], thresholds: { branches: 100 } },
    source: `describe('Repeated decisions', () => { test('alternates choices', async ({app, I}) => {
      let round = Number(localStorage.getItem('round') ?? '0') + 1;
      localStorage.setItem('round', String(round));
      await app.goto('/'); await I.click(round === 1 ? 'Accept' : 'Reject');
      await I.find('$([role=status])').text(round === 1 ? 'Accepted' : 'Rejected');
    }); });`,
  });
  let result = await fixture.run(['--coverage', '--repeat', '2']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let completed = result.events.find(event => event.type === 'repeat-complete');
  assert.ok(completed, result.stdout + result.stderr);
  let batch = await json(completed.json);
  assert.equal(batch.completed, 2);
  assert.equal(batch.status, 'passed');
  assert.equal(batch.coverage.status, 'complete');
  assert.equal(batch.coverage.failed, false);
  assert.equal(batch.coverage.summary.branches.pct, 100);
  let data = await json(join(completed.directory, 'coverage/coverage-final.json'));
  let app = data[join(fixture.directory, 'src/app.ts')];
  assert.equal(calls(app, 'choose'), 2);
  assert.deepEqual(Object.values(app.b), [[1, 1]]);
});

test('managed workers merge their owned app coverage without counting either document twice', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, {
    config: { setup: './setup.js', workers: 2 },
    files: { 'setup.js': `import {serveCoverageApp} from ${JSON.stringify(server)};
      export default ({config}) => {
        let prepared = 0; let both = Promise.withResolvers();
        return {async createWorker({onCleanup}) {
          let app = await serveCoverageApp({root:config.root,collecting:config.coverage.enabled});
          onCleanup(() => new Promise(resolve => {app.close(resolve);app.closeAllConnections();}));
          return {webServer:{command:undefined,ready:undefined,reuseExistingServer:true,
            url:'http://127.0.0.1:'+app.address().port},
            async beforeExecution() {if (++prepared === 2) both.resolve();await both.promise;}};
        }};
      };` },
    source: `describe('Parallel choices', () => {
      test('accepts', async ({app,I}) => {await app.goto('/');await I.click('Accept');await I.find('$([role=status])').text('Accepted');});
      test('rejects', async ({app,I}) => {await app.goto('/');await I.click('Reject');await I.find('$([role=status])').text('Rejected');});
    });`,
  });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 2);
  let { report, data } = await savedReport(result);
  assert.equal(new Set(report.tests.map(test => test.workerId)).size, 2);
  assert.equal(report.coverage.status, 'complete');
  let app = data[join(fixture.directory, 'src/app.ts')];
  assert.equal(calls(app, 'choose'), 2);
  assert.deepEqual(Object.values(app.b), [[1, 1]]);
});

test('interrupting a manual run saves accepted counters as partial coverage', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { source: `describe('Interrupted decisions', () => {
    test('accepts a choice', async ({app,I}) => {
      await app.goto('/');await I.click('Accept');await I.find('$([role=status])').text('Accepted');
    });
    test('waits for inspection', async ({app,I}) => {
      await app.goto('/');await I.click('Reject');await I.find('$([role=status])').text('Rejected');
      await app.pause('Inspect the decision');
    });
  });` });
  let session = fixture.run(['--manual', '--coverage']);
  let ready = await session.waitForEvent('ready');
  let page = await openURL(t, ready.url + '#start=managed');
  await page.getByRole('button', { name: 'Start tests', exact: true }).click();
  await session.waitForEvent('test', event => event.name === 'accepts a choice');
  await page.frameLocator('#__dynoReporter').getByRole('button', { name: 'Continue run', exact: true }).waitFor();
  let result = await session.stop();
  assert.equal(result.code, 143, result.stdout + result.stderr);
  let { report, data } = await savedReport(result);
  assert.equal(report.status, 'interrupted');
  assert.equal(report.summary.passed, 1);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.coverage.failed, true);
  assert.equal(calls(data[join(fixture.directory, 'src/app.ts')], 'choose'), 1);
});

test('malformed app source maps fail coverage while preserving passing tests and their saved report', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { source: `describe('Broken instrumentation', () => {
    test('keeps its functional result', async ({app, I}) => {
      await app.goto('/'); await I.click('Accept'); await I.find('$([role=status])').text('Accepted');
      for (let file of Object.values(app.window.__coverage__)) file.inputSourceMap.sources[0] = 'file:///%';
    });
  });` });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.summary?.passed, 1);
  let { report } = await savedReport(result);
  assert.equal(report.tests[0].status, 'passed');
  assert.equal(report.coverage.status, 'unavailable');
  assert.equal(report.coverage.failed, true);
  assert.match(report.coverage.failures.join(' '), /URI malformed/);
});

test('an unreadable coverage snapshot preserves the completed test and previously collected counters', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { source: `describe('Broken coverage counters', () => {
    test('keeps its completed choice', async ({app, I}) => {
      await app.goto('/'); await I.click('Accept'); await I.find('$([role=status])').text('Accepted');
      await app.goto('/next'); await I.find('"Next page" $(h1)').visible();
      app.window.__coverage__.cycle = app.window.__coverage__;
    });
  });` });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  let { report, data } = await savedReport(result);
  assert.equal(report.tests[0].status, 'passed');
  assert.equal(report.summary.passed, 1);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.coverage.failed, true);
  assert.match(report.coverage.failures.join(' '), /circular|cyclic/i);
  assert.equal(calls(data[join(fixture.directory, 'src/app.ts')], 'choose'), 1);
});

test('selected coverage reporters omit formats the project did not request', { timeout: 90000 }, async t => {
  let fixture = await coverageProject(t, { coverage: { reporters: ['html'] } });
  let result = await fixture.run(['--coverage']).completion;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  let saved = result.events.find(event => event.type === 'report-saved');
  let report = await json(saved.json);
  assert.equal(report.coverage.html, 'coverage/index.html');
  assert.equal(report.coverage.json, undefined);
  assert.equal(report.coverage.summaryFile, undefined);
  assert.equal(report.coverage.lcov, undefined);
  for (let name of ['coverage-final.json', 'coverage-summary.json', 'lcov.info'])
    await assert.rejects(readFile(join(saved.directory, 'coverage', name)), { code: 'ENOENT' });
  assert.equal(result.events.find(event => event.type === 'coverage').status, 'complete');
  let plain = launch(process.execPath, [join(repository, 'bin/dyno.js'), '--coverage'], fixture.directory, t.signal);
  t.after(() => plain.stop());
  let printed = await plain.completion;
  assert.equal(printed.code, 0, printed.stderr);
  assert.match(printed.stdout, /Report:/);
  assert.doesNotMatch(printed.stdout, /Coverage \(/);
});
