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
 * @api ProjectWorker.drain
 * Wait for work this execution started after Dyno removes its documents. Honor cancellation. Failed draining ends the run and saves accepted results; teardown must remain safe afterward.
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
 * export default async function setup({ signal }) {
 *   let build = await prepareBuild({ signal });
 *   return {
 *     createWorker: ({ worker, signal }) => startTestProject({ worker, build, signal }),
 *     teardown: build.teardown,
 *   };
 * }
 * ```
 *
 * These helpers belong to your project. `worker` has a string `id` and numeric `index`. Each call returns `{ webServer, env, fixtures, drain, teardown }`, overriding setup defaults. Share immutable build output; keep databases, queues, files, and mutable app state private. A deliberately stateless app can share a server.
 *
 * If setup starts the server, return its URL with `command: undefined` and `reuseExistingServer: true`. Worker teardown runs before shared setup teardown. Clean up partial setup if it throws. The same setup path works with one worker.
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
