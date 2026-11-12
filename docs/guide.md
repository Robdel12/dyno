<!-- Generated from source JSDoc. Run npm --prefix site run generate -- --write-markdown. -->
# Using Dyno

Write a test the way you'd use your app: open a page, fill in a field, and check what changed. Dyno runs that JavaScript in the browser, with Interactor handling DOM interaction and waiting for the UI.

You get the browser APIs you already know and its devtools for debugging. The CLI starts your app, opens a browser, and reports the results.

## Write your first test

Start with a workflow you care about. We'll use saving a contact here; swap in your app's route, labels and expected result.

### Install Dyno

You'll need Node 24+. Install from GitHub for now, then download Chromium once:

```sh
npm install --save-dev github:Robdel12/dyno
npx dyno init
npx dyno install
```

`init` adds a config and an example test without overwriting existing files. Commit your lockfile so local runs and CI use the same Dyno revision.

### Point it at your app

In `dyno.config.js`, set the command that starts your app and the URL it serves:

```js
export default {
  testDir: 'tests/browser',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  },
};
```

Dyno starts that command for you. Locally, `reuseExistingServer` lets you use an app that's already running; Dyno leaves that server alone when it stops.

### Test the result

Replace the example test in `tests/browser`:

```js
import { describe, test } from 'dyno';

describe('Contacts', () => {
  test('saves a contact', async ({ app, I }) => {
    await app.goto('/contacts/new');
    await I.find('Name').then.fill('Robert');
    await I.click('Save');
    await I.find('$([role=status])').text('Contact saved');
  });
});
```

Interactor waits for the expected UI. Await each action and assertion, and keep tests inside a named `describe`.

### Run it

```sh
npx dyno doctor
npx dyno --ui
```

`doctor` checks your config, test bundle and browser setup. `--ui` runs the test with the app visible. Use `npx dyno` for a headless run.

