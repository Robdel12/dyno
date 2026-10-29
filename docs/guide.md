# Using Dyno

Dyno starts your app, bundles tests, and serves a URL. Tests and Interactor.js execute in that browser. The CLI reports results and stops the processes it owns.

You'll need Node 24+ and an installed browser. Chrome is the default. Dyno is early and isn't published to npm yet.

## Add it to an app

```sh
npm install --save-dev github:Robdel12/dyno
npx dyno init
npx dyno doctor
```

`init` creates `dyno.config.js` and one example test. It checks both paths before writing and leaves existing files alone. Update the command, URL, and assertion for your app.

```js
export default {
  testDir: 'tests/browser',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI
  }
};
```

```js
import { test } from 'dyno';

test('saves a contact', async ({ app, I }) => {
  await app.goto('/contacts/new');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Contact saved');
});
```

Run `npx dyno`, or add `"test:browser": "dyno"` to your package scripts. Tests can use browser APIs and browser-compatible npm packages. JavaScript, JSX, TypeScript, and TSX are supported; TypeScript is transpiled without type checking. Filesystem and database setup belongs in the Node setup hook.

## Run and inspect

```sh
dyno                              # headless run
dyno --ui                         # visible browser and repeated runs
dyno --watch                      # rerun when tests or imported helpers change
dyno --manual --host 0.0.0.0      # open the URL yourself or on another device
dyno --test 'saves a contact'      # exact test name
dyno --config path/to/config.js
dyno --json                       # one JSON event per stdout line
```

Exit codes are 0 for passing tests, 1 for failures, 130 for SIGINT, and 143 for SIGTERM. `--ui` and `--manual` keep the gateway available for reruns; Ctrl-C stops it. App and setup logs belong on stderr when using `--json`.

Open the start URL at `/__dyno__/`. Dyno opens a companion window for test execution, then loads the app in the original window. If the popup is blocked, click **Start**. Keep both windows open: tests stay in the companion while the app navigates normally.

Press **Ctrl+Shift+D** in the app to request inspection. Dyno finishes the current test before opening the reporter iframe over the app. The app keeps its full viewport underneath.

The overview groups files and suites, with search and status filters saved in its URL. Run one test, a suite, a file, or failed tests. Stable test links still point to the same test after definitions are reordered. Connection and command states stay visible; failed commands offer Try again. Open a test's Output route for failures, source excerpts, console messages, and screenshots. Its Application route lets you return to the actual app and choose a viewport. Reporter navigation never moves or scales the app.

**Run options** includes Pause on failure. Continue closes the overlay before starting the next test. Stop ends execution and leaves the last app inspectable. Only that last app is retained; rerun an earlier test to inspect it again. Pausing doesn't freeze the app's timers or requests. Closing or reloading the companion interrupts execution; start a fresh run rather than trying to resume it.

The CLI also prints a separate reporter URL. Open it in another tab to observe and control the run without covering the app. Reruns rebuild tests; separate reporters follow the new run. Back/forward navigation only changes reporter routes.

Console capture keeps the first 100 messages per test, up to 2,000 characters each, without evaluating object getters. It supports `log`, `info`, `warn`, `error`, and `debug`. Logging an error doesn't fail the test. Capture ends with the test; use the browser console for later inspection.

## Editing and debugging

`dyno doctor` checks config, bundles tests, locates the selected browser/provider, and checks the app URL without launching anything. Add `--manual` for a URL-only setup. It cannot prove that a configured server command starts successfully; the run checks its output and HTTP readiness.

`--watch` keeps the app server and browser session alive. It watches test files and imported project helpers using filesystem events. Edits during a run queue one rebuild of the latest files. Build errors leave the previous results available; fixing the file runs again. Config and Node setup changes need a CLI restart. App code keeps its own hot reload.

Use `await app.pause('Inspect this contact')` within a test or setup hook with `--ui` or `--manual`. It opens the reporter immediately, retains the current app and test, and suspends the test deadline. Continue hides the reporter and resumes the remaining budget. It does not freeze application timers or network requests. Cleanup has its own deadline and cannot pause. Headless pause calls fail clearly.

