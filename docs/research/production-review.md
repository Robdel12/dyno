# Production review

October 31, 2026. Five independent reviews covered interactions, reporting, scheduling, resource cleanup and tests. The prototypes are evidence, not production code.

## Ready pieces

The option-selection fix is merged in [#17](https://github.com/Robdel12/dyno/pull/17). Its real CLI regression failed before the fix for single and multiple controlled selects. The complete suite and cross-browser CI passed.

The reporting implementation in [#18](https://github.com/Robdel12/dyno/pull/18) uses accepted outcomes for final results and validated changes for live progress. It preserves final output in result events, streams observer history as bounded records and publishes batches atomically. All terminal paths share native cleanup and report persistence. Lost acknowledgements do not rerun test callbacks or actions. Failed writes remain failures, including during replacement and shutdown.

Real browser/network, HTTP/SSE and filesystem tests cover those boundaries. The production implementation must be measured in Vizzly separately; the earlier spike timings are not its benchmark.

A suspended animation clock exposed a real reporter stall. Rendering now batches through message turns. The browser regression freezes only that clock; it still loads the actual reporter, receives real server events and interacts through Interactor.

## Concurrency needs a deliberate cutover

Keep the selected direction: one immutable run model, a bounded context pool, a per-test queue, seeded ordering and explicit resource reservations. The current CLI, gateway, browser provider and shell each own one execution. Replace that ownership together, with one-worker runs using the same new path.

The scheduler and result spikes have separate stores. Do not combine them into production. Use one run value containing catalog, selected priority, workers, executions, accepted outcomes and resource ownership. Derive availability and report projections; keep SDK handles and promises outside it. Failed worker cleanup stops admission without rewriting accepted test outcomes.

One boundary still needs proof: ending old app/test JavaScript while retaining project-owned browser storage. The clipboard reservation proof closed entire contexts. Replacing only the execution iframe does not stop the app. Fresh app/controller pages inside a retained context need a real lifecycle proof, including held requests and service-worker policy. Do that before the native cutover; closing a new context for every test would silently change storage behavior.

Then implement the cutover through `run.js`, `cli-run.js`, `server.js`, browser-control/session/providers and the shell. Carry resource declarations through suite descriptors before dispatch. Validate all worker catalogs before scheduling, accept outcomes by owned execution ID, save actual queues for replay and make reporters select an owned worker. Keep manual URLs at one worker.

## What belongs in Vizzly

Keep the app work together on [#885](https://github.com/vizzly-testing/vizzly/pull/885), after the reviewed Dyno foundation is merged. Preserve the complete case and image catalogs.

The current reset gate waits for API handlers but misses background settlement transactions. Whole job processors, async BullMQ failure listeners, Redis subscriber callbacks and screenshot dispatch can outlive a test. The observed SQL matches review locking, but it does not identify which caller held that transaction.

The reset entry points are `tests/e2e/test-server.js` and `tests/e2e/server/fixture-bridge.js`. Track admitted work at `src/services/build-queue-adapter.js`, `queue-service.js` and `screenshot-processing-requests.js`, including the async callbacks those modules start. Include any retention workers started by the test server.

Close external admission, release held fixture gates and join the admitted request/job graph while internal follow-up work can still finish. Then park owned queues, remove old job records, reset fixtures and reopen. A failed drain leaves admission closed and the database untouched. The existing memoized shutdown function cannot serve as reusable reset.

Prove this with real API/PostgreSQL/BullMQ cases: client disconnect during a held transaction; SDK processing and settlement during reset; an exhausted job with unfinished failure cleanup; reused deterministic IDs processing once; and failed drain followed by explicit recovery. Use observable gates and job events.

Cached genuine fixture credentials and derived privacy-form defaults are useful separate changes. Keep real login/logout tests exercising those behaviors. Named session preparation is a prerequisite helper, not a replacement for authentication coverage. Leave temporary ports, wrapper paths and worker-specific Node-case suppression in the benchmark harness.

## Keep out of this cutover

The readiness optimization calls an Interactor API absent from the installed release. Land a supported upstream change before adopting it. Keep the current assertion settings and avoid a Dyno fork.

Do not add shards, retries, sleeps, weaker assertions or new visual baselines to make measurements pass. Record complete serial and concurrent runs, seeds, wall time, worker work/cleanup/idle time and open/closed reporter behavior. A seed preserves priority, not exact race timing.