Next, [learn the interaction basics](guide.md#interact-with-the-app) or [share workflows with custom interactors](guide.md#custom-interactors). JavaScript, JSX, TypeScript and TSX work; run your own type checker for TypeScript.

## Interact with the app

Your test gets two things you'll use constantly: `app` to navigate and make requests, and `I` to interact with the UI. `I` is [Interactor.js](https://github.com/wwilsman/interactor.js), rooted in your app's current document.

```js
await app.goto('/contacts/new');
await I.find('Name').then.fill('Robert');
await I.click('Save');
await I.find('$([role=status])').text('Contact saved');
```

`app.goto` waits for the document. The last assertion waits for the result you care about. You don't need a sleep between those steps.

### Find what someone would use

Strings match text, placeholders and related label controls. They match the whole text; use a regular expression for a partial match. Use `$(...)` when you need CSS:

```js
await I.find('Email').then.fill('rob@example.com');
await I.find(/Contact saved/).rendered();
await I.find('$(input[name=email])').value('rob@example.com');
```

`rendered()` checks displayed content, including below the fold. `visible()` also requires it to be in the viewport. Assertions retry until they match, then continue immediately. `expectTimeout` sets the assertion deadline.

For changing browser state, use an assertion callback:

```js
await I.assert(
  () => app.window.location.pathname === '/dashboard',
  'Expected the dashboard URL'
);
```

### Work within a component

Use `scope()` to narrow the root. It finds that root again after navigation, so you can reuse the scope within a test:

```js
let contact = I.scope('$(form)');
await contact.find('Email').then.fill('rob@example.com');
```

A missing root fails. Create scopes before chaining; use `I.scope(selector)` rather than `I.find(selector).then.scope()`.

`fill()` replaces an editable input or textarea value and sends input/change events. To select a file:

```js
await contact.find('Photo').then.upload({
  name: 'note.txt',
  bytes: 'Storm notes',
  type: 'text/plain',
});
```

Pass no files to clear the input. Use [custom interactors](guide.md#custom-interactors) when these actions form a workflow you'll share.

### Check the right thing

Built-in assertions cover text, values, visibility and more. `contains(selector)` checks for a descendant, not a text substring. For a DOM predicate, bind a scope:

```js
await I.scope('$([role=status])').assert(
  ({ $ }) => $.textContent.includes('Saved')
);
```

Ordinary actions use DOM methods and synthetic events. For browser defaults such as Tab order or CSS hover, use [native browser behavior](guide.md#native-browser-actions).

## Suites and selection

Give each group of workflows a name with `describe`. Keep its setup and cleanup there too:

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

Every test and hook belongs inside a `describe`. You can nest suites or have several at the top level. Suite definitions are synchronous; put async work in hooks or tests.

### Set up and clean up

`beforeEach` runs from the outer suite inward. `afterEach` runs from the inner suite outward, including after failure for suites the test entered. Cleanup gets fresh APIs and its own budget, so one failed assertion doesn't use up the cleanup time.

Each test starts with fresh app and test documents. Cookies, browser storage, service workers and backend records persist. Reset those through your app's fixtures and hooks; use Node teardown for resources that outlive a test. [Configuration](guide.md#configure-your-project) covers that setup.

### Run just what you're editing

```sh
dyno --suite Authentication
dyno --file login.test.js
dyno --test 'Authentication › opens registration'
dyno --id '<ID from test discovery/results>'
```

File, suite and ID flags can repeat. Different kinds narrow the selection together. If a short test name is ambiguous, Dyno tells you how to pick one.

Use `test.only` or `describe.only` for local focus. CI rejects them by default. `test.skip('later')` and `describe.skip` report skipped tests without running their hooks or bodies.

Names must be unique within a suite. Stable IDs use the file, suite path and test name, so adding or reordering other tests doesn't change them. The reporter uses those IDs for reruns.

## Custom interactors

Once a few tests use the same form or component, give that workflow a name. Keep the definition with your app's test support—or beside the component—so tests can import it.

```js
// tests/interactors/login.js
import { defineInteractor } from 'dyno';

export let LoginForm = defineInteractor({
  actions: {
    async enterCredentials({ email, password }) {
      await this.find('Email').then.fill(email);
      await this.find('Password').then.fill(password);
    },
    async signIn(user) {
      await this.enterCredentials(user);
      await this.click('"Log in" $(button)');
    },
  },
  assertions: {
    hasError: message => ({ root }) =>
      root().querySelector('[role=alert]')?.innerText === message,
  },
});
```

Bind it to the test's `I` when you use it:

```js
import { LoginForm } from './interactors/login.js';

let login = LoginForm(I, '$(form)');
await step('Sign in', () => login.signIn(user));
await login.assert.hasError('Check your password');
```

Share definitions, not bound instances. Each binding gets the test's scope, assertion settings and cancellation signal. It follows the app after navigation without caching elements or changing other interactors.

### Compose smaller components

A custom interactor can bind inside another one. With your own `Post`, `Composer` and selector:

```js
let reply = Composer(Post(I, postSelector(words)), '$([aria-label="Reply"])');
await reply.write('I remember this storm.');
```

Use async actions and await each operation. Interactor's generator actions and `.then` chains work too, and `scope()` keeps your custom methods.

Assertions receive `$` for the current subject and `root()` for the component root. Return a boolean, including `false` when content is missing. Interactor treats `undefined` as success for callbacks that throw on failure. Custom assertions support `.not` and failure-message objects.

Keep navigation, fixture requests, screenshots and named steps in the surrounding workflow. TypeScript infers custom method arguments; use `InteractorContext` when annotating assertion callbacks.

## Configure your project

Start with your app's command and URL. Paths are relative to `dyno.config.js`.

```js
import { defineConfig } from 'dyno/config';

export default defineConfig({
  testDir: 'tests/browser',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
  },
});
```

Dyno gives each test 10 seconds, including hooks and document startup. Interactor assertions get up to 2 seconds. Change `timeout` or `expectTimeout` when the workflow needs it; use [timings](guide.md#understand-where-time-goes) to find out why.

<details>
<summary>All options and defaults</summary>

| Option | Default | Purpose |
| --- | --- | --- |
| `testDir` | `tests/browser` | Test directory |
| `testMatch` | `**/*.test.{js,jsx,ts,tsx}` | File pattern |
| `timeout` | `10000` | Test deadline, including runtime startup and hooks |
| `cleanupTimeout` | `5000` | Total budget for cleanup after execution ends |
| `expectTimeout` | `min(2000, timeout / 2)`, rounded down | Interactor assertion timeout |
| `runTimeout` | `60000` | Headless browser opening and results deadline, after app readiness |
| `host`, `port` | `127.0.0.1`, `7357` | Gateway address; port 0 chooses a free port |
| `browser.name`, `path`, `args` | `chromium`, Playwright build, `[]` | Managed target, optional executable, and launch arguments |
| `browser.deviceScaleFactor` | `1` | Playwright pixel ratio from 1 to 3 |
| `browser.isMobile`, `browser.hasTouch` | `false` | Emulate mobile viewport behavior and touch input |
| `browser.userAgent` | Browser default | Override the managed browser user agent |
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
| `seed`, `random` | None, `false` | Repeatable randomized priority or a generated seed |
| `workers` | `1` | Managed worker count, from 1 to 32; concurrent runs need project worker setup |
| `forbidOnly` | Whether `CI` is set | Reject focused test/suite definitions |

</details>

### Set up real app data

Point `setup` at a Node module. Its async default export receives `{ config, session, signal, onCleanup }` and returns the resources your tests need:

```js
import { startTestProject } from './support/project.js';

export default async function setup({ session, signal, onCleanup }) {
  return startTestProject({ session, signal, onCleanup });
}
```

`startTestProject` is your helper. Return `webServer` overrides, app `env`, JSON-safe `fixtures` for tests, and a `teardown` function. Keep credentials out of browser fixtures. Register owned releases with `onCleanup` as resources are acquired. They run even if setup throws before returning. Setup messages go to stderr.

Use project factories to create committed records and real sessions. Return the IDs and paths a scenario needs, then exercise the behavior through the app. Share immutable fixture inputs rather than mutable records. For concurrent runs, [give each worker its own resources](guide.md#concurrent-runs).

Use [named app fixtures](guide.md#named-app-fixtures) to call your real factories through `app.fixture`. Keep that test control outside production entrypoints. Operations receive explicit app dependencies; Dyno handles execution ownership and transport, while your app owns factories, auth, queues and visual comparison.

### Finish work before reusing resources

A fresh page doesn't stop server writes, background jobs, or service workers. Return `drain` when your project needs to join that work between tests. Close admission for the old scenario, release any held requests, and leave its resources ready for reuse.

Between tests Dyno retires the old document, then calls `drain({ runId, executionId, workerId, test, signal })`. It runs once per non-skipped execution, including the last one before results are saved. The final successful document can remain for inspection, so its backend admission still needs to close during drain. Its duration appears in session timings.

Keep draining within `cleanupTimeout` and honor its signal. A failure ends the session and saves accepted results; remaining tests stay unassigned. Callbacks must honor cancellation. Dyno retains their original promises until settlement before resource destruction; uncooperative Node work can delay shutdown. Make teardown safe after a drain failure.

Setup owns CLI-session resources, worker setup owns private resources, and optional `beforeExecution` resets or binds each scenario before browser hooks. Preparation uses the selected test timeout, leaving the remaining budget for browser work. Timings distinguish preparation from execution cleanup. For a multi-process app, use one project command to start the real stack and handle shutdown.

## Connect your app server

Give Dyno the command you already use to start your app and its URL. Your server still handles routes, assets, API calls, and hot reload.

```js
webServer: {
  command: 'npm run dev',
  url: 'http://127.0.0.1:3000',
  ready: 'Listening on',
  reuseExistingServer: !process.env.CI,
}
```

The server must log after it starts listening. `ready` can be a string or RegExp matching that message. Output triggers an HTTP HEAD check; any response, including a 401 or 404, confirms the server is up. There's no fixed startup sleep.

### Start and stop

Dyno reuses a responding server only with `reuseExistingServer: true` and leaves it running afterward. Otherwise, it starts `command` in `cwd` with `env`. Use a shell string or an argv array such as `['node', 'server.js']`.

When a run ends or fails, Dyno stops the processes it started, including descendants. A bounded grace period comes before forceful termination. Reused servers and manually opened browsers remain yours.

### How the app reaches the browser

The browser loads Dyno's gateway, which forwards app requests and WebSockets to `webServer.url`. The app fills the main window. Tests load in a companion window and read the app's DOM directly; a small injected script reports readiness and errors and hosts the reporter iframe. Your app needs no test imports.

Redirects to the app are rewritten to the gateway origin. Dyno translates same-origin Origin/Referer headers and matching cookie domains, preserving cookie security attributes. External redirects stay external.

The app receives `DYNO_URL`, the gateway origin. Use it as your public URL for OAuth or WebAuthn: browser credentials contain that origin, while the upstream receives its own Host. Root-relative URLs work best.

### If the app blocks the runner

Dyno preserves CSP and isolation headers and uses an existing script nonce when available. Give your app an explicit test configuration if it blocks injection, the reporter iframe, or same-origin window access. Changing isolation policy or navigating cross-origin can disconnect the companion and is unsupported.

The gateway accepts UTF-8 HTML, including gzip, deflate, and Brotli, up to 10 MB decoded. See [current limits](guide.md#current-limits) for origin and browser requirements.

## Named app fixtures

Browser tests can ask the real app process to seed committed records or perform small test operations.
Import the Node helpers from `dyno/fixtures`; keep factories and database connections in your app.

```js
import { defineFixtureOperations, createFixtureController, createFixtureHttpHandler } from 'dyno/fixtures';

let controller = createFixtureController({
  workerId,
  context: { db, factories },
  operations: defineFixtureOperations({
    'seed.user': ({ factories }, input, { signal }) => factories.createUser(input, { signal }),
  }),
  pause: () => appRequests.pause(),
  reset: ({ db }, { signal }) => resetDatabase(db, { signal }),
  drain: (_context, { signal }) => stopAndJoinAppJobs({ signal }),
});
let handleFixtures = createFixtureHttpHandler(controller, { token: privateControlToken });
```

Call `handleFixtures(request, response)` before delegating to your ordinary Node app handler.
It returns whether it handled the request. Keep control reachable outside the app runtime being paused.
An app with parsed endpoints can call `controller.dispatch()` directly; it needs no HTTP adapter.

Connect the worker's lifecycle callbacks in Node setup:

```js
import { connectFixtureControl } from 'dyno/fixtures';

let control = connectFixtureControl({ url: appOrigin, workerId, token: privateControlToken });
return {
  beforeExecution: control.begin,
  drain: control.drain,
  teardown: () => stopOwnedAppResources(),
};
```

Register `controller.close()` before releasing its app dependencies. A reset requires `pause()` to
synchronously return an admission hold with `idle({ signal })` and `resume()`. Construction acquires
that initial hold. Begin waits for idle, resets exclusively, then resumes. Resume commits preparation;
if the caller loses the response after that point, the worker is open and can still be drained by
execution identity. Drain closes admission and starts your app drain before waiting, so it can stop
producers or end streams. Keep the hold until
the next successful preparation. Failed or canceled reset/drain never reopens the worker.

Tests call `await app.fixture('seed.user', { email: 'alice@example.test' })`, then exercise the real app
through navigation and Interactor. Omitted input means null. Operations return JSON; reset may return
a JSON record of execution fixture values or undefined. Drain returns no browser data.

The default routes are POST `/__dyno_fixtures__/begin`, `/call` and `/drain`. Set the same base `path` on handler and control client to change them. Control uses a private
token; browser calls receive only their execution capability and same-origin call path. Calls never
retry or follow redirects. Keep tokens and returned records out of your own logs.

Input is limited to 64 KiB, result envelopes to 1 MiB, and JSON depth to 64. Values must be ordinary
JSON: no undefined properties, functions, dates, custom serializers, sparse arrays or cycles.
Callback errors have fixed public messages with their original cause available only in Node.

Aborting HTTP cannot undo committed writes or queued work. Operations must honor their signal;
the controller retains their actual promises until settlement. Your app still owns jobs, service
workers, database reset and shutdown. A delayed ordinary app request has no fixture execution
envelope, so stopping its source remains app policy. Close is terminal; it uses its own cleanup
signal and never resumes admission.

## Run and inspect

Run the whole suite headlessly, or keep the browser open while you work:

```sh
dyno                    # run and exit
dyno --ui               # inspect the app and results
dyno --ui --watch        # rerun when tests or helpers change
```

Dyno starts the app and stops the processes it owns when you finish. `--ui` keeps the session open for reruns; press Ctrl-C to stop it.

### Open the reporter

Press **Ctrl+Shift+D** in the app. Dyno finishes the current test, then opens the reporter over it. The app keeps its full viewport underneath.

Start with the file/suite overview, then open a test's **Output**, **Timings** or **Application** view. You can rerun a test, suite, file or failed selection. Search and filters stay in the URL.

Turn on **Pause on failure** in Run options to inspect a failing app. Continue hides the reporter before the next test. Stop cancels the run and starts cleanup. Pausing leaves app timers and requests running.

The CLI also prints a separate reporter URL. Open it in another tab if you'd rather keep the app uncovered. A completed interactive run keeps each worker's last app available; rerun an earlier test to inspect it again.

### Bring your own browser

```sh
dyno --manual --host 0.0.0.0
```

Open the printed URL and click **Start tests** if the popup was blocked. Keep both the app and companion windows open. Closing or reloading the companion interrupts the run; start a new one afterward.

See [browser setup](browsers.md) for manual-mode limits. Use [editing and debugging](guide.md#editing-and-debugging) for watch mode and in-test pauses, or `dyno --help` for selection and other options.

### Use the output in CI

`dyno --json` writes one JSON event per stdout line. Config, setup, teardown and app logs go to stderr. Use the process exit code as the outcome: `0` passes, `1` fails, `130` means SIGINT, and `143` means SIGTERM. Cleanup failure exits `1`, including after interruption.

[Saved reports](guide.md#saved-reports) give you portable HTML, JSON, JUnit and images after the session stops.

## Editing and debugging

Keep the app and browser running while you change tests:

```sh
dyno --ui --watch
```

Edits to tests or imported helpers queue a rebuild. If a run is active, Dyno waits for it before running the latest code. A build error leaves the previous results available; fix the file to run again.

Your app keeps its own hot reload. Restart Dyno after changing config or Node setup.

### Stop where the problem is

```js
await app.pause('Inspect this contact');
```

Use this in a test or setup hook with `--ui` or `--manual`. It opens the reporter immediately and suspends the test deadline. Continue hides the reporter and resumes the remaining budget.

The app's timers and requests keep running. Cleanup cannot pause, and headless runs reject the call. For failures anywhere in a suite, use **Pause on failure** in the reporter.

### Check the setup first

Run `dyno doctor` to check config, bundling, browser prerequisites and the app URL without launching anything. Add `--ui` or `--manual` to check that mode. The actual run still needs to start the server successfully.

### Type-check your tests

Dyno transpiles TypeScript without checking it. Run your project's `tsc --noEmit`, using `moduleResolution: "Bundler"` for browser tests; Interactor's declarations don't currently support strict NodeNext checking. JavaScript editors use the same included types.

To type values from Node setup, extend `Fixtures` in your project:

```ts
import 'dyno';

declare module 'dyno' {
  interface Fixtures { contactId: string }
}
```

Config types work independently of the browser declarations.

## Saved reports

The CLI prints an HTML report path after each browser run. Open `index.html` directly after Dyno stops to search tests, read failures and source excerpts, inspect console output and timings, and view screenshots.

Reports live in `.dyno/reports/<run-id>/`. Change that with `reportDir` or `--report-dir path`. Copy the whole folder to share a report; its images live in `images/`. Old reports stay until you remove them.

### Use reports in CI

Each folder includes `run.json`, `junit.xml`, `schedule.json`, and `session.json`. JSON output emits a `report-saved` event. `run.json` uses `schemaVersion: 1`, stable test descriptors, outcomes, summary counts, and relative image paths.

Runs are `completed` or `interrupted`; tests without accepted results are `not-run`. Failures retain their phase and source context. JUnit adds an error case for interruption, so an unfinished run can't look green.

Dyno saves results before reporting completion, including accepted outcomes on signals, browser loss, and app failure. A force kill or machine failure can't flush results. Storage errors fail the CLI, and partially written folders aren't published as reports. A source image removed before saving appears as **Screenshot unavailable**.

Reports contain test output and source excerpts. Dyno doesn't save config, fixtures, connection keys, or launch tokens in them.

## Understand where time goes

Open **Slowest tests** in the reporter, then a test's **Timings** tab. Dyno always records document startup, hooks, the test body, queued errors, and operations such as navigation, requests, screenshots, and native calls.

Give meaningful workflows a name with `step()`:

```js
describe('Contacts', () => {
  test('saves a contact', async ({ app, I, step }) => {
    await app.goto('/contacts/new');
    await step('Save contact', async () => {
      await I.find('Name').then.fill('Robert');
      await I.click('Save');
      await I.find('$([role=status])').text('Contact saved');
    });
  });
});
```

Use steps in hooks too. Await them before finishing; they return the callback's value and preserve its error. Custom Interactor actions stay inside the enclosing test or hook unless you add a named step.

### Read the numbers

Durations include waiting, not just CPU work. Nested steps include their children and parallel operations overlap, so don't add all rows together. Debug pauses are included and marked. Requests end when headers arrive; body reading belongs to the surrounding step.

Check `session.json` when browser tests are fast but the command is slow. It separates config, bundling, project setup, server readiness, browser startup/results, and cleanup. Cleanup includes report saving and stopping the app and browser.

```sh
jq '.performance.slowestTests' .dyno/reports/<run-id>/run.json
jq '.timings.entries | sort_by(-.duration)' .dyno/reports/<run-id>/session.json
```

### Use timings in tools and agents

JSON test events and saved results include `timings: { duration, entries, truncated }`. `performance.slowestTests` ranks up to five tests and their slowest work. Use these to compare runs or identify the next workflow to investigate.

<details>
<summary>Timing fields and clocks</summary>

Each entry has `id`, `kind`, `name`, `start`, `duration`, and `status` (`passed`, `failed`, or `cancelled`). Operations and steps include `phase`. Test numbers are milliseconds from that runtime's monotonic clock. Hook rows retain function names and execution order.

Single-worker summaries include `outsideTestsDuration` when run duration is available. It covers time outside accepted test runtimes, including frame startup, reporting, and between-test inspection. Concurrent summaries instead use `coordination`: coordinator wall time stays separate from summed browser work. Its clock starts at the first registered catalog and ends after terminal draining, before report persistence.

Worker timings show assigned execution, handoff after result acceptance, queue time for assigned requests, and remaining unassigned time. Handoff includes document retirement, project cleanup, and final completion waiting. `projectCleanupDuration` is already part of handoff; don't add it again. Unassigned time includes waiting after the last assignment.

Session timing uses its own clock and includes startup, report writing, and shutdown. It stays `running` until resources close, then is finalized atomically with a `session-timing` event. Watch and manual runs share one session across browser runs. The final report write itself is outside measured wall time. `browserCleanup.graceful` and the `browser-stopped` event show whether process cleanup was forced.

</details>

Each test keeps up to 500 entries; `truncated` counts omissions. A runtime that can't report has no timings, rather than invented zeros. Request labels omit queries, bodies, and headers. Keep secrets out of step and screenshot names: those appear in reports.

## Screenshots

Wait for the UI you care about, then capture it:

```js
await I.find('Dashboard').visible();
let image = await app.screenshot('dashboard', { fullPage: true });
```

Managed browsers capture the original app page with the reporter hidden. The default is a viewport image; `fullPage: true` captures the whole page without changing its configured viewport. Chromium briefly pauses app JavaScript during full-page and element captures so its temporary resize cannot reach app handlers. Queued callbacks resume afterward; CSS animation and backend work continue. The result includes `path`, `url`, dimensions, and pixel ratio. Images appear in live and [saved reports](guide.md#saved-reports).

### Choose what to capture

```js
await app.screenshot('dashboard', {
  mask: [...app.document.querySelectorAll('[data-private]')],
  maskColor: '#ff00ff',
  animations: 'disabled',
  caret: 'hide',
});

await app.screenshot('card', {
  element: await I.find('$(.card)'),
});
```

Masks cover current app elements in the PNG. `maskColor` takes an opaque `#RRGGBB` color. Element capture uses the element's document bounds, including content below the fold, without scrolling or resizing. Fractional edges round outward; element capture can't combine with `fullPage` or masks.

Animations and carets stay unchanged by default. With suppression enabled, finite animations finish, infinite animations pause, and temporary styles are removed afterward. Dyno waits for fonts and checks the document and dimensions, but other app work can continue. Use Interactor to choose the state first.

Always await captures and viewport changes. They run in order; navigation, Stop, resize, or lost ownership invalidates pending captures. Leaving operations unfinished fails the test or hook.

### Manual browsers

URL-only runs can't take screenshots. Required captures fail. Use `{ optional: true }` only when the functional test is useful without an image; Dyno returns and reports a skipped image. Provider and storage errors still fail.

Reported PNGs stay on disk after cleanup; interrupted runs discard unreported images. Capture metadata includes the browser/provider/version, viewport, and pixel ratio. Dyno saves attachments; your visual-comparison service owns baselines and diffs.

## Viewport sizing

Managed runs start at 1280 × 800 CSS pixels. Set `viewport` in config or change it during a test:

```js
await app.setViewport({ width: 390, height: 844 });
```

The next test restores its default size. These dimensions change desktop layout; they don't emulate touch input, a phone's OS, or its physical screen.

Manual runs use the actual window. A browser can't reliably resize its own tab, so a matching `app.setViewport` request succeeds and a different size fails. Fixed config dimensions must match too. Resize the window yourself or use a managed browser.

## Native browser actions

Interactor's `click`, `type`, `press`, and assertions run directly in the browser. Use `press` for app-defined keyboard handlers, such as chart arrows or search shortcuts. These don't need a driver.

Use a custom Interactor action with the element's `scrollBy` or `scrollTo` for scrolling. App scroll handlers and lazy loading still run in the real browser.

Use native input when you're testing browser defaults that synthetic events don't reproduce, such as Tab navigation or CSS hover.

```js
await I.find('Name').then.focus();
await I.nativePress('Tab');
await I.find('Notes').focused();
await I.find('Account menu').then.nativeHover();
await I.nativeMove({ x: 0, y: 0 });
```

These work with scopes and custom interactors. `nativePress` uses the focused element; it doesn't focus a selector for you. Hover scrolls to a visible point that receives pointer input. Stale or covered targets fail. After an action navigates, assert on the destination with Interactor.

Use `setColorScheme('dark' | 'light' | 'no-preference')` for system appearance. `blockExternalRequests()` blocks app-page HTTP requests outside the gateway origin and records up to 1,000 recent URLs; `blockedRequests()` returns them. It doesn't block WebSockets, service-worker traffic, or companion requests. Both settings reset between tests.

### Handle a dialog

```js
await app.native.withDialog({
  action: 'accept',
  message: 'Delete this note?',
}, async () => {
  await I.click('Delete');
});
```

The optional message must match exactly. You can also dismiss a dialog or supply prompt `text`. Await the scope, including when the callback navigates; it returns the callback's result.

### Choose supported features

`app.native.capabilities` tells you what this browser supports. Required calls fail when unavailable. Manual runs have no native capabilities; managed support varies by engine. See the [browser support table](browsers.md#native-capabilities).

Use `grantPermissions([...])`, `enableVirtualAuthenticator()`, `disableVirtualAuthenticator()`, `setOffline(boolean)`, or `setReducedMotion('reduce' | 'no-preference')` before or after navigation. State resets before the next test, including after failure. Failed cleanup ends the managed session, and each operation appears in timings.

Virtual authenticators and app offline require Chromium. Your app still performs real passkey registration and validation. Offline keeps companion HTTP connected, but Chromium can change its `navigator.onLine` too; this isn't fully isolated offline state.

### Read browser console messages

`app.native.consoleMessages()` returns up to 100 recent entries with increasing `id`, `type`, and `text` (up to 4,000 characters). Save the highest ID before a workflow to find newer messages. Browser-generated warnings are included; these entries aren't automatically copied to reports.

## Current limits

Dyno tests web UI. Keep platform UI tests for native iOS and macOS apps, and real-device checks for behavior a desktop viewport can't prove.

### Browser support

The runner needs ES2022 and modern APIs: `AbortSignal.timeout`, `AbortSignal.any`, `Promise.withResolvers`, `crypto.getRandomValues`, and `EventSource`. Older browsers, including historical WebOS builds, need compatibility work. Phones, iOS, and TVs still need verification of companion popups and background execution. See [browser setup](browsers.md#known-limits).

Ordinary Interactor actions use DOM methods and synthetic events. Use explicit native actions for browser defaults or trusted input. Closed shadow roots, downloads, video, visual baselines, and HTTPS gateway serving are outside this version.

### App origins and isolation

The gateway uses HTTP. Secure cookies and secure-context features may need a different test origin. HTML routes, including fixtures, need the app's opener and agent-cluster isolation headers; changing policy can disconnect the companion even on the same origin.

Avoid changing `window.name` during a run; Dyno uses it to keep the companion connected. Tests and app code have separate contexts but share an origin. This isn't a security sandbox. An infinite loop can freeze the browser; Node can stop a managed browser, but can't recover a manual browser's event loop.

### Run limits

The gateway rejects unknown Host headers and foreign WebSocket origins. Event and command requests have a 1 MB limit. Large observer views stream in bounded records; a slow reader may disconnect without losing accepted results or saved output.

Up to 20 browser runs can be active. Dyno drops finished runs as new ones join. If all 20 are still active, finish or close one before joining again.

## Concurrent runs

Start with one worker, the default. Once your app has isolated test resources, try `dyno --workers 4` and compare [run times](guide.md#understand-where-time-goes). More tabs don't make a shared database safe.

Dyno uses one managed browser with private worker contexts, gateways, and app resources. Tests keep their hooks and fresh documents; the reporter combines results in catalog order. Manual runs use one worker; explicitly combining `--manual --workers 4` fails.

### Give each worker its own resources

Return `createWorker` from Node setup:

```js
import { prepareBuild, startTestProject } from './support/project.js';

export default async function setup({ session, signal, onCleanup }) {
  let build = await prepareBuild({ session, signal, onCleanup });
  return {
    createWorker: ({ worker, signal, onCleanup }) =>
      startTestProject({ session, worker, build, signal, onCleanup }),
  };
}
```

These helpers belong to your project. `worker` has a string `id` and numeric `index`. Each call returns `{ webServer, env, fixtures, beforeExecution, drain, teardown }`, overriding setup defaults. Share immutable build output; keep databases, queues, files, and mutable app state private. A deliberately stateless app can share a server.

If setup starts the server, return its URL with `command: undefined` and `reuseExistingServer: true`. Worker teardown runs before shared setup teardown. Register each release with `onCleanup` before the next fallible step. Registration closes when the factory settles; callbacks run once in reverse order even after setup fails. Returned `teardown` joins that same cleanup stack. Do not register the same release twice. The frozen `session.id` is shared across workers and stays stable during watch reruns; combine it with worker identity when naming private backend resources. The same setup path works with one worker.

### Protect shared resources

Declare resources such as the OS clipboard before execution:

```js
test('copies a token', async ({ I }) => {
  await I.click('Copy token');
}, { resources: ['clipboard'] });
```

Dyno reserves the names together until document retirement and project draining finish. Other eligible tests continue. Global Pause stops new assignments at test boundaries; `app.pause()` holds only its worker. Stop or worker loss saves accepted outcomes and images, drains, and closes the run. Tests and workers aren't automatically retried.

### Randomize order

```sh
dyno --random
dyno --seed issue-184
```

The seed appears in CLI output, Run info, and saved reports. It preserves priority for the same test IDs, including when filtering. It doesn't control app randomness or asynchronous timing.

### Replay worker queues

```sh
dyno --replay .dyno/reports/<run-id>/schedule.json
```

`schedule.json` records assignments and completion order. Replay restores worker queues and count, not network or timer interleaving. The bundle fingerprint and catalog must match; an explicit `--workers` must match too. Selection flags, seeds, and `--watch` can't combine with replay.

A completed schedule replays its full selection. An interrupted one replays attempted tests, including the unfinished assignment, and reports omitted unassigned tests. Those tests never count as passed. App code outside the test bundle, backend data, and application randomness remain yours to control. The last app stays available until shutdown, which is recorded in `session.json`.

## Real app example: Vizzly

`examples/vizzly` runs login and navigation against the real app and database. You'll need a Vizzly checkout with built `dist` assets and Docker. Set `VIZZLY_ROOT` if it isn't the sibling `vizzly` directory.

Run `npm run test:vizzly`, or add `-- --ui` to inspect it. Setup creates private PostgreSQL and Redis containers, runs migrations and seeds, and provides a disposable account. The app uses port 3017; the gateway uses 7359. Cleanup removes only that run's containers and volumes.

This integration is optional. `npm test` uses a self-contained fixture app.
