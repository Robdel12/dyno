# Removing unused reporter work

The first complete Vizzly port passed 339 outcomes but took 386.88 seconds, compared with Playwright’s 309.75 seconds. Before changing test behavior, we measured work Dyno was doing between tests and while its reporter was closed.

## What changes

The app creates the reporter iframe when you first open it. Closing it keeps its route, but stops rendering and forwarding snapshots until it opens again. Standalone reporters still receive current results. Command acknowledgements still arrive while the embedded reporter is closed.

Node serializes an event only when a live listener can receive it. Known, run-specific suite bundles and source maps use the browser cache. Each execution still evaluates the entire suite in fresh globals; cached bytes do not share test state.

The internal default-viewport check avoids resizing and repainting when configured, actual, and observed geometry already match. Public `app.setViewport()` calls keep their existing behavior. A changed size, mode, or pixel ratio takes the normal sizing path.

## Disposable experiment

Each variant ran 338 contact-save workflows across 38 files. Every test loaded a fresh app document, saved through HTTP, checked the result, and verified fresh globals and complete registration. Runs used one worker, no shards, unchanged deadlines, Chromium 156.0.8078.4, Node 24.22.1, and an Apple M4 Max.

| Measured work | Control | Lazy reporter and cache | All changes |
| --- | ---: | ---: | ---: |
| Passing cases | 338 | 338 | 338 |
| Browser run | 89.204 s | 83.334 s | 76.481 s |
| Command wall time | 89.907 s | 84.013 s | 77.110 s |
| Outside test bodies | 22.512 s | 19.503 s | 14.145 s |
| Reporter frames | 676 | 0 | 0 |
| Hidden reporter renders | 2,701 | 0 | 0 |
| Discarded snapshot serializations | 3,386 | 0 | 0 |
| Execution-frame suite transfer | 111.2 MB | 0 | 0 |

These are single, ordered, instrumented model runs. The final variant was 14.26% faster than control in that model; this is **not a Vizzly speedup**. A smaller 40-case experiment showed no material whole-run gain. Timing intervals can overlap and must not be added to explain wall time.

The initial control passed its test cases but exceeded the unchanged event-size cap when exporting instrumentation. It is excluded. The table uses a fresh control and candidates with the same compact diagnostic format and fixture hash. [Recorded measurements](results/runner-performance.json) retain the source hashes, timing summaries, and work counters.

## Checks and limits

The interactive probe exercised first opening, output while closed, reopening on the same route with fresh output, acknowledgements, a late standalone observer, screenshot guards, and Continue. Another probe checked repeated public resizing, actual image dimensions, and default-size restoration in the next test.

Suite registration itself took a median 1.7 ms at this scale. Loading only the selected file would change cross-file focus behavior, so full registration stays. Full snapshots still cross from the controller to Node; that remaining cost has not been redesigned.

The [complete Vizzly follow-up](scenario-setup.md) measures the remaining snapshot cost, scenario setup, and Interactor readiness checks. It keeps all 339 outcomes and 232 image checkpoints.
