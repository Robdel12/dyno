/**
 * Prepare one assignment before browser hooks start. Return optional JSON fixtures and a fixture transport binding. Keys must not replace static fixture keys. Preparation consumes this test's timeout and runs once across assignment reply replays. Callbacks must honor cancellation; Dyno joins actual settlement before resource destruction, so uncooperative Node work can delay shutdown. Interrupted or failed preparation requires restarting Dyno. Only the app owns database reset and independent jobs.
 *
 * @api ProjectWorker.beforeExecution
 */

/**
 * Inputs to shared project setup: configuration, acquisition signal, immutable CLI session identity, and immediate cleanup registration.
 *
 * @api ProjectContext
 */

/**
 * The CLI session's stable random ID. It survives watch reruns and differs between simultaneous CLI invocations.
 *
 * @api ProjectContext.session
 */

/**
 * Register one owned release during acquisition. Callbacks run once in reverse order after app work stops, including when setup throws. Do not reuse the aborted acquisition signal for cleanup or register work after the factory settles.
 *
 * @api ProjectContext.onCleanup
 */

/**
 * Project acquisition inputs plus this worker's immutable string ID and numeric index. Resource names still need session identity to separate simultaneous runs.
 *
 * @api ProjectWorkerContext
 */

/**
 * One owned test execution, with run/worker/execution IDs, the selected test descriptor, and a cancellation signal. Preparation and cleanup get separate live signals.
 *
 * @api ProjectExecution
 */

/**
 * An execution-owned, same-origin fixture call path and capability. Produced by the fixture control helper; private control credentials never enter this value.
 *
 * @api FixtureTransport
 */

/**
 * JSON data returned by beforeExecution. Fixtures extend static values without replacing keys; the optional transport binds app.fixture to this execution only.
 *
 * @api ExecutionPreparation
 */

/**
 * Environment values added to this worker’s app process.
 *
 * @api ProjectWorker.env
 */

/**
 * JSON-safe IDs, paths and other values supplied to browser tests.
 *
 * @api ProjectWorker.fixtures
 */

/**
 * Override the app command, URL or readiness settings for this worker.
 *
 * @api ProjectWorker.webServer
 */

/**
 * Private app resources for one worker: server overrides, environment, browser-visible fixtures, execution preparation, drain and cleanup. Share immutable build output; isolate mutable databases, queues, files and sessions.
 *
 * @api ProjectWorker
 */

/**
 * @api ProjectWorker.drain
 * Wait for work this execution started after document retirement between tests. The final successful document can remain for inspection; close app admission and join its backend work anyway. Honor cancellation. Failed draining ends the run and saves accepted results; teardown must remain safe afterward.
 */

/**
 * Release resources acquired by this worker. Setup teardown runs once after all workers close.
 *
 * @api ProjectWorker.teardown
 */

/**
 * The value returned by the Node setup module. One setup owns CLI-session resources; each worker owns its private app state.
 *
 * @api ProjectSetup
 */

/**
 * Create private resources for a worker. Required for concurrent managed runs. Manual runs always use one worker. Use onCleanup while acquiring resources so partial setup is released if the factory throws.
 *
 * @api ProjectSetup.createWorker
 */

