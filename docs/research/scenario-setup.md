# Fast setup without losing the real app

October 30, 2026. Measurements from disposable prototypes. See the [production review](production-review.md) for later implementation status.

## Results

The biggest problem was reporting. Dyno repeatedly sent its entire growing run history to Node, even with the reporter closed. Sending changed records preserved the complete reporter state and removed that repeated work.

| Complete command | Samples, seconds | Median |
| --- | --- | --- |
| Original Playwright | 313.43 / 306.06 | 309.75s |
| Current Dyno, instrumented control | 320.79 | 320.79s |
| Changed reporter transport | 229.38 / 227.54 | 228.46s |
| Reporter + setup + readiness prototype | 199.42 / 200.03 | 199.72s |

Reporting alone shortened the command by **28.8%** against the control, with the app, tests, fixtures and Interactor settings unchanged. The combined prototype was **35.5% shorter** than the recorded Playwright median. Earlier port coverage corrections mean this is a suite comparison, not an isolated driver benchmark.

Every new run passed **338 browser cases plus the Node factory case**, with **232 exact screenshot filenames and dimension checks**. No skips, retries or baseline acceptance.

All runs were serial, one worker, with fresh PostgreSQL/Redis, Chromium 156 and a 1920 × 1080 viewport. Command time includes builds, startup, migrations, tests and teardown. Services and artifact inspection are separate. The control has one new sample; both candidates have two with matching source/lock fingerprints. These are local M4 Max results, not CI or cross-browser speed promises.

## What was expensive

The control sent **3.59 billion source characters** across 3,667 view requests. The first reporter sample sent **4.22 million**. Time outside recorded tests fell **34.25s → 4.39s**. Context synchronization, runtime startup and assertion waits became faster too.

Interactor made **5,286 convergent assertions**; **4,639 passed on their first attempt**. Scheduled confirmation checks took **95.15s**; waits after unsuccessful attempts took **67.28s**. Attempt execution took 2.46s. These inclusive measurements overlap other work; scheduling and app processing both affect the waits.

Native reset HTTP was only **0.48s across 338 tests**. Keep cleanup correct; extra no-op tracking is not worth adding here.

## The setup pattern

**Prepare one named scenario in the app’s test server. Return small immutable data. Then exercise the real app with Interactor.**

Proposed API, not shipped:

```js
let workspace = await scenario.prepare('build-review', { comparisons: 12 });
await app.goto(workspace.reviewURL);
await Review(I).approve();
await Review(I).approved();
```

The server composes ordinary factory functions:

1. Reject old test work and wait for its started operations to finish.
2. Reset owned database, queue, storage and external fixture state.
3. Create fresh, committed records with real constraints and relationships.
4. Establish the requested session using real session issuance and cookie setters.
5. Return only needed IDs, paths and fixture values; freeze the browser result.

Programmatic prerequisites are fine. When login, logout, registration, passkeys or a job is the behavior being tested, exercise that actual UI/API/job boundary.

## Focused comparisons

| Real-stack setup | Median |
| --- | --- |
| Workspace, two requests | 35.60ms |
| Same workspace, one named request | 34.71ms |
| Eight-build graph, ten requests | 44.77ms |
| Same graph, one named request | 42.18ms |
| Same graph, named request and reused genuine fixture credential | 27.26ms |
| Existing session flow, six requests | 26.0ms |
| Lean real login, three requests | 22.3ms |
| Named session plus independent profile verification, two requests | 5.4ms |

Factory comparisons used eight alternating samples per strategy against real Koa/Postgres. Sessions used 25 measured browser samples per strategy plus equal warmups. User switching, HttpOnly cookies, storage clearing, real refresh, ownership rejection and failed preparation passed.

Batching alone saved little: Vizzly already composes its basic workspace graph in Node. Bcrypt generation cost about **14ms per fixture user**. Reusing genuine test credentials preserved real verification and application hashing settings.

The complete prototype reused those credentials, removed setup logout calls, issued real sessions, and kept independent profile checks. It did not convert every factory call to a new scenario API. The named workspace/session experiments establish that proposed boundary separately.

Cookie cleanup stays project-owned. The session proof reproduced and cleared a missed impersonation backup cookie. Dynamic OAuth cookies, IndexedDB, service workers and other storage need explicit policies.

## Alternatives we rejected as defaults

