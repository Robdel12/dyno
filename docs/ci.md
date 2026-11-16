# CI

[ci.yml](../.github/workflows/ci.yml) runs on pull requests, pushes to main, merge queues, and manual dispatch. Branch pushes don't duplicate a pull request run. A newer run cancels the previous run for the same PR or ref.

## Test suites

| Suite | Command | CI coverage |
| --- | --- | --- |
| Core | `npm run test:core` | CLI errors, immutable state, cleanup, and proxy transforms on Linux Node 24/26 and macOS Node 24; no browser needed |
| Package | `npm run test:package` | Fresh tarball and checkout installs, init, and a real Chromium test on Node 26 |
| Browser | `npm run test:browser -- firefox` | Real app, gateway, viewport, and process workflows in Chromium, Firefox, and WebKit on Linux and macOS, using Node 24 |
| Execution | `npm run test:execution -- firefox` | Native concurrency, ownership, queue replay, seeded order, suite hooks, cleanup, pause, watch and replacement workflows in all three engines on Linux and macOS |
| Repeat | `npm run test:repeat -- firefox` | Repeated selections, seeded batches, resource reuse, cancellation and cleanup in all three engines on Linux and macOS |
| Project | `npm run test:project -- firefox` | Project resource acquisition, fixture transport and per-execution preparation in all three engines on Linux and macOS |
| Reporter | `npm run test:reporter -- firefox` | Inspection, output, timings, reruns, and portable saved reports in all three engines on Linux and macOS |
| Native | `npm run test:native -- firefox` | Native defaults, capabilities, state restoration, dialogs, diagnostics, and cancellation in all three engines on Linux and macOS |
| Capture | `npm run test:capture` | Actual pixels and capture lifecycle in Chromium, Firefox, and WebKit on Linux and macOS, using Node 24 |

`npm test` runs every suite locally with Chromium. Install its browser build with `node bin/dyno.js install`. Pass an engine name to select another target:

```sh
node bin/dyno.js install --browser firefox
npm run test:browser -- firefox
```

Tests live under `tests/core`, `tests/package`, `tests/browser`, `tests/execution`, `tests/repeat`, `tests/project`, `tests/reporter`, `tests/capture`, and `tests/native`. The runner discovers every `.test.js` file in the selected directory and rejects test files outside these suites. Keep browser-free checks in core and browser workflows in the relevant feature suite. Tests use real CLI, server, and Playwright browser boundaries; these groups only decide where they run.

Core checks and actionlint workflow validation run first. Browser and package suites run in parallel once core passes. Documentation runs separately. Browser, execution, repeat, project, reporter, native, and capture suites have separate jobs so each complete suite has its own budget. Each test job has a hard five-minute cap, including setup. Browser and execution checks run up to three independent files together; each owns its app, gateway, browser profiles, and fixture directory. Tests inside a file stay sequential. Repeat, project, reporter, native, capture, and package suites stay sequential. The macOS process-group check runs once in core instead of repeating for each browser. There are no retries or extra sleeps.

## Results and setup

Each test job uploads `output.log` and `results.xml` under its own artifact name, retained for seven days. They include failed test diagnostics; they don't retain fixture app data or screenshot files. Set `DYNO_TEST_REPORT_DIR` locally to write JUnit output alongside the console report.

**CI complete** depends on every suite and fails if any required job fails, is cancelled, or is skipped. Use that check for branch protection. Workflow-level cancellation still cancels the run.

Shared actions in `.github/actions` install Node/dependencies and run/report a suite. Official actions are pinned to commit SHAs. The workflow has read-only repository access, doesn't persist checkout credentials, and uses ordinary pull-request events for contributions from forks.

Linux browser and package jobs use the official Playwright Noble image, which includes browsers and system dependencies. Keep its version aligned with `playwright-core` in `package.json`; those jobs don't download browser builds. macOS jobs install the matching engine because Linux containers cannot verify macOS behavior. The image runs as `pwuser`, matching the hosted workspace owner so Firefox can start without a home-directory ownership conflict. Linux tests supply a D-Bus session and a virtual display for headed interactive workflows. WebKit CI coverage does not establish Safari behavior. See [browser setup](browsers.md) for known limits.

Product runs also write `.dyno/reports/<run-id>/`. Upload the whole folder for portable HTML/images, or give `junit.xml` to a test-results consumer. `run.json` uses an explicit schema version and marks interrupted runs and tests without results. These are separate from the Node test runner's own CI output.

## Local framework coverage

Application coverage (`dyno --coverage`) measures the app under test. To measure Dyno itself, run:

```sh
npm run test:coverage
npm run test:coverage:check
```

The first command runs the real Chromium suite and writes HTML, LCOV, JSON, and a summary under `.dyno/coverage/`. The check command also requires 90% lines, statements, functions, and branches in the combined source and each source group. Host and shared source includes `bin/` and non-browser `src/`; browser source includes `src/browser/`. These groups describe file locations. Shared modules can execute in both Node and browser contexts.

Every product JavaScript file in `bin/` and `src/` starts in a zero-hit baseline. The runner instruments one reusable copy under `.dyno/coverage/source`, leaving the working source unchanged. Node subprocesses and browser documents use matching Istanbul definitions and canonical source paths. Replayed snapshots from one document replace earlier counts; independent executions add their hits once. The browser collector also covers the companion, execution frames, and live reporters.

Use `npm run test:coverage -- --suite core` for a smaller diagnostic run. Subset reports keep the full denominator and are explicitly labeled; they cannot pass the full-suite check. A failed test run or collection failure still fails the command. Coverage reports do not replace the existing test and browser matrix, and a forced process kill can prevent final counters from being saved.

Each invocation replaces the previous local coverage output. Keep any report you need before running it again. This is a local contributor workflow; the application coverage feature does not install this collector in user apps.

## Documentation

The required Documentation job installs the isolated site toolchain, checks generated Markdown, builds the site and exercises release archives, version switching and search. The Docs workflow assembles Next and frozen release assets. [Working on the docs](documentation.md) covers publishing.
