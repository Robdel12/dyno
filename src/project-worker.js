/**
 * Prepare a test before its browser hooks start. Return optional JSON fixtures and a fixture connection without replacing static fixture keys. This runs once per assignment, even if its reply is replayed, and uses the test's timeout. Honor cancellation: Dyno waits for your callback before releasing resources. Failed or interrupted preparation requires a restart. Your app still owns database reset and background jobs.
 *
 * @api ProjectWorker.beforeExecution
 */

/**
 * Your config, setup cancellation signal, immutable session ID, and `onCleanup` callback.
 *
 * @api ProjectContext
 */

/**
 * The CLI session's stable random ID. It survives watch reruns and differs between simultaneous CLI invocations.
 *
 * @api ProjectContext.session
 */

/**
 * Register cleanup as you acquire each resource. Callbacks run once in reverse order after app work stops, even if setup throws. Register before setup returns, and don't use its aborted signal for cleanup.
 *
 * @api ProjectContext.onCleanup
 */

/**
 * Setup inputs plus this worker's immutable string ID and numeric index. Include the session ID in resource names to keep simultaneous runs separate.
 *
 * @api ProjectWorkerContext
 */

/**
 * The run, worker, and execution IDs, selected test, and cancellation signal. Preparation and cleanup get separate signals.
 *
 * @api ProjectExecution
 */

/**
 * The same-origin fixture path and access token for one execution, created by the fixture control helper. Private control credentials stay in Node.
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
 * Stop new work from this test and wait for its backend work to finish after Dyno retires the document. The final app may stay open for inspection; drain its backend work anyway. Honor cancellation. A failure ends the run and saves accepted results, so teardown must still be safe.
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
 * Create private resources for a worker. Required for concurrent managed runs; manual runs use one worker. Register releases with `onCleanup` as you go so a setup failure also cleans up.
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
 * If setup starts the server, return its URL with `command: undefined` and `reuseExistingServer: true`. Register each resource's cleanup with `onCleanup` before starting the next step. Callbacks run once in reverse order, even if setup fails. Register them before the factory returns. A returned `teardown` joins the same stack; don't register it twice. Worker teardown runs before shared teardown.
 *
 * The frozen `session.id` stays the same across workers and watch reruns. Include it with the worker ID in private resource names so simultaneous Dyno sessions stay separate. This setup works with one worker too.
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
 * Dyno reserves these resources together until it retires the document and finishes project cleanup. Other tests can continue if their resources are free. Global Pause stops new assignments at test boundaries; `app.pause()` holds only its worker. Stop or worker loss saves accepted results and images, drains, and closes the run. Dyno doesn't automatically retry tests or workers.
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
