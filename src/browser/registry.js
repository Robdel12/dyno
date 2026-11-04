/**
 * Run one user workflow in the browser.
 *
 * Declare it inside a named `describe`. Await every action and assertion so a passing test means the work finished. `test.only` focuses local work; `test.skip` keeps an unfinished case visible. CI rejects focused tests by default.
 *
 * @example
 * ```js
 * import { describe, test } from 'dyno';
 *
 * describe('Contacts', () => {
 *   test('saves a contact', async ({ app, I }) => {
 *     await app.goto('/contacts/new');
 *     await I.find('Name').then.fill('Robert');
 *     await I.click('Save');
 *     await I.find('Contact saved').rendered();
 *   });
 * });
 * ```
 *
 * @api test
 */

/**
 * Group tests and hooks under a name. Suites can nest. Definitions must be synchronous; put asynchronous work in hooks or tests. `.only` focuses a suite and `.skip` reports its descendants as skipped.
 *
 * @api describe
 */

/**
 * Prepare each test in this suite and its descendants. Outer hooks run first. Register the hook inside its owning `describe`.
 *
 * @api beforeEach
 */

/**
 * Clean up each entered suite, including after failure. Inner hooks run first, with fresh APIs and a separate cleanup budget. Keep run-wide cleanup in Node setup teardown.
 *
 * @api afterEach
 */

/**
 * Declare, focus or skip a test. A skipped test can omit its callback and supply `{ reason: "Waiting for billing" }`.
 *
 * @api TestFunction
 */

/**
 * Declare a named suite. Its definition runs once while Dyno registers the test file.
 *
 * @api DescribeFunction
 */

/**
 * Tests and hooks receive the same browser context. Return or await all asynchronous work.
 *
 * @api TestCallback
 */

/**
 * Override the test deadline in milliseconds, reserve named shared resources, or explain a skipped test. Resources stay reserved through document retirement and project draining.
 *
 * @api TestOptions
 */

/**
 * @guide suites Suites and selection
 * Give each group of workflows a name with `describe`. Keep its setup and cleanup there too:
 *
 * ```js
 * import { describe, test, beforeEach } from 'dyno';
 *
 * describe('Authentication', () => {
 *   beforeEach(async ({ app }) => {
 *     await app.goto('/login');
 *   });
 *
 *   test('opens registration', async ({ I }) => {
 *     await I.click('Create account');
 *     await I.find('Start testing UI changes').visible();
 *   });
 * });
 * ```
 *
 * Every test and hook belongs inside a `describe`. You can nest suites or have several at the top level. Suite definitions are synchronous; put async work in hooks or tests.
 *
 * ## Set up and clean up
 *
 * `beforeEach` runs from the outer suite inward. `afterEach` runs from the inner suite outward, including after failure for suites the test entered. Cleanup gets fresh APIs and its own budget, so one failed assertion doesn't use up the cleanup time.
 *
 * Each test starts with fresh app and test documents. Cookies, browser storage, service workers and backend records persist. Reset those through your app's fixtures and hooks; use Node teardown for resources that outlive a test. [Configuration](guide.md#configure-your-project) covers that setup.
 *
 * ## Run just what you're editing
 *
 * ```sh
 * dyno --suite Authentication
 * dyno --file login.test.js
 * dyno --test 'Authentication › opens registration'
 * dyno --id '<ID from test discovery/results>'
 * ```
 *
 * File, suite and ID flags can repeat. Different kinds narrow the selection together. If a short test name is ambiguous, Dyno tells you how to pick one.
 *
 * Use `test.only` or `describe.only` for local focus. CI rejects them by default. `test.skip('later')` and `describe.skip` report skipped tests without running their hooks or bodies.
 *
 * Names must be unique within a suite. Stable IDs use the file, suite path and test name, so adding or reordering other tests doesn't change them. The reporter uses those IDs for reruns.
 */

import { createSuite, addSuite, addTest, addHook, compileSuite } from '../suite.js';

// Module evaluation is the registration boundary; all definition changes are pure.
let definitions = createSuite();
let scopes = [];
let change = (update) => {
  if (!scopes.length)
    throw new Error('Register tests and hooks inside describe blocks while a test file is being evaluated.');
  scopes = [...scopes.slice(0, -1), update(scopes.at(-1))];
};
export async function registerFile(file, load) {
  if (scopes.length) throw new Error('Test files must register sequentially.');
  scopes = [createSuite(file, { file })];
  try {
    await load();
    definitions = addSuite(definitions, scopes[0]);
  } finally {
    scopes = [];
  }
}
let declareTest = (mode) => (name, run, options) =>
  change((suite) => addTest(suite, name, run, options, new Error('Test declared here').stack, mode));
export let test = Object.assign(declareTest('run'), { skip: declareTest('skip'), only: declareTest('only') });
let declareSuite = (mode) => (name, define) => {
  if (typeof name !== 'string' || !name.trim() || typeof define !== 'function')
    throw new Error('describe requires a name and a synchronous function.');
  if (define.constructor.name === 'AsyncFunction' || define.constructor.name === 'GeneratorFunction')
    throw new Error('describe must be synchronous. Put asynchronous work in hooks or tests.');
  if (!scopes.length) throw new Error('describe must be registered inside a test file.');
  scopes = [...scopes, createSuite(name, { mode })];
  let child;
  try {
    let result = define();
    if (result?.then) {
      Promise.resolve(result).catch(() => {});
      throw new Error('describe must be synchronous. Put asynchronous work in hooks or tests.');
    }
    child = scopes.at(-1);
  } finally {
    scopes = scopes.slice(0, -1);
  }
  change((parent) => addSuite(parent, child));
};
export let describe = Object.assign(declareSuite('run'), { skip: declareSuite('skip'), only: declareSuite('only') });
export function beforeEach(run) {
  change((suite) => addHook(suite, 'beforeEach', run, new Error('Hook declared here').stack));
}
export function afterEach(run) {
  change((suite) => addHook(suite, 'afterEach', run, new Error('Hook declared here').stack));
}
export function getSuite(options) {
  return compileSuite(definitions, options);
}
