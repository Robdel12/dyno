# Dyno

A small acceptance-test framework that runs your tests inside a real browser. Node starts your app, bundles the tests, serves a capture URL, and reports results. Queries, actions, and assertions execute locally in the browser.

This is a working first version with project configuration, managed app processes, Interactor.js interactions and assertions, disposable test contexts, source-mapped failures, and real Vizzly integration. It is not published to npm.

## Try it

Requires Node 24+ and Chrome/Chromium for the default launcher.

```sh
npm install
node bin/dyno.js --config examples/demo/dyno.config.js
```

That command starts the demo app, builds its tests, launches a disposable headless Chrome instance, prints results, and stops the processes it owns. Exit status is 0 for passing tests and 1 for failures.

Use a visible browser while writing tests:

```sh
node bin/dyno.js --config examples/demo/dyno.config.js --ui
```

The runner shows each result and its error stack, lets you rerun one test, and leaves the last completed app frame available to inspect. **Run again** rebuilds edited tests before starting another run. App hot reload belongs to the app's own development server; the gateway forwards WebSocket upgrades.

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

`init` writes a config and one example test without overwriting existing files. Update them for your application, then add `"test:browser": "dyno"` to your package scripts.

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
       ├─ /__dyno__/   capture UI, test bundle, reports
       └─ every other path    forwarded to the app server

Browser capture page
  └─ fresh test-runtime iframe per test
       └─ fresh app iframe per test
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

The runner owns only app navigation and lifecycle:

- `app.goto('/path')` waits for the app's early bridge and document readiness. Interactor assertions then wait for rendered UI.
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
| `browser.path`, `browser.args` | Installed Chrome | Explicit launcher executable and extra arguments |
| `webServer.url` | Required | App HTTP(S) origin, without a path |
| `webServer.command` | None | Command to start when the URL is unavailable |
| `webServer.cwd`, `env` | Config directory, inherited env | App process settings |
| `webServer.ready` | Any process output | Ready-message string or RegExp, followed by HTTP verification |
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

`CHROME_PATH` can select the launcher executable. `--manual` works without Chrome installed. The launcher only starts a browser process at the capture URL; test execution uses no browser automation protocol.

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

`npm test` runs Node checks for pure HTML/header transformations and integration checks through the actual CLI, HTTP gateway, app process, WebSocket connection, and Chrome. Checks cover pass/fail reporting, error attribution, source maps, cookies/origins, navigation, property-only changes, fresh realms, unresolved tests, server ownership, edited-test rebuilds, immutable run bundles, duplicate reports, and signal cleanup. No internal framework modules are mocked.

The first release targets modern browser APIs and ES2022 syntax. Automated launching and process-group cleanup are implemented for macOS/Linux Chrome/Chromium; other capable browsers can capture manually but have not been validated. A historical WebOS browser is not yet a supported compatibility target.

Interactions use browser DOM methods and synthetic events. They do not prove physical pointer hit-testing or support every API requiring trusted input/user activation. Closed shadow roots, native dialogs, downloads, screenshots/video, parallel scheduling, automatic file watching, and HTTPS gateway serving are outside this first version. Secure cookies and secure-context-only app features require an appropriate origin and may not work through this HTTP gateway.

Same-origin frames are trusted code sharing an origin, not a security sandbox. A synchronous infinite loop may freeze all three frames; the Node run deadline can report failure and terminate a launched browser, but cannot recover a manually captured browser's event loop.

The framework lives in `bin/` and `src/`. Original spike artifacts are kept separately from this repo.