- **Fixture transaction rollback:** uncommitted setup was invisible to another app connection; that connection’s committed writes survived rollback.
- **Cached rows:** a 134-row graph improved **100.30ms → 25.40ms**, combining cached credentials, bulk inserts and skipped lookups. But naïve restoration doubled screenshot counts **10 → 20** through a real trigger. Restoring rows without factory counter state made the next factory insert collide.
- **Database cloning:** worked after closing source pools, but blocked while they were open. Clone timings exclude app/worker reconnection and other state.
- **Shared mutable fixtures:** leave cases dependent on earlier mutations.

Start with fresh records, the current batched reset, immutable credential reuse and bulk-oriented factories. Keep snapshots as a project optimization for measured expensive graphs.

## Interactor work

The conservative candidate combines action readiness into one convergence cycle while preserving custom assertions, retry frequency and reliability. Fill still focuses before checking editability; moving everything before focus broke a real focus-enabled input.

Twenty ready save workflows improved **2.06s → 1.38s**. The real IndexedDB variant improved **2.40s → 1.72s**, retaining genuine failed-state waits. Confirmation cycles fell **120 → 80**.

This requires a small upstream selection-only helper. Nesting today’s public `find()` inside retries mutated selector scope and failed. Do not ship copied selector internals or maintain a Dyno fork. The successful prototype passed **25 focused outcomes each in Chromium and WebKit**, covering custom assertions, chained scopes, option events and document navigation. Local Firefox failed before launch with a profile-folder error, including an explicit-profile retry; its correctness remains unverified.

A separate unchanged-upstream reproduction found that a throwing confirmation can retain an earlier successful result. Fix that with a dedicated real-DOM regression before productionizing the upstream work. The spike preserved the existing behavior.

## What to implement

1. **Reporter transport:** add a shared pure change/reconstruction helper in `src/browser/shell.js` and `src/browser-control.js`. Keep one ordered publisher based on the last acknowledged view. Replace changed records absolutely so replay cannot duplicate output. Preserve late observers, reopen, commands, errors, timings and attachments. Keep native cleanup unchanged.
2. **Supported Interactor changes:** land the selection helper, timing observer and separate confirmation-error fix upstream. Adopt a tested release; preserve scoped/chained behavior and post-focus editability.
3. **Small scenario transport:** expose the proposed `scenario.prepare(name, input)`, once per test, through Dyno’s authenticated gateway to a finite project registry. Return JSON plus drain/reset/seed/session timings. Forward real Set-Cookie responses so URL-only browsers need no driver. Reject arbitrary functions, SQL and unknown names.
4. **Execution ownership:** validate captured run/execution/request IDs against the active execution. App navigation must retain the same setup scope. Reject stale/duplicate preparation, cancel and drain started work before resetting, and stop the run if cleanup cannot finish. Use existing runtime/shell/server boundaries with explicit project cleanup callbacks.
5. **Project adoption:** deliberately replace Vizzly’s granular setup path, then validate the pattern in Tornadic. Keep factories, session/cookie policy, jobs, storage and external fixture state in each app. Preserve complete outcome/image catalogs and serial benchmarks.

Vizzly’s app process already owns queues, fixture gates, provider state and cookie responses. Moving setup into a separate Node process does not remove the browser request or reset those app-local values. Dyno should own transport, execution lifecycle and timings—not ORM adapters.

The real HTTP/process/filesystem proof passed **seven checks**. It reproduced stale work entering after the current bridge’s reset; aborting fetch alone did not stop server writes. The candidate rejected old requests, drained unfinished effects, recovered from failed setup/reset and cleaned each scope once. This does not prove Vizzly’s jobs/storage are already fully isolated.

Production validation needs real CLI/browser/app cases for failed seeding, cancellation during writes, stale preparation, account switching, pending jobs, recovery and reporter reconnection. Open standalone reporters still receive full snapshots in this prototype; measure that throughput separately. Do not add shards, sleeps, weaker assertions or automatic retries.

The [reporting follow-up](reporting-stream.md) measures canonical outcomes and incremental live updates with the full suite and a real reporter open and closed.

The [concurrency follow-up](concurrency.md) tests isolated worker resources and seeded execution. It also identifies background transactions that Vizzly’s current API reset gate does not drain.

## Evidence

[Recorded results](results/scenario-setup.json) contain full-run samples, source fingerprints and focused comparisons. Raw scripts, logs, images and all six lane reports remain at `/private/tmp/dyno-setup-spike-bWcLER`.

Reports: `scenarios/REPORT.md`, `database/REPORT.md`, `sessions/REPORT.md`, `reporter/REPORT.md`, `interactor/REPORT.md`, `isolation/REPORT.md`. Integrated prototypes and the complete-suite harness are in `integration/`. Failed harness attempts are preserved and excluded.
