# Native concurrency and seeded order

October 31, 2026. Five-worker swarm spike in disposable copies. Proposed architecture, not a shipped parallel runner.

## Decision

Build one immutable run model and a bounded pool of **isolated browser contexts in one managed browser**, with one browser-local test per worker. Ready workers claim the next eligible test. Each project owns its worker’s app, database, queues, fixtures and storage. Declare shared resources, such as clipboard use, before dispatch and reserve them for the whole execution.

Keep the same path for one or many workers. Interactor and test callbacks stay in the browser. Playwright Core keeps its existing launch/native/capture responsibilities. A manual URL still works with one worker; it must not open a fleet of tabs or require a driver.

The [production review](production-review.md) separates the verified foundation from the remaining execution-ownership cutover and Vizzly drain work.

## Measurements

Full Vizzly command times, reporter closed:

| Prototype | Workers/order | Time | Result |
| --- | --- | ---: | --- |
| Original option action, persistent private browsers | 1/declared | 191.19s | Pass |
| Same | 2/declared | 108.22s | Failed; excluded |
| Atomic option action, persistent private browsers | 1/declared, first control | 242.27s | Pass |
| Same | 2/declared | 185.79s | Pass |
| Same | 4/declared | 300.07s | Hard cap; incomplete |
| Same | 1/seeded | Not persisted | Incomplete; collector failed |
| Same | 2/seeded | 136.65s | Pass |
| Same | 1/declared, closing control | 187.96s | Pass |
| Atomic action, shared browser/isolated worker contexts | 4/declared | **60.15s** | Pass |
| Atomic action, private browsers/ordinary contexts | 1/declared | 212.17s | Pass |
| Same | 4/declared | 127.77s | Pass |
| Same | 4/seeded | **89.84s** | Pass |

These are multiple-CLI throughput experiments with static round robin, not a native scheduler. One OCR/Vite build is shared; each worker gets its own app, gateway, PostgreSQL, Redis and files. Command time includes builds, CLI setup/migrations, browser startup, tests and teardown, including owned browser-server launch/close. Docker setup/cleanup, source copies and artifact analysis are outside that clock. Each command has a 300-second cap. Earlier reporting timings used different scaffolding.

Every passing row preserved **338 browser cases plus one real Node factory case, 232 logical screenshot names/dimensions and all 245 accepted PNGs**. No skipped coverage, retries, baseline updates or driver DOM interactions. All app source fingerprints matched before and after. One inherited duplicate screenshot filename retains both execution attachments; canonical export follows original catalog order, never completion order.

The source-matched one-worker controls drifted from 242.27s to 187.96s. Host load and memory pressure varied substantially. The 60-second result establishes feasibility, not an expected median or a precise causal speedup. Sharing a browser is not the only workable strategy: private browsers with the same ordinary-context provider passed too.

Failed attempts stay in the evidence. The original two-worker run had 337 passes and one missing-element failure while connecting the twelfth GitHub project. The persistent-browser four-worker run completed 183 passes and 12 failures, leaving 143 cases unreported at the cap. PostgreSQL logs prove a reset/background-review transaction deadlock; preceding slowness had already started, so that deadlock does not explain everything. Randomized single-worker execution recorded 315 passes, no assertion failures and 23 unreported cases; its artifact collector then failed on incomplete data. None counts as a successful timing.

## Why contexts, with explicit reservations

The focused fixture ran 32 browser-local Interactor save workflows, 32 native key operations and eight checked PNGs per passing case:

| Chromium workers | Isolated contexts | Private browsers |
| --- | ---: | ---: |
| 1 | 6.70s | 6.75s |
| 2 | 3.41s | 3.38s |
| 4 | 1.77s | 1.68s |
| 8 | 0.95s | 0.86s |

At eight workers, ready summed process RSS was about 1.1 GiB for contexts and 2.3 GiB for private browsers. These are single fixture samples and memory snapshots, not peak physical memory or full Dyno commands. Shared pages can be counted more than once; startup/cache order affects results.

Same-context tabs failed cookie/localStorage/IndexedDB/permission isolation. Separate localhost ports do not isolate cookies. Separate contexts protected those values, but **shared clipboard contents**: A wrote, B wrote, A read B. Separate headless Chromium browsers retained A’s value.

The guarded follow-up passed two real Interactor/UI clipboard workflows with actual contention. A reserved before permissions were granted. B queued before A read. Forged release and queued cancellation were handled correctly. A kept ownership through actual permission cleanup and complete context shutdown; only then could B proceed. Both read their own values, with no remaining reservations.

