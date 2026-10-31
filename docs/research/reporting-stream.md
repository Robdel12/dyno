# One result path, smaller live updates

October 31, 2026. Measurements from a disposable swarm spike. The [production review](production-review.md) tracks the later implementation and remaining prerequisites.

## Results

The open reporter was receiving the entire growing history on every update. The previous spike had fixed browser-to-Node delivery but left this second expensive path intact.

| Variant | Reporter | Command samples | Healthy median |
| --- | --- | --- | --- |
| Control | Closed | 208.90 / 212.40s | 210.65s |
| Candidate | Closed | 211.04 / 213.10s | 212.07s |
| Control | Open | 226.85 / 226.42s; observer failed | — |
| Candidate | Open | 214.69 / 206.68s | 210.69s |

All eight comparisons passed **338 browser cases, one Node factory case and 232 exact PNG filename/dimension checks**. Ordered test catalogs and sources matched. No skips, test retries, shards, baseline acceptance or live Vizzly publication. The image catalog retains the previously documented repository-search height correction.

Observer updates fell **3.04 GB → 3.10 MB per run** at the median, about **982× less**. Both control reporters hit backpressure four times and opened five connections. Both candidates kept one connection, rendered all 338 completed rows and matched the saved report’s retained data.

The failed control audit adds roughly 12s. Those commands are invalid as healthy speed comparisons; the final digest check was blocked, so their reporter-data integrity is unverified. This does not establish lost data.

**No demonstrated suite speedup.** The closed candidate median was 1.42s slower. Candidate open/closed ranges overlap, with no consistent penalty for opening its reporter. The earlier 199.72s result used different prerequisites and scaffolding; it is background, not this control. The win here is reliable live reporting with much less traffic.

## The design

Four workers investigated canonical results, observer delivery, measurement and failure behavior. Root combined their prototypes and measured serially.

1. Send the browser catalog to Node once. Accepted result events own final outcomes. Node reconstructs logs from acknowledged chunks and uses its accepted screenshot/error data.
2. Send changing live fields and new output only. Keep one ordered publisher, skip empty updates and flush before normal results/completion. Fatal reporting can proceed if flushing fails. Accepted outcomes override stale updates. Live patches use original catalog indices; outcomes use stable test IDs, including filtered runs.
3. Give connecting reporters one snapshot, then sequenced changed-test records. Reconnect from current state. Observer writes do not wait for reader progress; serialization still uses Node’s event loop.
4. Apply every change to immutable reporter state. Coalesce render calls with animation frames; show terminal states and command/route changes immediately. Retain complete logs, timings and attachments.

Result HTTP and live-update HTTP remain separate. The 338 result acknowledgements cost **0.28–0.32s total**; keep them. A WebSocket has no measured justification. Node’s microtask batch coalesced **zero** views in these runs; avoiding repeated history mattered most. Render calls coalesced independently.

## Measurement

Same app, tests, lockfile and Interactor sources throughout; frozen runner/harness fingerprints matched afterward. Fresh owned PostgreSQL/Redis per run, one worker, no overlapping timed workloads. Apple M4 Max, Node 24.22.1, Chromium 156, app viewport 1920 × 1080.

“Open” uses the real standalone reporter in separate headless Chromium, document-visible at 1440 × 1000 before test one. It rendered intermediate progress on the overview throughout. After completion, Interactor checked actual console/timing detail and decoded a screenshot. Every test’s status, duration, output, timings and attachment identity/name/status/dimensions were compared with its saved report. That digest does not hash image bytes.

Command time includes builds, app migration/startup, tests, teardown and observer launch/validation/cleanup. Docker setup/cleanup and analysis are separate. Browser time excludes observer gates but includes live reporting contention. Render timings measure synchronous JavaScript/DOM work, not compositor paint. Two local samples per condition do not establish CI, headed or cross-browser performance.

## Shared correctness fixes

The first control failed three app cases and captured 231 images; it is preserved and excluded. Both variants then received identical isolated prerequisites:

- Clear Interactor’s prior result before each attempt. Throwing confirmations could retain an earlier success. Twelve pure and twelve real-DOM checks passed.
- Derive privacy defaults from server values and retain only edits. Late project responses had overwritten early user input. Four real React/API-client/HTTP cases, ten browser checks, passed.
- Close API admission, release fixture gates and drain actual handlers before SQL reset. Four real HTTP/PostgreSQL cases passed, including client abort and reset recovery. The lost initial deadlock SQL remains unknown; the controlled proof reproduces its lock-order class. Later jobs/timers remain outside this gate.

The affected 36 Vizzly workflows passed before the matrix was frozen. These are correctness prerequisites, not reporting speedups.

## Gaps in the prototype

The spike identified the following implementation requirements. [PR #18](https://github.com/Robdel12/dyno/pull/18) addresses the reporting transport and failure paths with real gateway/browser tests. The [production review](production-review.md) records that later evidence; supported Interactor changes remain separate.

The prototype still needed:

- Validate whole live updates before mutation: fields, duplicate indices, output, sequences, ownership and sparse IDs. Bound exact-replay receipts; reject gaps and changed replay.
- Preserve terminal persistence acknowledgement. Define lost-ack behavior for result/terminal events; only the last live update has a replay receipt today. Prove interrupted output, failed writes, screenshot cancellation and commands during busy reporting. Partial fatal output is not yet proven durable.
- Preserve reconnect, late observers, routes/search/focus and full details. Six final real CLI/browser boundary tests passed. Some adversarial evidence targets a separate contract sketch, not the chosen gateway.
- Handle initial snapshots above 8 MB; the current guard cannot deliver them. Bound connection count too. Ending a blocked response does not immediately free its queue.
- Land supported Interactor changes upstream; adopt a release rather than shipping a Dyno fork.

Next, investigate the **73.33s confirmation waits** and **56.68s convergence waits** in the open candidate median: 4,254 assertions, about 3,596 initially ready. These inclusive intervals overlap other work. Separate scheduled readiness confirmation from delayed app state before changing behavior; preserve outcomes and reliability.

## Evidence

The [concurrency follow-up](concurrency.md) measures full-suite worker pools and seeded order, including how one canonical result model accepts out-of-order completion.

[Recorded results](results/reporting-stream.json) retain all comparisons, fingerprints, boundaries, validation and proof references. Raw scripts/logs/images and four worker reports remain at `/private/tmp/dyno-stream-spike-ubfvAa`, under `canonical`, `observers`, `harness` and `failures`.

The real slow-reader proof hit its bound after 46 updates while result/completion acceptance continued. After explicitly disconnecting the paused peer, a fresh connection recovered exact logs, timings and attachment metadata. This proves transport behavior, not crash durability. All owned services were cleaned up.
