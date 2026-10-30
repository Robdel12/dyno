import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { platform, arch, cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright-core';
import metadata from 'playwright-core/package.json' with { type: 'json' };
import { startFixture } from './fixture.js';
import { createOperations } from './operations.js';
import { createAdapter as direct } from './direct.js';
import { cases } from './cases.js';

let [
  adapterPath = 'direct',
  outputPath = '/private/tmp/dyno-managed-reference.json',
  sampleArgument = '20',
  engine = 'chromium',
] = process.argv.slice(2);
let samples = Number(sampleArgument);
if (!Number.isInteger(samples) || samples < 1 || samples > 1000)
  throw new Error('Samples must be between 1 and 1000.');
if (!['chromium', 'firefox', 'webkit'].includes(engine))
  throw new Error('Choose chromium, firefox, or webkit.');
let operationBudget = Number(process.env.DYNO_EVAL_OPERATION_TIMEOUT ?? 5000);
if (!Number.isInteger(operationBudget) || operationBudget < 1)
  throw new Error('Operation timeout must be a positive integer.');
let runSignal = AbortSignal.timeout(300000);
async function bounded(label, work, budget, parent = runSignal) {
  let signal = parent
    ? AbortSignal.any([parent, AbortSignal.timeout(budget)])
    : AbortSignal.timeout(budget);
  signal.throwIfAborted();
  let interrupted = Promise.withResolvers();
  let aborted = () => interrupted.reject(new Error(`${label} exceeded its evaluation deadline.`));
  signal.addEventListener('abort', aborted, { once: true });
  try {
    return await Promise.race([work(), interrupted.promise]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}
let percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
let summarize = (values) => ({
  count: values.length,
  median: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  values,
});
let records = async (fixture) =>
  await (await fetch(fixture.origin + '/records', { cache: 'no-store', signal: runSignal })).json();
let fixture, browser, adapter, setupDuration, failure, browserVersion, suiteFingerprint;
let results = [];
let cleanup = [];
let activeScenario = 'setup';
let source =
  adapterPath === 'direct'
    ? new URL('./direct.js', import.meta.url)
    : pathToFileURL(resolve(adapterPath));
try {
  let sources = await Promise.all(
    ['run.js', 'cases.js', 'fixture.js', 'operations.js', 'direct.js'].map((name) =>
      readFile(new URL(name, import.meta.url)),
    ),
  );
  suiteFingerprint = createHash('sha256').update(Buffer.concat(sources)).digest('hex');
  // Import-time prototype setup is included in the cold setup interval.
  let factory =
    adapterPath === 'direct'
      ? direct
      : (await bounded('Adapter import', () => import(source), 15000)).createAdapter;
  fixture = await bounded('Fixture startup', startFixture, 15000);
  browser = await bounded(
    'Browser startup',
    () => ({ chromium, firefox, webkit })[engine].launch({ headless: true }),
    30000,
  );
  browserVersion = browser.version();
  let context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  let app = await context.newPage();
  await app.goto(fixture.origin);
  await app.waitForFunction(() => Boolean(window.evalI));
  let opened = app.waitForEvent('popup');
  await app.evaluate(() => window.open('/controller', 'dyno-evaluation-controller'));
  let controller = await opened;
  await controller.waitForLoadState('domcontentloaded');
  let perform = createOperations({ context, app, engine });
  adapter = await bounded(
    'Adapter setup',
    () => factory({ context, app, controller, fixture, perform, engine }),
    15000,
  );
  assert.ok(['node', 'browser'].includes(adapter.clock), 'Declare the adapter caller clock.');
  if (adapter.clock === 'browser')
    assert.ok(
      typeof adapter.invokeName === 'string' && adapter.invokeName.length,
      'Browser adapters declare their controller function name.',
    );
  else assert.equal(typeof adapter.invoke, 'function');
  let caller = adapter.clock === 'browser' ? 'controller-window-performance' : 'node-performance';
  let invokeMeasured = (input) =>
    bounded(
      `Operation ${input.kind}`,
      async () => {
        if (adapter.clock === 'browser')
          return controller.evaluate(
            async ({ input, name }) => {
              if (!Object.hasOwn(globalThis, name) || typeof globalThis[name] !== 'function')
                throw new Error('Prototype browser caller is missing.');
              let start = performance.now();
              let value = await globalThis[name](input);
              return { value, duration: performance.now() - start };
            },
            { input, name: adapter.invokeName },
          );
        let start = performance.now();
        let value = await adapter.invoke(input);
        return { value, duration: performance.now() - start };
      },
      operationBudget,
    );
  setupDuration = performance.now();
  let control = async (label) => {
    activeScenario = label;
    let values = [];
    for (let index = -1; index < samples; index++) {
      let before = await records(fixture);
      let duration = await bounded(
        label,
        () =>
          app.evaluate(async () => {
            let start = performance.now();
            await window.runLocalWorkflow();
            return performance.now() - start;
          }),
        15000,
      );
      let after = await records(fixture);
      assert.equal(
        after.length,
        before.length + 1,
        'Each control sample must persist exactly one new record.',
      );
      assert.equal(after.at(-1).name, 'Robert');
      assert.equal(after.at(-1).notes, 'A saved note');
      if (index >= 0) values.push(duration);
    }
    results = [
      ...results,
      {
        name: label,
        status: 'passed',
        caller: 'app-window-performance',
        workflow: summarize(values),
        operations: [],
      },
    ];
  };
  await control('browser-local Interactor control before');
  for (let scenario of cases) {
    activeScenario = scenario.name;
    if (scenario.chromium && engine !== 'chromium') {
      results = [
        ...results,
        {
          name: scenario.name,
          status: 'unsupported',
          reason: 'Reference scenario requires Chromium capabilities.',
        },
      ];
      continue;
    }
    let workflows = [];
    let operations = [];
    for (let index = -1; index < samples; index++) {
      let measured = [];
      let invoke = async (input) => {
        let result = await invokeMeasured(input);
        measured = [...measured, { kind: input.kind, duration: result.duration }];
        return result;
      };
      let started = performance.now();
      await bounded(
        scenario.name,
        () => scenario.run({ context, app, controller, fixture, invoke }),
        30000,
      );
      if (index >= 0) {
        workflows.push(performance.now() - started);
        operations.push(...measured);
      }
    }
    let kinds = [...new Set(operations.map((entry) => entry.kind))];
    results = [
      ...results,
      {
        name: scenario.name,
        status: 'passed',
        caller,
        workflow: summarize(workflows),
        operations: kinds.map((kind) => ({
          kind,
          ...summarize(
            operations.filter((entry) => entry.kind === kind).map((entry) => entry.duration),
          ),
        })),
      },
    ];
    console.log(
      `${scenario.name}: ${Math.round(percentile(workflows, 0.5))} ms median instrumented workflow`,
    );
  }
  await control('browser-local Interactor control after');
} catch (error) {
  failure = error;
  results = [...results, { name: activeScenario, status: 'failed', error: error.message }];
} finally {
  // Every cleanup runs even after a failed or hung prototype. No later scenario runs after a failure.
  for (let [name, resource] of [
    ['adapter', adapter && (() => adapter.dispose())],
    ['browser', browser && (() => browser.close())],
    ['fixture', fixture && (() => fixture.close())],
  ]) {
    if (!resource) continue;
    try {
      await bounded(`Cleanup ${name}`, resource, 5000, null);
      cleanup = [...cleanup, { name, status: 'passed' }];
    } catch (error) {
      cleanup = [...cleanup, { name, status: 'failed', error: error.message }];
      failure ??= error;
    }
  }
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        status: failure ? 'failed' : 'passed',
        adapter: adapter?.name ?? adapterPath,
        callerClock: adapter?.clock,
        suiteFingerprint,
        engine,
        browserVersion,
        playwright: metadata.version,
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        samples,
        setupDuration,
        totalDuration: performance.now(),
        results,
        cleanup,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Saved ${outputPath}`);
}
if (failure) {
  await new Promise((resolve) => process.stderr.write(failure.stack + '\n', resolve));
  // A broken external prototype can retain its own handles. The CLI verdict is final;
  // Playwright's exit handler also stops its owned browser processes.
  process.exit(1);
}