That proves the explicit reservation boundary, not unrestricted browser API isolation. Clearing permissions alone does not stop default clipboard writes. Declare usage before running app/test code; managed requests missing a required declaration fail plainly. Arbitrary app calls cannot be discovered automatically. Paused executions retain ownership. The full Vizzly suite has only one clipboard case; it did not benchmark overlapping reserved clipboard cases.

Private browser processes are the strongest tested alternative. They avoid this headless clipboard collision and also passed full coverage, but used more memory and had slower observed full runs. Choose context pooling with explicit resource ownership; do not ship every benchmark strategy as a configuration option. Neither strategy proves isolation of a headed OS clipboard or unrelated desktop applications.

WebKit passed the one/two-context and two-browser fixture. Firefox failed before app loading with the existing local profile-folder error; its concurrency remains unverified. Headless document visibility is not proof about headed background-tab throttling.

## State ownership

Vizzly’s reset truncates shared tables and resets process counters. Its app owns singleton provider fixtures, environment mutations, request gates and fixed queue names. More tabs, a reset mutex or a database schema alone cannot isolate that state.

Six real HTTP/Postgres/Redis/BullMQ/process/filesystem cases passed. A shared reset deleted another worker’s records, queued job and files. Separate resources preserved overlapping IDs, real jobs and independent requests through reset, client abort, cleanup failure and peer disposal.

Dyno should expose one project worker factory, not database adapters. Proposed setup shape:

```js
export default async function setup({ signal }) {
  let shared = await prepareProject({ signal });
  return Object.freeze({
    createWorker: ({ worker, signal }) => shared.startWorker({ worker, signal }),
    teardown: shared.stop,
  });
}
```

`createWorker` returns the actual web-server/env/fixture descriptors, an execution-drain callback and teardown. Dyno owns browser/gateway effects; the project owns backend effects. Share immutable build output. A project can deliberately share a stateless server, but Vizzly needs private resources. Start at one worker unless the project supplies safe concurrent setup.

A run owns the browser server and canonical results. A worker owns its context and project resources. An execution owns its app/controller/runtime documents, native requests, captures and resource reservations. Acquire all required resources together before dispatch; do not let running tests acquire conflicting locks incrementally. For example, proposed test options could declare `{ resources: ['clipboard'] }`.

A worker is reusable only after execution/native cleanup, real project draining and canonical result acceptance. Stop old execution JavaScript before releasing a shared resource. The guard proof closed the entire context. Reusing a context with fresh app/controller documents is proposed, not proven equivalent; its shutdown boundary and cost must pass real CLI tests before shipping. Keep browser storage cleanup explicit in project code, as the vision requires.

Browser abort does not cancel server writes. Vizzly must close external admission, release held fixture gates, join admitted jobs, async failure listeners and review transactions, then reset. Do not pause internal work that admitted handlers are awaiting. Its current API gate misses background transactions, and its one-shot worker shutdown cannot serve as reusable per-test draining.

Failed cleanup stops admission and fails the run separately; never rewrite accepted UI/hook outcomes. Test-defined hook failures remain test failures. Preserve interrupted partial output. No automatic retry or worker restart.

## Functional core

Use one plain immutable run value: catalog, selected order, seed, worker health, executions and accepted outcomes. Derive worker availability and counts. Keep handles, tokens, promises, processes and abort controllers outside it.

`advance(run, event)` returns the next run and explicit effects. Scheduling and result projection are pure helpers over that same value; do not synchronize independent scheduler and result stores.

- Compile global focus/skip/filter decisions before distribution. Keep existing IDs and original indices. Every fresh runtime still registers the complete suite; only callbacks stay in the browser.
- Assign one existing `executionId` to a worker/test. Validate run, worker, execution, document and request ownership. Accept out-of-order outcomes by ID, once. Never use completion position as identity.
- The current shell already resets native state and clears context before posting its result. Preserve that ordering; reply with the next assignment only after project draining and result acceptance too. Keep ordering/persistence acknowledgements; avoid an extra request per DOM interaction.
- Keep report order stable while showing live completion order. Scope captures by accepted UUID, never their display filename.

The pure scheduler passed 19 cases. The separate result contract passed seven pure groups, all 24 completion permutations and four real HTTP/SSE/filesystem groups using Dyno’s writer. These are contract prototypes, not the production gateway. Supplied source metadata and prior real PNGs were preserved; those proofs do not re-prove capture or source mapping.

## Randomization and replay

Proposed CLI:

```sh
dyno --workers 4 --random
dyno --workers 4 --seed issue-184
dyno --replay .dyno/reports/<run>/schedule.json
```

