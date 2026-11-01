# CI

[ci.yml](../.github/workflows/ci.yml) runs on pull requests, pushes to main, merge queues, and manual dispatch. Branch pushes don't duplicate a pull request run. A newer run cancels the previous run for the same PR or ref.

## Test suites

| Suite | Command | CI coverage |
| --- | --- | --- |
| Core | `npm run test:core` | CLI errors, immutable state, cleanup, and proxy transforms on Linux Node 24/26 and macOS Node 24; no browser needed |
| Package | `npm run test:package` | Fresh tarball and checkout installs, init, and a real Chromium test on Node 26 |
| Browser | `npm run test:browser -- firefox` | Real app, gateway, viewport, and process workflows in Chromium, Firefox, and WebKit on Linux and macOS, using Node 24 |
| Execution | `npm run test:execution -- firefox` | Assignment, seeded order, suite hooks, cleanup, pause, watch and replacement workflows in all three engines on Linux and macOS |
| Reporter | `npm run test:reporter -- firefox` | Inspection, output, timings, reruns, and portable saved reports in all three engines on Linux and macOS |
| Native | `npm run test:native -- firefox` | Native defaults, capabilities, state restoration, dialogs, diagnostics, and cancellation in all three engines on Linux and macOS |
| Capture | `npm run test:capture` | Actual pixels and capture lifecycle in Chromium, Firefox, and WebKit on Linux and macOS, using Node 24 |

`npm test` runs every suite locally with Chromium. Install its browser build with `node bin/dyno.js install`. Pass an engine name to select another target:

```sh
node bin/dyno.js install --browser firefox
npm run test:browser -- firefox
```

Tests live under `tests/core`, `tests/package`, `tests/browser`, `tests/execution`, `tests/reporter`, `tests/capture`, and `tests/native`. The runner discovers every `.test.js` file in the selected directory and rejects test files outside these suites. Keep browser-free checks in core and browser workflows in the relevant feature suite. Tests use real CLI, server, and Playwright browser boundaries; these groups only decide where they run.

Core checks and actionlint workflow validation run first. The other suites run in parallel once core passes. Browser, execution, reporter, native, and capture suites have separate jobs so each complete suite has its own budget. Each test job has a hard five-minute cap, including setup. Browser and execution checks run up to three independent files together; each owns its app, gateway, browser profiles, and fixture directory. Tests inside a file stay sequential. Reporter, native, capture, and package suites stay sequential. The macOS process-group check runs once in core instead of repeating for each browser. There are no retries or extra sleeps.

Execution and reporter checks have their own suites because the combined macOS Firefox browser suite reached 288–294 seconds, leaving no room for setup under the five-minute cap. Every test and engine/OS combination remains covered. Product suites and benchmarks keep their configured execution; this grouping only changes Dyno's own CI.

## Results and setup

Each test job uploads `output.log` and `results.xml` under its own artifact name, retained for seven days. They include failed test diagnostics; they don't retain fixture app data or screenshot files. Set `DYNO_TEST_REPORT_DIR` locally to write JUnit output alongside the console report.

**CI complete** depends on every suite and fails if any required job fails, is cancelled, or is skipped. Use that check for branch protection. Workflow-level cancellation still cancels the run.

Shared actions in `.github/actions` install Node/dependencies and run/report a suite. Official actions are pinned to commit SHAs. The workflow has read-only repository access, doesn't persist checkout credentials, and uses ordinary pull-request events for contributions from forks.

Linux browser and package jobs use the official Playwright Noble image, which includes browsers and system dependencies. Keep its version aligned with `playwright-core` in `package.json`; those jobs don't download browser builds. macOS jobs install the matching engine because Linux containers cannot verify macOS behavior. The image runs as `pwuser`, matching the hosted workspace owner so Firefox can start without a home-directory ownership conflict. Linux tests supply a D-Bus session and a virtual display for headed interactive workflows. WebKit CI coverage does not establish Safari behavior. See [browser setup](browsers.md) for known limits.

Product runs also write `.dyno/reports/<run-id>/`. Upload the whole folder for portable HTML/images, or give `junit.xml` to a test-results consumer. `run.json` uses an explicit schema version and marks interrupted runs and tests without results. These are separate from the Node test runner's own CI output.
