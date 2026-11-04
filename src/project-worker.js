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
 * Private app resources for one worker: server overrides, environment, browser-visible fixtures, optional drain and teardown. Share immutable build output; isolate mutable databases, queues, files and sessions.
 *
 * @api ProjectWorker
 */

/**
 * Join work started by this execution after Dyno retires its documents. Honor cancellation. Failed draining ends the run and preserves accepted results; teardown must remain safe afterward.
 *
 * @api ProjectWorker.drain
 */

/**
 * Release resources acquired by this worker. Setup teardown runs once after all workers close.
 *
 * @api ProjectWorker.teardown
 */

/**
 * The value returned by the Node setup module. One setup owns run-wide resources; each worker owns its private app state.
 *
 * @api ProjectSetup
 */

/**
 * Create private resources for a worker. Required for concurrent managed runs. Manual runs always use one worker. If acquisition fails before returning, clean up anything already created.
 *
 * @api ProjectSetup.createWorker
 */

/**
 * Tests use declared order by default. Randomize them with a recorded seed:
 *
 * ```sh
 * dyno --random
 * dyno --seed issue-184
 * ```
 *
 * Dyno prints the seed and includes it in live run info and saved reports. The same seed preserves priority for the same test IDs, including when filtering. It does not control app randomness or asynchronous timing. `schedule.json` records the actual assignments and completion order. A final retained assignment keeps its app available until session shutdown; browser shutdown is recorded in `session.json`.
 *
 * ### Concurrent runs
 *
 * `dyno --workers 4` uses one browser with private contexts, app gateways and project resources. The default is one worker. Manual URL runs use one worker regardless of the configured managed count; an explicit `--manual --workers 4` fails with an explanation. Every worker registers the same catalog before dispatch. Tests keep their suite hooks and fresh documents, and results stay in catalog order.
 *
 * Concurrent projects must return `createWorker` from Node setup:
 *
 * ```js
 * import { prepareBuild, startTestProject } from './support/project.js';
 *
 * export default async function setup({ signal }) {
 *   let build = await prepareBuild({ signal });
 *   return {
 *     createWorker: ({ worker, signal }) => startTestProject({ worker, build, signal }),
 *     teardown: build.teardown,
 *   };
 * }
 * ```
 *
 * Those helpers belong to your project. `worker` contains its string `id` and numeric `index`. Each call returns `{ webServer, env, fixtures, drain, teardown }`. Use private databases, queues, files and mutable app state; share immutable build output. A deliberately stateless app can share a server. If setup starts the server itself, return its URL with `command: undefined` and `reuseExistingServer: true`.
 *
 * Worker values override setup defaults for the server, environment and fixtures. A worker can override the setup's `drain`. Worker teardown releases that worker; setup teardown runs once afterward. Failed setup must clean up anything it acquired before returning. One worker uses this same path.
 *
 * Global Pause stops new assignments and waits at test boundaries; `app.pause()` holds only its worker. The reporter shows one combined run and lets you choose a worker to inspect. Stop or worker loss preserves accepted outcomes and images, then drains and closes the run. There are no automatic worker restarts or test retries.
 *
 * Declare shared resources before execution when a test uses something such as the OS clipboard:
 *
 * ```js
 * test('copies a token', async ({ I }) => {
 *   await I.click('Copy token');
 * }, { resources: ['clipboard'] });
 * ```
 *
 * Dyno reserves a test's named resources together and holds them through document retirement and project draining. Other eligible tests can continue. Browser tabs alone do not isolate your app's database or storage.
 *
 * ### Queue replay
 *
 * `dyno --replay .dyno/reports/<run>/schedule.json` restores each worker's recorded queue and count. An explicit `--workers` must match. The test bundle fingerprint and catalog must match too; changed sources or malformed schedules fail plainly. Replay cannot combine with selection flags, seeds or `--watch`.
 *
 * A completed schedule replays the full recorded selection. An interrupted schedule replays attempted tests, including the unfinished assignment, and reports how many unassigned tests it omitted. It does not claim those omitted tests passed. Queue replay preserves worker order, not network or timer interleaving. App code outside the test bundle, backend data and application randomness remain your project's responsibility.
 *
 * @guide concurrency Execution order
 */

import { normalizeConfig } from './config.js';

let record = value => value && typeof value === 'object' && !Array.isArray(value);
let snapshot = value => {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (record(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
  return value;
};

export function projectWorker(config, project, index, defaults = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project))
    throw new Error('createWorker must return a project worker with its app configuration.');
  for (let key of Object.keys(project))
    if (!['webServer', 'env', 'fixtures', 'drain', 'teardown'].includes(key))
      throw new Error(`Unknown project worker option: ${key}.`);
  for (let input of [defaults, project])
    for (let name of ['webServer', 'env', 'fixtures'])
      if (input[name] !== undefined && !record(input[name])) throw new Error(`Project worker ${name} must be an object.`);
  for (let name of ['drain', 'teardown'])
    if (project[name] !== undefined && typeof project[name] !== 'function')
      throw new Error(`Project worker ${name} must be a function.`);
  let webServer = normalizeConfig({ webServer: {
    ...config.webServer, ...defaults.webServer, ...project.webServer,
    env: { ...config.webServer.env, ...defaults.webServer?.env, ...defaults.env, ...project.webServer?.env, ...project.env },
  } }, config.file).webServer;
  let fixtures;
  try { fixtures = snapshot(JSON.parse(JSON.stringify({ ...defaults.fixtures, ...project.fixtures }))); }
  catch (error) { throw new Error('Project worker fixtures must be JSON-serializable.', { cause: error }); }
  return Object.freeze({
    config: Object.freeze({ ...config, port: index === 0 ? config.port : 0, webServer }),
    fixtures,
    drain: project.drain ?? defaults.drain,
  });
}