Generate and print a seed once; explicit seed implies randomized order. Version a stable ID-based ranking so filtering preserves relative order. Do not replace app/factory randomness.

Save sources/catalog/selection, algorithm, seed, worker count, actual assignments and completion order. A seed reproduces priority; completion timing can change worker assignment. Replay restores recorded worker queues, not network/timer interleaving. Source or worker-count mismatches fail plainly. Interrupted-prefix replay selects only attempted cases and reports omitted cases honestly.

The full-suite experiment uses a recorded Fisher–Yates order; the proposed ID-rank planner is independently tested. Neither result should be presented as the other algorithm’s timing.

## Implementation order

1. Keep the option correction from [#17](https://github.com/Robdel12/dyno/pull/17): selection and input/change events run together. The real controlled-React fixture reproduced wrong values in all six animated trials per engine; the correction passed seven candidate cases each in Chromium and WebKit. This does not establish the exact cause of the earlier GitHub failure. [PR #18](https://github.com/Robdel12/dyno/pull/18) implements the reporting foundation before the native scheduler cutover.
2. Replace sequential acceptance in `src/run.js` with the single run/assignment model. Separate result validation from arrival order. Preserve terminal persistence and bounded idempotent receipts.
3. Extract worker setup/teardown from `src/cli-run.js` and browser-session/provider ownership. One public Playwright Core browser server owns isolated contexts; close contexts before the server. Share bundles; give each worker its app gateway and project resources. Remove singleton `activeRun`/`ownedRun` assumptions in CLI, server and browser-control code. Route existing provider queues per worker. Use owned SDK lifecycle handles rather than process-name discovery.
4. Replace the shell’s serial loop with assignments. Keep fresh runtimes, hooks, document checks and native/capture cleanup. Validate shared-resource declarations before dispatch; retain reservations through document shutdown, project drain and acceptance. Prove the exact page/context reuse policy against the clipboard witness. One worker uses the same assignment path; manual runs remain URL-only.
5. Add CLI/config/types, seed and replay manifests. Keep `describe` organizational; there is no existing beforeAll/shared suite lifetime requiring file affinity. Do not hide order dependence by grouping files.
6. Make live/saved reporters worker-aware. Global Pause stops new assignments and drains active cases; local `app.pause()` holds its worker while others can continue. Inspection selects an owned app. Stop cancels, drains and saves before exit.
7. Report coordinator wall, summed test work, queue delay and worker busy/cleanup/idle spans separately. Browser clocks are independent; subtracting summed concurrent test durations from wall time is invalid.
8. Prove the native implementation through real CLI/browser/app cases: overlapping saves/captures, stopped or lost workers, pending server writes/jobs, failed setup/drain/persistence, stale results, replay and selected-worker inspection. Repeat complete Vizzly runs and open/closed reporter checks on intended browsers. Timing simulations do not replace them.

## First cut and remaining checks

Ship one bounded worker pool, seeded ordering, recorded queues, explicit resource reservations and worker-aware reporting. Default to one worker; projects opt into concurrency with safe setup. No automatic “all tabs” setting: eight contexts already consumed over 1 GiB of ready process RSS in the small fixture. A failed four-worker full run reached about 5.5 GiB of summed descendant RSS plus owned containers; those snapshots are not peak physical memory.

Defer distributed workers, adaptive pool sizing, history-based scheduling, retries and exact race replay. Simulated load balancing favors per-test queues over file round robin, but its 48-second estimate for four workers is an ideal sum of old durations, not measured performance.

Before release, implement Vizzly’s complete job/transaction drain, measure the actual native pool with document/resource cleanup enabled, and repeat open/closed reporter runs. Verify headed behavior and Firefox once its local launch failure is resolved. WebKit fixture correctness passed; full Vizzly pooling was measured only in Chromium.

## Evidence

[Recorded results](results/concurrency.json) index complete runs, failed attempts, fingerprints, browser resource cases and pure/integration proofs. Root verification rechecked all nine complete runs, their plans/case/image catalogs and four frozen source manifests. The current 19 scheduler checks and immutable clipboard-reservation proof passed again. Owned containers, networks, volumes, script processes and recorded browser-server processes were gone after the experiments.

Scripts, PNGs and five worker reports remain at `/private/tmp/dyno-concurrency-spike-uD5YrQ`, under `browser`, `scheduler`, `isolation`, `harness` and `results`. The spike changed no production runtime.

Failed harness attempts are retained too, including a rejected numeric BullMQ job ID and corrected browser fixture setup. They are excluded from correctness and timing claims.
