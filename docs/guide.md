# Dyno

A small acceptance-test framework that runs your tests inside a real browser. Node starts your app, bundles the tests, serves a capture URL, and reports results. Queries, actions, and assertions execute locally in the browser.

This is a working first version with project configuration, managed app processes, Interactor.js interactions and assertions, disposable test contexts, source-mapped failures, and real Vizzly integration. It is not published to npm.

## Try it

Requires Node 24+ and an installed browser. Chrome is the default; see [browser setup](browsers.md) for Firefox, Edge, Chromium, and Safari.

```sh
npm install
node bin/dyno.js --config examples/demo/dyno.config.js
```

That command starts the demo app, builds its tests, launches a disposable headless browser, prints results, and stops the processes it owns. Exit status is 0 for passing tests, 1 for failures, 130 for SIGINT, and 143 for SIGTERM.

Use a visible browser while writing tests:

```sh
node bin/dyno.js --config examples/demo/dyno.config.js --ui
```

The app fills its own execution frame. The reporter runs in a separate sibling iframe, with its own styles and globals. Press **Ctrl+Shift+D** in the app to request inspection. During a test, Dyno pauses at the next test boundary before opening the overlay. You can also set the host URL fragment to `#reporter`.

The overview supports search and status filters. Each test has **Output** and **Application** routes; output includes source excerpts, mapped stacks, console messages, and screenshot attachments. **Show application** closes the overlay to expose the actual tested app. A **Show test results** button appears while paused or finished. Reporter navigation never moves or scales the app.

**Run options** includes **Pause on failure**. **Continue run** closes the overlay before starting the next test. **Stop run** ends execution. The last app remains inspectable; advancing disposes the previous test context. Rerun an earlier test to inspect its app again.

Open `/__dyno__/reporter?run=<run-id>` separately to observe a running test without covering its app. It receives events and sends commands through the gateway. Embedded and standalone reporters use the same UI. **Run test**, **Run failed**, and **Run all** rebuild before rerunning; standalone observers follow the replacement run. Reporter hashes preserve back/forward navigation without starting another run.

Native and manual runs fill the actual browser viewport and follow its resize events. Managed runs default to 1280 × 800 CSS pixels. Set `viewport` in config or await `app.setViewport({width:390,height:844})` inside a test. Inspector sizing is deliberate and resets before the next test. Managed providers may also resize their host; Playwright updates its emulated screen dimensions when doing so. Those values describe the session, not a physical device. Layout sizing works without a driver; it does not emulate a phone, DPR, touch, keyboard, or OS orientation. Manual browsers can have an app frame larger than their visible screen. Managed screenshots require the whole unscaled app to fit; impossible sizes fail clearly.

Console capture supports `log`, `info`, `warn`, `error`, and `debug`. It keeps the first 100 messages per test, limits each message to 2,000 characters, and avoids evaluating object getters. Logging an error does not fail a test. Output capture stops when the test finishes; use the browser console for further inspection.

App hot reload belongs to the app's own development server; the gateway forwards WebSocket upgrades.

For a manually opened browser or another device:

```sh
node bin/dyno.js --config examples/demo/dyno.config.js --manual --host 0.0.0.0
```

Open the printed capture/device URL. No driver or browser extension is required. Ctrl-C stops the gateway and owned app process. Manual and UI modes stay available for repeated captures.

## Add it to an app

Install this local checkout as a development dependency:

```sh
npm install --save-dev /Users/robertdeluca/Developer/Dyno
npx dyno init
```

`init` writes a config and one example test without overwriting existing files. It checks both paths before writing, so a conflict leaves the project alone. Update them for your application, then add `"test:browser": "dyno"` to your package scripts.

`dyno.config.js`:

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

`tests/browser/contact.test.js`:

```js
import { test } from 'dyno';

test('saves a contact', async ({ app, I }) => {
  await app.goto('/contacts/new');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Contact saved');
});
```

Tests are browser code. They can use browser APIs and ordinary npm browser dependencies. The test bundle supports JavaScript, JSX, TypeScript, and TSX; TypeScript is transpiled without type checking. Put filesystem/database setup in the Node setup hook instead.

## How the app server integrates

The gateway serves everything through one browser origin:

```text
Node CLI
  ├─ build test modules with esbuild
  ├─ start or explicitly reuse the configured app server
  └─ serve a test gateway
       ├─ /__dyno__/   execution host, reporter, test bundle, artifacts
       └─ every other path    forwarded to the app server

Browser execution host
  ├─ fresh test-runtime iframe per test, stable and unscaled
  │    └─ fresh app iframe per test
  └─ reporter iframe, hidden during execution/capture
```