/**
 * @guide concurrency Concurrent runs
 * Start with one worker, the default. Once your app has isolated test resources, try `dyno --workers 4` and compare [run times](guide.md#understand-where-time-goes). More tabs don't make a shared database safe.
 *
 * Dyno uses one managed browser with private worker contexts, gateways, and app resources. Tests keep their hooks and fresh documents; the reporter combines results in catalog order. Manual runs use one worker; explicitly combining `--manual --workers 4` fails.
 *
 * ## Give each worker its own resources
 *
 * Return `createWorker` from Node setup:
 *
 * ```js
 * import { prepareBuild, startTestProject } from './support/project.js';
 *
 * export default async function setup({ session, signal, onCleanup }) {
 *   let build = await prepareBuild({ session, signal, onCleanup });
 *   return {
 *     createWorker: ({ worker, signal, onCleanup }) =>
 *       startTestProject({ session, worker, build, signal, onCleanup }),
 *   };
 * }
 * ```
 *
 * These helpers belong to your project. `worker` has a string `id` and numeric `index`. Each call returns `{ webServer, env, fixtures, beforeExecution, drain, teardown }`, overriding setup defaults. Share immutable build output; keep databases, queues, files, and mutable app state private. A deliberately stateless app can share a server.
 *
 * If setup starts the server, return its URL with `command: undefined` and `reuseExistingServer: true`. Worker teardown runs before shared setup teardown. Register each release with `onCleanup` before the next fallible step. Registration closes when the factory settles; callbacks run once in reverse order even after setup fails. Returned `teardown` joins that same cleanup stack. Do not register the same release twice. The frozen `session.id` is shared across workers and stays stable during watch reruns; combine it with worker identity when naming private backend resources. The same setup path works with one worker.
 *
 * ## Protect shared resources
 *
 * Declare resources such as the OS clipboard before execution:
 *
 * ```js
 * test('copies a token', async ({ I }) => {
 *   await I.click('Copy token');
 * }, { resources: ['clipboard'] });
 * ```
 *
 * Dyno reserves the names together until document retirement and project draining finish. Other eligible tests continue. Global Pause stops new assignments at test boundaries; `app.pause()` holds only its worker. Stop or worker loss saves accepted outcomes and images, drains, and closes the run. Tests and workers aren't automatically retried.
 *
 * ## Randomize order
 *
 * ```sh
 * dyno --random
 * dyno --seed issue-184
 * ```
 *
 * The seed appears in CLI output, Run info, and saved reports. It preserves priority for the same test IDs, including when filtering. It doesn't control app randomness or asynchronous timing.
 *
 * ## Replay worker queues
 *
 * ```sh
 * dyno --replay .dyno/reports/<run-id>/schedule.json
 * ```
 *
 * `schedule.json` records assignments and completion order. Replay restores worker queues and count, not network or timer interleaving. The bundle fingerprint and catalog must match; an explicit `--workers` must match too. Selection flags, seeds, and `--watch` can't combine with replay.
 *
 * A completed schedule replays its full selection. An interrupted one replays attempted tests, including the unfinished assignment, and reports omitted unassigned tests. Those tests never count as passed. App code outside the test bundle, backend data, and application randomness remain yours to control. The last app stays available until shutdown, which is recorded in `session.json`.
 */

import { normalizeConfig } from './config.js';
import { snapshotJson } from './fixture-protocol.js';

let record = value => value && typeof value === 'object' && !Array.isArray(value);

export function projectWorker(config, project, index, defaults = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project))
    throw new Error('createWorker must return a project worker with its app configuration.');
  for (let key of Object.keys(project))
    if (!['webServer', 'env', 'fixtures', 'beforeExecution', 'drain', 'teardown'].includes(key))
      throw new Error(`Unknown project worker option: ${key}.`);
  for (let input of [defaults, project])
    for (let name of ['webServer', 'env', 'fixtures'])
      if (input[name] !== undefined && !record(input[name])) throw new Error(`Project worker ${name} must be an object.`);
  for (let name of ['beforeExecution', 'drain', 'teardown'])
    if (project[name] !== undefined && typeof project[name] !== 'function')
      throw new Error(`Project worker ${name} must be a function.`);
  let webServer = normalizeConfig({ webServer: {
    ...config.webServer, ...defaults.webServer, ...project.webServer,
    env: { ...config.webServer.env, ...defaults.webServer?.env, ...defaults.env, ...project.webServer?.env, ...project.env },
  } }, config.file).webServer;
  let fixtures;
  try {
    let shared = snapshotJson(defaults.fixtures ?? {}, { maxBytes: 8_000_000 });
    let own = snapshotJson(project.fixtures ?? {}, { maxBytes: 8_000_000 });
    fixtures = snapshotJson({ ...shared, ...own }, { maxBytes: 8_000_000 });
  }
  catch (error) { throw new Error('Project worker fixtures must be JSON-serializable.', { cause: error }); }
  return Object.freeze({
    config: Object.freeze({ ...config, port: index === 0 ? config.port : 0, webServer }),
    fixtures,
    beforeExecution: project.beforeExecution ?? defaults.beforeExecution,
    drain: project.drain ?? defaults.drain,
  });
}
