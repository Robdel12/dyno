# CI

[ci.yml](../.github/workflows/ci.yml) runs on pull requests, pushes to main, merge queues, and manual dispatch. Branch pushes don't duplicate a pull request run. A newer run cancels the previous run for the same PR or ref.

## Test suites

| Suite | Command | CI coverage |
| --- | --- | --- |
| Core | `npm run test:core` | CLI errors, immutable state, cleanup, and proxy transforms on Node 24 and 26; no browser needed |
| Package | `npm run test:package` | Fresh tarball and checkout installs, init, and a real Chrome test on Node 26 |
| Browser | `npm run test:browser -- firefox` | Real app, gateway, reporter, viewport, and process workflows in Chrome/Firefox/Edge on Linux and macOS, using Node 24 |
| Capture | `npm run test:capture` | Actual pixels and capture lifecycle in Playwright Chromium/Firefox/WebKit and WebDriver Chrome/Firefox/Edge on Linux, using Node 24 |

`npm test` runs every suite locally with Chrome. Set `DYNO_CAPTURE_PROVIDER` and `DYNO_CAPTURE_BROWSER` to select a different capture target. For example:

```sh
DYNO_CAPTURE_PROVIDER=webdriver DYNO_CAPTURE_BROWSER=firefox npm run test:capture
```

Tests live under `tests/core`, `tests/package`, `tests/browser`, and `tests/capture`. The runner discovers every `.test.js` file in the selected directory and rejects test files outside these suites. Keep browser-free checks in core and provider-specific checks in capture. Tests still use real CLI/server/browser boundaries; these groups only decide where they run.

Core checks and actionlint workflow validation run first. The other suites run in parallel once core passes. Browser jobs run their tests sequentially, without retries or extra sleeps. Package installs run in one job instead of repeating for every browser.

## Results and setup

Each test job uploads `output.log` and `results.xml` under its own artifact name, retained for seven days. They include failed test diagnostics; they don't retain fixture app data or screenshot files. Set `DYNO_TEST_REPORT_DIR` locally to write JUnit output alongside the console report.

**CI complete** depends on every suite and fails if any required job fails, is cancelled, or is skipped. Use that check for branch protection. Workflow-level cancellation still cancels the run.

Shared actions in `.github/actions` install Node/dependencies and run/report a suite. Official actions are pinned to commit SHAs. The workflow has read-only repository access, doesn't persist checkout credentials, and uses ordinary pull-request events for contributions from forks.

Linux jobs supply a D-Bus session. `.github/scripts/install-edge.sh` installs the official Edge package and fixes the hosted image's sandbox configuration. Playwright jobs explicitly install the engine matching the locked dependency version; browser downloads aren't cached. See [browser setup](browsers.md) for known limits.

WebDriver jobs prepare the matching driver before tests start, then run Selenium Manager offline. Driver downloads have their own setup deadline and cannot consume the framework's browser startup budget.
