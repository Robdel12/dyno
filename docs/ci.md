# CI

[ci.yml](../.github/workflows/ci.yml) runs on pull requests, pushes to main, merge queues, and manual dispatch. Branch pushes don't duplicate a pull request run. A newer run cancels the previous run for the same PR or ref.

## Test suites

| Suite | Command | CI coverage |
| --- | --- | --- |
| Core | `npm run test:core` | CLI errors, immutable state, cleanup, and proxy transforms on Linux Node 24/26 and macOS Node 24; no browser needed |
| Package | `npm run test:package` | Fresh npm and pnpm 11 tarball installs, checkout installs, types, init, and a real Chromium test on Node 26 |
| Browser | `npm run test:browser -- firefox` | Real app, gateway, viewport, and process workflows in Chromium, Firefox, and WebKit on Linux, and Chromium and WebKit on macOS, using Node 24 |
| Execution | `npm run test:execution -- firefox` | Native concurrency, ownership, queue replay, seeded order, suite hooks, cleanup, pause, watch and replacement workflows in all three engines on Linux, and Chromium and WebKit on macOS |
| Repeat | `npm run test:repeat -- firefox` | Repeated selections, seeded batches, resource reuse, cancellation and cleanup in all three engines on Linux, and Chromium and WebKit on macOS |
| Project | `npm run test:project -- firefox` | Project setup, fixture calls, and per-test preparation in all three engines on Linux, and Chromium and WebKit on macOS |
| Reporter | `npm run test:reporter -- firefox` | Inspection, output, timings, reruns, and portable saved reports in all three engines on Linux, and Chromium and WebKit on macOS |
| Native | `npm run test:native -- firefox` | Native defaults, capabilities, state restoration, dialogs, diagnostics, and cancellation in all three engines on Linux, and Chromium and WebKit on macOS |
| Capture | `npm run test:capture` | Actual pixels and capture lifecycle in Chromium, Firefox, and WebKit on Linux, and Chromium and WebKit on macOS, using Node 24 |

`npm test` runs every suite locally with Chromium. Install its browser build with `node bin/dyno.js install`. Pass an engine name to select another target:

```sh
node bin/dyno.js install --browser firefox
npm run test:browser -- firefox
```

Tests live under `tests/core`, `tests/package`, `tests/browser`, `tests/execution`, `tests/repeat`, `tests/project`, `tests/reporter`, `tests/capture`, and `tests/native`. The runner discovers every `.test.js` file in the selected directory and rejects test files outside these suites. Keep browser-free checks in core and browser workflows in the relevant feature suite. Tests use real CLI, server, and Playwright browser boundaries; these groups only decide where they run.

Every job starts at once, including core checks, actionlint, and documentation. Browser, execution, and reporter suites each get their own job. Project, native, repeat, and capture share one job per OS and engine, since on its own each is mostly setup time. Browser jobs have a ten-minute limit, including setup; core, package, and documentation jobs have five. Firefox runs on Linux only: the free plan runs five macOS jobs at a time, and macOS Firefox took the largest share of that time without covering macOS-specific code. A failed job lists its failing tests on the run's summary page. Browser and execution suites run up to three files at once, each with its own app, gateway, browser profiles, and fixtures. Tests within a file and all other suites run sequentially. The macOS process-group check runs once in core. There are no retries or extra sleeps.

## Results and setup

Each test job uploads `output.log` and `results.xml` under its own artifact name, retained for seven days. They include failed test diagnostics; they don't retain fixture app data or screenshot files. Set `DYNO_TEST_REPORT_DIR` locally to write JUnit output alongside the console report.

**CI complete** depends on every suite and fails if any required job fails, is cancelled, or is skipped. Use that check for branch protection. Workflow-level cancellation still cancels the run.

Shared actions in `.github/actions` install Node/dependencies and run/report a suite. Official actions are pinned to commit SHAs. The workflow has read-only repository access, doesn't persist checkout credentials, and uses ordinary pull-request events for contributions from forks.

Linux browser and package jobs use the official Playwright Noble image, which includes browsers and system dependencies. Keep its version aligned with `playwright-core` in `package.json`; those jobs don't download browser builds. macOS jobs install the matching engine because Linux containers cannot verify macOS behavior. The image runs as `pwuser`, matching the hosted workspace owner so Firefox can start without a home-directory ownership conflict. Linux tests supply a D-Bus session and a virtual display for headed interactive workflows. WebKit CI coverage does not establish Safari behavior. See [browser setup](browsers.md) for known limits.

Product runs also write `.dyno/reports/<run-id>/`. Upload the whole folder for portable HTML, or give `junit.xml` to a test-results consumer. Set `reportImages: true` to include PNGs in the portable folder. `run.json` uses an explicit schema version and marks interrupted runs and tests without results. These are separate from the Node test runner's own CI output.

## Local framework coverage

Application coverage (`dyno --coverage`) measures the app under test. To measure Dyno itself, run:

```sh
npm run test:coverage
npm run test:coverage:check
```

Both commands run the real Chromium suite and save HTML, LCOV, JSON, and a summary under `.dyno/coverage/`. The check command also requires 90% lines, statements, functions, and branches overall and in each source group. Host/shared source means `bin/` and non-browser `src/`; browser source means `src/browser/`. The groups follow file locations, even when a shared module runs in both Node and the browser.

Every Dyno JavaScript file in `bin/` and `src/` starts in a zero-hit baseline. The vendored Interactor snapshot is third-party code and isn't part of this target. The runner instruments one reusable copy under `.dyno/coverage/source`, leaving the working source unchanged. Node subprocesses and browser documents use matching Istanbul definitions and canonical source paths. Replayed snapshots from one document replace earlier counts; independent executions add their hits once. The browser collector also covers the companion, execution frames, and live reporters.

Use `npm run test:coverage -- --suite core` for a smaller run. Its report is labeled as a subset, still counts all product files, and can't pass the full-suite check. Failed tests or collection errors fail the command too. Keep running the full browser matrix; a coverage percentage can't replace it. A forced process kill can lose final counters.

Each invocation replaces the previous local coverage output. Keep any report you need before running it again. This collector is only for local work on Dyno. It isn't installed in user apps.

## Documentation

The required Documentation job installs the isolated site toolchain, checks generated Markdown, builds the site and exercises release archives, version switching and search. The Docs workflow assembles Next and frozen release assets. [Working on the docs](documentation.md) covers publishing.