The package includes types for tests, hooks, config, fixtures, and app APIs. Browser tests use TypeScript's `moduleResolution: "Bundler"`; Interactor.js currently has extensionless declaration imports that do not support strict NodeNext checking. Config types work independently of those browser declarations. TypeScript is still transpiled during a run; use your project's `tsc --noEmit` for type checking. JavaScript editors get the same declarations.

Extend `Fixtures` in your project to type values returned by Node setup:

```ts
import 'dyno';

declare module 'dyno' {
  interface Fixtures { contactId: string }
}
```

## Browser API

Import `test`, `beforeEach`, and `afterEach` from `dyno`. Tests and hooks receive `{ app, I, fixtures, signal }`. `I` is an [Interactor.js](https://github.com/wwilsman/interactor.js) instance rooted in the current app document.

```js
await I.type('Robert').into('$(input[name=name])');
await I.click('Save');
await I.find('$([role=status])').text('Saved Robert');
await I.find('No projects yet').visible();
await I.assert(
  () => app.window.location.pathname === '/dashboard',
  'Expected the dashboard URL'
);
```

Text selectors find visible text, placeholders, and related label controls. `$(...)` selects with CSS. Interactor owns selector resolution, actions, assertion retries, and error messages. `expectTimeout` sets its assertion timeout. Wait for the result of an action; a passing assertion doesn't mean all background work is idle.

- `app.goto('/path')` waits for the app's bridge and document readiness. Use Interactor to wait for rendered UI.
- `app.setViewport({ width, height })` asks a managed provider to resize the actual app viewport and waits for layout. Each dimension must be 1–8192 CSS pixels. Native and manual runs require the requested size to already match.
- `app.screenshot(name, options)` waits for a saved PNG. See [screenshots](#screenshots).
- `app.request('/api/path', fetchOptions)` makes a same-origin request with the browser session and returns a standard `Response`.
- `app.document` and `app.window` expose the app's document and window. Await navigation before direct access; use `I.assert` callbacks for changing state.

Each test gets fresh test and app documents and globals. Queries use the current document after navigation. Execution timeout cancels the test APIs. Entered scopes still get their `afterEach` hooks, from the inside out, with fresh APIs and a separate `cleanupTimeout` budget (5 seconds by default). A failed cleanup hook does not hide the original error or prevent later cleanup within that budget. Dyno then replaces the hidden test runtime before the next test. The persistent companion survives full app navigation.

Fresh documents don't reset cookies, localStorage, IndexedDB, service workers, or database records. Use hooks to reset sessions and fixtures. Node setup teardown should clean up shared resources even if a browser test times out before `afterEach` finishes. Dyno's private window binding survives `sessionStorage.clear()`; avoid changing `window.name` during a run.

Dyno's [Interactor adapter](../src/browser/interactor.js) uses public extension APIs to create events in the app's window and check focus against its document. It doesn't replace browser globals or modify the package. Import `Interactor` from `dyno` to add your own actions and assertions.

## Suites and selection

Use `describe(name, callback)` to group tests. Its callback is synchronous; put async work in hooks or tests. Top-level hooks belong to their file. Nested `beforeEach` hooks run from the file inward, and `afterEach` hooks run from the inner suite outward.

```js
import { describe, test, beforeEach } from 'dyno';

describe('Authentication', () => {
  beforeEach(async ({ app }) => {
    await app.goto('/login');
  });

  test('opens registration', async ({ I }) => {
    await I.click('Create account');
    await I.find('Start testing UI changes').visible();
  });
});
```

Names must be unique within a suite; different files and suites can reuse a short name. Each test has a stable ID based on its file, suite path, and name. Adding another test doesn't change that ID.

`test.skip('later')` and `describe.skip` report skipped tests without executing their hooks or bodies. `test.only` and `describe.only` select focused tests locally. `forbidOnly` defaults to true when `CI` is set, so committed focus markers fail clearly.

```sh
dyno --suite Authentication
dyno --file login.test.js
dyno --test 'Authentication › opens registration'
dyno --id '<ID from test discovery/results>'
```

File, suite, and ID selectors can repeat; different selector kinds narrow each other. A short `--test` name that matches multiple tests explains how to disambiguate it. Reporter reruns use stable IDs and rebuild before execution. JSON start events include descriptors with `id`, `file`, `suites`, `name`, and the index within that bundle; outcomes include `testId`.

## Viewport sizing

Native and manual runs use the app window's actual viewport. Managed runs default to 1280 × 800 CSS pixels. Set `viewport` in config for fixed dimensions, or await `app.setViewport({ width: 390, height: 844 })` within a managed test. The next test restores its default size.

A browser page cannot reliably resize its own tab. Without a managed provider, a matching `app.setViewport` call is a no-op and any different size fails clearly. A fixed config size must also match the actual window. Resize it yourself or choose a provider; Dyno does not fake a viewport with an app iframe.

These are layout dimensions, not phone emulation. They don't set touch input, OS orientation, or physical screen size. A mobile-sized desktop viewport does not prove real-device behavior.

## Screenshots

Choose an optional [browser provider](browsers.md#add-screenshots-and-window-control). Native and manual runs need no provider package.

```js
export default {
  browser: { name: 'chrome', provider: 'playwright' },
  viewport: { width: 1280, height: 800 },
  artifactsDir: '.dyno/artifacts',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000'
  }
};
```

```js
await I.find('Dashboard').visible();
let image = await app.screenshot('dashboard', {
  fullPage: true,
  mask: [...app.document.querySelectorAll('[data-private]')],
  animations: 'disabled',
  caret: 'hide'
});
// image.path, image.url, image.width, image.height, image.pixelRatio
```

Dyno captures the original app window with the reporter hidden. By default it captures the viewport; `fullPage: true` captures the whole page without enlarging the viewport. It waits for fonts, checks the document and dimensions, and saves the PNG before resolving. Navigation, Stop, resize, or lost ownership invalidates pending captures. Screenshot and viewport requests run in order; finishing a test or hook with unfinished operations fails clearly. Await both APIs.

Without a provider, required capture fails. Use `await app.screenshot('dashboard', { optional: true })` only when the functional test is useful without an image. It returns and reports a skipped image when capture is unavailable. Provider and storage errors still fail.

Reported images remain on disk after cleanup. Interrupted runs discard images that weren't reported. JSON attachment events and test results include the path, browser/provider/version, viewport, and pixel ratio. The reporter links to the PNG while the gateway is running.

Capture options are `fullPage` (default `false`), `mask` (an array of app `Element` objects), `animations` (`'allow'` or `'disabled'`, default `'allow'`), and `caret` (`'initial'` or `'hide'`, default `'initial'`). Masks cover those elements in the PNG; pass current elements from the app document. Full-page capture is available through Playwright and WebDriver Chrome, Edge, and Firefox. WebDriver Safari rejects it clearly.

Screenshots are attachments, without baseline comparison. They record a rendered frame during the request; they don't freeze other app work. Animation suppression finishes finite animations and suspends infinite ones before measuring the document and masks. Temporary styles are removed and suspended animations restart afterward. Use Interactor to wait for the state you want first.

## Find slow work

Timings are always recorded. Open **Slowest tests** in the reporter, then a test’s **Timings** tab. It separates fresh-document setup, hooks, the body, and queued errors. Individual hooks keep their function name and execution order. Navigation, requests, screenshots, viewport changes, and debug pauses have their own intervals.

Name meaningful work around your Interactor page objects:

```js
test('saves a contact', async ({ app, I, step }) => {
  await app.goto('/contacts/new');
  let contact = await step('Save contact', async () => {
    await I.type('Robert').into('$(input[name=name])');
    await I.click('Save');
    await I.find('$([role=status])').text('Contact saved');
    return 'Robert';
  });
});
```

`step(name, callback)` returns the callback’s value and preserves its error. Use it in hooks too. Await it before finishing a test or hook. Interactor still owns interaction and convergence; timings do not wrap its polling loop or change assertion behavior.

For agents, `--json` test events and saved `run.json` tests include `timings: { duration, entries, truncated }`. Each entry has `id`, `kind`, `name`, `start`, `duration`, and `status` (`passed`, `failed`, or `cancelled`), with `phase` on operations and steps. All numbers are milliseconds from that test runtime’s monotonic clock. `performance.slowestTests` ranks up to five tests and their slowest work. `outsideTestsDuration` measures browser-run time outside accepted test runtimes, including frame startup, reporting, and any between-test inspection.

Each saved run also has `session.json`. It measures CLI config, bundling, project setup, app-server readiness, browser startup/results, and cleanup on a separate clock. Cleanup includes separate intervals for stopping the app, saving reports, project teardown, and stopping the browser. Its status is `running` until the CLI closes its resources; shutdown atomically finalizes it and emits a `session-timing` JSON event. Watch and manual runs share one session across their browser runs. The final report write itself is outside the measured wall time. These fields are separate from the browser-run duration. Managed runs also record `browserCleanup.graceful` and emit a `browser-stopped` event, so forced process cleanup is visible.

```sh
jq '.performance.slowestTests' .dyno/reports/<run-id>/run.json
jq '.timings.entries | sort_by(-.duration)' .dyno/reports/<run-id>/session.json
```

Intervals include waiting. A step can contain a request or another step, and parallel work overlaps. Do not add inclusive rows together. Debugging time is included and marked as a pause. Request timing ends when response headers arrive; reading the body belongs to the surrounding step. This measures test execution, not application CPU time.

Each test retains up to 500 entries; `truncated` counts omitted intervals. An interrupted runtime that cannot report has no timings, rather than invented zeros. Dyno records request methods and paths, without query strings, bodies, or headers. Step and screenshot names appear in reports, so keep secrets out of those labels.

## Saved reports

Each browser run saves `.dyno/reports/<run-id>/` with `run.json`, `junit.xml`, `index.html`, and `session.json`. Set `reportDir` or pass `--report-dir path` to choose another folder. The CLI prints the HTML path; JSON output includes a `report-saved` event.

Open `index.html` directly in a browser after Dyno stops. It includes searchable files/suites, failures, source excerpts, console output, timings, and screenshots copied into `images/`. Copy the whole run folder to share it. A source image removed before saving appears as Screenshot unavailable.

Run JSON uses `schemaVersion: 1`. It contains stable test descriptors, outcomes, summary counts, and relative image paths. A run is `completed` or `interrupted`; a test without an accepted result is `not-run`. Primary and additional failures retain their phase and source context. JUnit includes an error case for interruption, so an unfinished run cannot look green to CI.

Completed runs save before completion is reported. SIGINT, SIGTERM, browser loss, and app failures save accepted results before shutdown. A force kill or machine failure cannot flush results. Storage failures fail the CLI; partially written run folders never become published reports. Old reports stay until you remove them.

Reports include your test output and source excerpts. Dyno does not save its config, fixtures, connection keys, or launch tokens in them.

## App server integration

Dyno serves the start page at `/__dyno__/`, keeps its controller in a companion window, and forwards app paths to `webServer.url`, including WebSocket upgrades. The app keeps its normal routes, relative assets, and API calls. Its own server still handles hot reload.

The gateway rewrites redirects to the upstream app back to its own origin. It translates same-origin Origin/Referer headers and matching cookie domains while preserving cookie security attributes and unrelated external redirects. Foreign origins remain foreign.

A small script inserted before executable app scripts reports errors and document readiness and hosts the reporter iframe. The test bundle loads only in the companion's hidden runtime and reads the top-level app DOM directly. The app doesn't need test imports or source changes.

CSP and app isolation headers stay in place. Dyno uses the opener/embedder policies from the startup HTTP response on its own pages, keeping strict same-origin apps connected to the companion. The script uses an existing app nonce when available. If the app blocks that script, the reporter iframe, or same-origin window access, give it an explicit test configuration. Cross-origin navigation and policy changes that sever the companion relationship during a run are unsupported. The gateway supports UTF-8 HTML with gzip, deflate, and Brotli compression, up to 10 MB decoded.

### Starting and stopping the server

If the app URL already returns an HTTP response, Dyno reuses it only with `reuseExistingServer: true` and leaves it running afterward. Otherwise, Dyno starts `command` in `cwd` with `env`. Commands can be shell strings or argv arrays such as `['node', 'server.js']`.

The server must log after it starts listening. Set `webServer.ready` to match that message. Process output triggers an HTTP HEAD check; even a 404 or 401 confirms a responding server. There is no fixed startup sleep or timed polling loop.

The app receives `DYNO_URL`, the gateway origin. Root-relative URLs are easiest to use. OAuth callbacks, absolute asset hosts, and other origin-sensitive features may need app-specific test settings.

App exit, startup failure, browser exit, signals, and completed headless runs go through cleanup. Dyno stops its own processes and descendants, with a bounded grace period before forceful termination. Reused servers and native Safari tabs remain yours.

## Configuration

Paths are relative to the config file unless noted. See `dyno --help` for CLI overrides and [browser setup](browsers.md) for executable selection.

| Option | Default | Purpose |
| --- | --- | --- |
| `testDir` | `tests/browser` | Test directory |
| `testMatch` | `**/*.test.{js,jsx,ts,tsx}` | File pattern |
| `timeout` | `10000` | Test deadline, including runtime startup and hooks |
| `cleanupTimeout` | `5000` | Total budget for cleanup after execution ends |
| `expectTimeout` | `min(2000, timeout / 2)`, rounded down | Interactor assertion timeout |
| `runTimeout` | `60000` | Headless run deadline |
| `host`, `port` | `127.0.0.1`, `7357` | Gateway address; port 0 chooses a free port |
| `browser.name`, `path`, `args` | `chrome`, discovered path, `[]` | Browser and launch arguments |
| `browser.provider` | `native` | `native`, `playwright`, or `webdriver` |
| `browser.deviceScaleFactor` | `1` | Playwright pixel ratio: 1, 2, or 3 |
| `viewport` | Browser size; managed: 1280 × 800 | Required app viewport dimensions |
| `reportDir` | `.dyno/reports` | Saved JSON, JUnit, HTML, and copied images per browser run |
| `artifactsDir` | `.dyno/artifacts` | PNG output directory |
| `webServer.url` | Required | HTTP(S) origin without a path |
| `webServer.command` | None | App startup command |
| `webServer.cwd`, `env` | Config directory, inherited env | App process settings |
| `webServer.ready` | Any process output | Ready-message string or RegExp |
| `webServer.timeout` | `30000` | App startup deadline |
| `webServer.reuseExistingServer` | `false` | Reuse a responding server |
| `setup` | None | Node setup module |
| `forbidOnly` | Whether `CI` is set | Reject focused test/suite definitions |

### Node setup

The setup module exports an async function receiving `{ config, signal }`. Return `{ env, fixtures, teardown }`: app environment overrides, JSON-safe data for browser tests, and an async cleanup function. Log to stderr, and keep real credentials out of browser fixtures. If setup throws before returning, it must clean up resources it already created.

## Vizzly example

`examples/vizzly` demonstrates login and navigation against a real app and database. It needs a Vizzly checkout with built `dist` assets and Docker. Set `VIZZLY_ROOT` if the checkout isn't the sibling `vizzly` directory.

Run `npm run test:vizzly`, or append `-- --ui` to inspect it. Setup creates its own PostgreSQL and Redis containers, runs migrations and seeds, and supplies a disposable account. The app uses port 3017 and the gateway uses 7359. Cleanup removes only that run's containers and volumes.

This example is optional. `npm test` uses the self-contained fixture app.

## Current limits

The runner uses ES2022 syntax and modern APIs, including `AbortSignal.timeout`, `AbortSignal.any`, `Promise.withResolvers`, `crypto.getRandomValues`, and `EventSource`. Older browsers, including historical WebOS builds, need compatibility work. See [browser setup](browsers.md#known-limits) for verification gaps.

Interactions use DOM methods and synthetic events. They don't prove physical pointer hit-testing or satisfy every API requiring trusted user input. Closed shadow roots, native dialogs, downloads, video capture, visual baselines, parallel scheduling and HTTPS gateway serving are outside this version. Companion popups and background execution on iOS, phones, and TVs still need real-device verification; URL-only execution across browsers remains the goal.

The gateway uses HTTP. Secure cookies and secure-context-only features may need a different test origin. The app and test contexts share an origin and aren't a security sandbox. An infinite loop can freeze the browser; the Node deadline can stop a browser it owns but can't recover a manual browser's event loop.

The gateway rejects unknown Host headers and foreign WebSocket origins. Events and commands are limited to 1 MB, observer snapshots to 8 MB, and active browser runs to 20. New joins fail at capacity; finished runs can be removed to make room.