The application keeps its normal paths: `/login`, `/assets/...`, `/api/...`. HTTP requests and WebSocket upgrades go to the configured app origin. Relative assets, cookies, and same-origin API calls continue to work through the gateway. Redirects pointing at the upstream app are rewritten to the gateway; unrelated external redirects are preserved.

For same-origin writes, the gateway translates its own Origin/Referer to the configured upstream origin. It preserves foreign origins, so it does not turn a rejected cross-origin caller into a trusted one. Matching cookie Domain attributes become gateway host-only cookies; HttpOnly, Secure, SameSite, Path, and other attributes remain intact.

The gateway parses HTML and inserts one external diagnostic script before executable app scripts. That script captures startup errors, rejected promises, and document lifecycle events. **The test bundle is loaded only in the test-runtime iframe**, which queries the app's DOM directly. Application source files do not need test imports or modifications.

CSP and frame restrictions are preserved. If an existing app script has a nonce, the bridge uses that nonce. An app that refuses framing or blocks the bridge still needs an explicit cooperating test configuration; this tool does not disable those policies. The upstream should serve identity-encoded UTF-8 HTML when requested; other responses stream through normally.

### Server ownership and readiness

- If the URL responds and `reuseExistingServer` is true, the CLI uses it and leaves it running afterward.
- If the URL responds and reuse is false, the command fails rather than using an unknown process.
- Otherwise, the CLI starts `command` in `cwd` with `env`. A command can be a shell string or an argv array such as `['node', 'server.js']`.
- Startup waits for an actual successful HTTP response. Probes wake on process output rather than fixed sleeps or a timed polling loop. The app should print a ready message **after** listening; `ready` can match that message explicitly.
- App exit, startup failure, browser exit, test failure, and signals all lead through owned-process cleanup. Unix process groups include children launched by npm or a shell. An unresponsive group is killed after a bounded grace period.

The child receives `DYNO_URL`, the gateway origin, if the app needs to configure an absolute public URL. Root-relative URLs are the easiest integration. OAuth callbacks, absolute asset hosts, and other origin-sensitive features may need app-specific test settings.

## Browser API

