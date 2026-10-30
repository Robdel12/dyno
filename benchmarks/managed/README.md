# Managed capability evaluation

Run complete Vizzly comparisons with one worker and no shards. This smaller suite separately measures native-feature transport and verifies real browser outcomes. Run one benchmark at a time on an otherwise idle machine.

```sh
node benchmarks/managed/run.js direct /private/tmp/dyno-managed-reference.json 20 chromium
```

The app persists saved notes over real HTTP. Interactor handles ordinary actions and convergence. Native cases check actual Tab traversal, Space activation, CSS hover, clipboard, browser credentials, app-only offline behavior, element pixels, and media settings. WebAuthn and offline reference probes use Chromium CDP; the clipboard reference is Chromium-specific too. These probes don't replace Vizzly's full authentication/security cases or establish native capability support in other browsers.

One warmup precedes each scenario. Output keeps raw serial samples, median, p95, browser/runtime versions, setup time, and whole-workflow durations. The browser-local control runs before and after. Operation latency uses the caller's monotonic clock; it excludes setup and validation. Whole workflows include them. Don't subtract timestamps from different clocks or treat microbenchmarks as whole-suite speedups.

Prototype adapters live in separate temporary folders. Pass an adapter's absolute path as the first argument. Its `createAdapter({ context, app, controller, fixture, perform, engine })` returns either `{ name, clock: 'node', invoke, dispose }` or `{ name, clock: 'browser', invokeName, dispose }`. Browser adapters register that named async function in the controller window. The evaluator owns both clocks and wraps the actual call; adapters return values, never reported durations. The direct reference uses the Node clock as a lower bound; browser candidates use the controller window clock, excluding the harness evaluation round trip. All variants use the same operation semantics and outcome checks. Missing required behavior fails the probe.

This is evaluation code. No managed native-input API has been added to Dyno.

Operations have a five-second deadline, scenarios thirty seconds, and the whole evaluator five minutes. `DYNO_EVAL_OPERATION_TIMEOUT` changes only the operation budget for failure probes. A failure stops the run, all cleanup is attempted with its own bounds, and the final JSON records the overall verdict and cleanup failures. Source fingerprints prevent comparing different evaluation suites. Saved records must increase exactly once per sample. Offline checks use fresh no-store responses and server counters. Tall offscreen captures verify every color band and catch temporary viewport enlargement through media queries and resize observations.