Import `test`, `beforeEach`, and `afterEach` from `dyno`. Every test/hook receives `{ app, I, fixtures, signal }`. **`I` is a real [Interactor.js](https://github.com/wwilsman/interactor.js) 3.6.2 instance**, configured with a root function that returns the current app document's body.

Use Interactor.js directly for interaction and assertions:

```js
await I.type('Robert').into('$(input[name=name])');
await I.click('Save');
await I.find('$([role=status])').text('Saved Robert');
await I.find('No projects yet').visible();
await I.assert(() => app.window.location.pathname === '/dashboard',
  'Expected the dashboard URL');
```

Its native API also supports reusable/chained interactions (`.then`), keyboard actions, negated assertions, and selector functions. Text selectors find visible text, placeholders, and related label controls; `$(...)` selects with CSS. The Vizzly example uses its actual visible field labels. The runner's former `getByRole`/`fill`/`expect` helpers and custom convergence implementation have been removed.

Interactor.js owns selector resolution, typing, keyboard behavior, polling, assertion retries, and error messages. `expectTimeout` configures its assertion timeout. The library's default 60 Hz retry frequency and one post-success reliability probe are preserved; this is not a promise that an application is globally idle or a condition remained continuously true between samples.

A small adapter in `src/browser/interactor.js` uses the library's public `defineAction` and `defineAssertion` extension APIs:

- `trigger` constructs events using the target element's app window.
- `click` constructs an app-realm MouseEvent with the app window as `view`, retains option-selection behavior, and returns the clicked element without re-querying it after a React navigation removes it.
- `focused` checks the target element's owner document rather than the runner document.

These address the published package's assumptions about the global Event/MouseEvent/document. Package source is unchanged; no globals are replaced and no test code is injected into the app realm. Tests can import the same `Interactor` class from `dyno` to define additional native actions/assertions through its public API.

The runner owns app navigation, sizing, and optional capture:

- `app.goto('/path')` waits for the app's early bridge and document readiness. Interactor assertions then wait for rendered UI.
- `app.setViewport({width,height})` changes the app frame layout and waits for its actual size. Each dimension is 1–8192 CSS pixels.
- `app.screenshot(name, {optional:false})` awaits a persisted PNG attachment from this browser’s optional provider. See below.
- `app.request('/api/path', fetchOptions)` makes a real same-origin request with the browser session and returns a standard Response.
- `app.document` and `app.window` expose the current app realm. Await navigation before direct access; use `I.assert` callbacks or native Interactor selectors for changing state.

Every test gets fresh test and app JavaScript realms. The Interactor root is evaluated again for queries, so navigation cannot leave it holding an old document. Timeouts dispose the test frame, so late test tasks cannot run into the next test.

Errors are attributed while a test is active. Assert the completion of the work an action starts; a posted-message checkpoint is not a guarantee that all application background work is idle.

Origin storage and backend state are intentionally explicit: frames do not reset cookies, localStorage, IndexedDB, service workers, or database records. Use hooks to reset sessions/fixtures. Node setup teardown remains responsible for shared resources, including when a browser test times out before afterEach can complete.

## Configuration and commands

| Option | Default | Purpose |
| --- | --- | --- |
| `testDir` | `tests/browser` | Relative to the config file |
| `testMatch` | `**/*.test.{js,jsx,ts,tsx}` | Test discovery pattern |
| `timeout` | `10000` | Entire browser test, including runtime startup and hooks |
| `expectTimeout` | `2000`, capped at half the test timeout | Interactor assertion timeout |
| `runTimeout` | `60000` | Headless completion deadline for missing/stuck browsers |
| `host`, `port` | `127.0.0.1`, `7357` | Gateway address; port 0 chooses an available port |
| `browser.name`, `browser.path`, `browser.args` | `chrome` | Browser family, executable, and extra arguments |
| `browser.provider` | `native` | URL-only launching, `playwright`, or `webdriver` |
| `browser.deviceScaleFactor` | `1` | Playwright pixel ratio: 1, 2, or 3 |
| `viewport` | Browser size; managed: `{width:1280,height:800}` | Explicit per-test app layout dimensions |
| `artifactsDir` | `.dyno/artifacts` | PNG output, relative to config |
| `webServer.url` | Required | App HTTP(S) origin, without a path |
| `webServer.command` | None | Command to start when the URL is unavailable |
| `webServer.cwd`, `env` | Config directory, inherited env | App process settings |
| `webServer.ready` | Any process output | Ready-message string or RegExp after listening, followed by an HTTP HEAD response check |
| `webServer.timeout` | `30000` | App startup deadline |
| `webServer.reuseExistingServer` | false | Explicit permission to reuse a responding server |
| `setup` | None | Path to a Node setup module |

The optional setup module exports an async function receiving `{ config, signal }`. It returns `{ env, fixtures, teardown }`: environment overrides for the app process, explicit JSON-safe data available to browser tests, and an async cleanup function. If setup fails before returning, it must clean up anything it already created. Do not put real credentials into browser fixtures.

```sh
dyno                              # headless run, exit 0/1
dyno --ui                         # visible Chrome and repeated runs
dyno --manual --host 0.0.0.0      # open the URL yourself/on a device
dyno --test 'saves a contact'      # exact test name
dyno --config path/to/config.js
dyno --json                       # structured lifecycle events
```

`CHROME_PATH` can select the launcher executable. `--manual` works without a local browser installed. `dyno browsers` lists available launchers; `--browser` overrides the configured name. The native launcher only opens the URL. Optional providers use browser protocols for launch, host sizing, and pixels; test actions and assertions stay browser-local.

## Screenshots

Install an optional provider and select it explicitly; [browser setup](browsers.md) lists the targets. Native/manual runs need no provider package.

```js
browser: { name: 'chrome', provider: 'playwright' },
viewport: { width: 1280, height: 800 },
artifactsDir: '.dyno/artifacts'
```

```js
await I.find('Dashboard').visible();
let image = await app.screenshot('dashboard');
// image.path, image.url, image.width, image.height, image.pixelRatio
```

The image is the actual app viewport, excluding the reporter. Dyno waits for app fonts, validates the current document and viewport, stages the PNG, then acknowledges after saving it. Await captures and viewport changes. A test or cleanup hook that finishes with unfinished app operations fails clearly; Dyno does not silently drain fire-and-forget work. Navigation, Stop, viewport changes, or lost ownership invalidate pending images; Dyno never retries against another document or browser. Captures and resizing are serialized per execution.

A missing provider fails a required screenshot. `await app.screenshot('dashboard',{optional:true})` instead returns `{status:'skipped',reason,...}` and reports an explicitly skipped image when no capture capability exists. Connected-provider or storage failures still fail. Images are attachments, not visual assertions or baseline comparisons. Use explicit optional capture only when the functional assertions are sufficient without pixels.

Images included in test results survive CLI cleanup. Interrupted runs discard captures that were never reported. JSON `attachment` events and each test result include metadata: browser/build/provider/version, viewport, pixel ratio, and path. The reporter links to images while the gateway is running. Browser-supplied names never become filesystem paths.

Playwright capture allows animations and retains the caret. It may use internal helper scripts; Dyno never uses its driver to perform test actions or assertions. Capture is a rendered frame during the request, not a freeze of asynchronous app work. Use Interactor to converge on the state you want first.

## Real Vizzly integration

```sh
npm run test:vizzly
# or inspect/rerun in a visible browser:
npm run test:vizzly -- --ui
```

The adapter in `examples/vizzly` points to the sibling Vizzly checkout; set `VIZZLY_ROOT` to use another location. It uses Vizzly's existing built `dist` assets, real E2E Koa server, migrations, seeds, and fixture factories. Rebuild the app separately when changing its frontend source.

Each command creates dedicated PostgreSQL and Redis containers with random published localhost ports, seeds a test account and organization, runs the app on port 3017, and serves the gateway on 7359. Cleanup removes only that command's containers and volumes. It does not reset shared development/test databases or edit the Vizzly checkout.

The high-level browser tests:

1. Fill the real login form, authenticate through the real API/database, and reach the organization's empty project dashboard.
2. Switch between login and registration while retaining the requested destination.

Both pass in real Chrome using native Interactor.js typing, click, and assertion APIs. Docker startup, migrations, and seeding are separate from browser execution; these checks establish integration correctness, not a speed comparison.

## Verification and current limits

`npm test` runs Node checks for pure HTML/header transformations and integration checks through the actual CLI, HTTP gateway, app process, WebSocket connection, and Chrome. Checks cover installation and init, configuration errors, hooks, sessions and explicit resets, CSP, error attribution, source maps, navigation, fresh realms, timeouts, server ownership and crashes, rebuilds, concurrent captures, rejected reports, and signal cleanup. Small pure-function checks verify that configuration, suite definitions, and run transitions preserve earlier snapshots. No internal framework modules are mocked.

The first release targets modern browser APIs and ES2022 syntax. Managed launchers cover Chrome, Chromium, Edge, and Firefox, with a headed Safari URL handoff on macOS. See [browser setup](browsers.md) for verified builds and platform limits. A historical WebOS browser is not yet a supported compatibility target.

Interactions use browser DOM methods and synthetic events. They do not prove physical pointer hit-testing or support every API requiring trusted input/user activation. Closed shadow roots, native dialogs, downloads, video, full-page captures, visual baselines, parallel scheduling, automatic file watching, and HTTPS gateway serving are outside this first version. Secure cookies and secure-context-only app features require an appropriate origin and may not work through this HTTP gateway.

Same-origin frames are trusted code sharing an origin, not a security sandbox. A synchronous infinite loop may freeze all three frames; the Node run deadline can report failure and terminate a launched browser, but cannot recover a manually captured browser's event loop.

Suite definitions, normalized configuration, and run results are immutable snapshots. Process handles, sockets, and DOM nodes stay at the boundaries; cleanup runs once, in reverse order, and continues after a failure.

The framework lives in `bin/` and `src/`. Original spike artifacts are kept separately from this repo.

## CLI and server behavior

`--json` writes one JSON event per line on stdout, including startup errors and stop events. App logs go to stderr. Setup modules should also log to stderr to preserve that contract. `dyno --help`, `dyno --version`, and `dyno browsers` work without a config. Unknown options, conflicting modes, config typos, and invalid deadlines fail before project setup.

A server that returns an HTTP response already owns its port, including when its root returns 404 or 401. Dyno only reuses it with `reuseExistingServer: true`. Owned servers must log after listening; use `webServer.ready` to match that message. A quiet server or a message printed before listening needs a ready log from its startup wrapper. Startup failures include the URL, deadline, and recent output. No fixed readiness sleeps are used.

The gateway accepts only paths on the configured app origin, rejects unknown Host headers and foreign websocket origins, and supports gzip, deflate, and Brotli HTML within a 10 MB decoded limit. It preserves app CSP. Reporter events and commands have a 1 MB body limit; observer snapshots allow 8 MB. Request and operation deadlines are bounded. Up to 20 active browser runs can coexist; new captures fail clearly at capacity, and only finished runs are removed. Browser page departure reports an interrupted run when the browser can still send it.

When a browser omits async assertion frames, errors include the test's source-mapped declaration location. Process cleanup runs once and stops owned descendants as well as the initial command. Reused app servers and Safari's existing session remain user-owned.
