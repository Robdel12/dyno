# API reference

Tests run in the browser. Configuration and project setup run in Node. Start with the [guide](guide.md#add-it-to-an-app); use this page to look up the public API. [Type declarations](../types/index.d.ts) include arguments and return values.

## Tests and hooks

Import these from `dyno`:

| API | Use |
| --- | --- |
| `describe(name, define)` | Group tests and hooks. Definitions are synchronous; suites can nest. |
| `test(name, run, options?)` | Run one browser workflow. Options: `timeout`, `resources`. |
| `beforeEach(run)` | Prepare each test in this suite and its descendants. |
| `afterEach(run)` | Clean up an entered suite, including after failure. Inner suites clean up first. |
| `describe.only`, `test.only` | Focus local work. `forbidOnly` rejects these in CI by default. |
| `describe.skip`, `test.skip` | Report skipped cases. For a reason: `test.skip('later', undefined, { reason: '...' })`. |

Every test and hook belongs inside a named `describe`. Callbacks receive:

| Value | Use |
| --- | --- |
| `app` | Navigate, request data, capture images and access the app window. |
| `I` | Interactor rooted in the app's current document. |
| `fixtures` | JSON-safe values supplied by Node setup. These are browser-visible. |
| `signal` | Cancellation for this test or hook. Cleanup gets a fresh signal and budget. |
| `test` | Current test descriptor: stable ID, file, suite path, name and resources. |
| `step(name, work)` | Record named work in timings; return its value or preserve its error. Await it. |

See [suite behavior and selection](guide.md#suites-and-selection).

## Interactors

Interactor.js owns actions, selectors, convergence and assertions. Dyno exports `Interactor` and `defineInteractor` from `dyno`.

| API | Use |
| --- | --- |
| `I.find(selector)` | Find content and assert, for example `.text('Saved')`, `.visible()` or `.not.rendered()`. |
| `I.scope(selector)` | Bind an independent root. It resolves again after navigation. |
| `I.assert(predicate, message?)` | Converge on a custom assertion. Return a boolean or throw on failure. |
| `I.find('Name').then.fill(value)` | Replace an input or textarea value and send its events. |
| `I.find('Photo').then.upload(...files)` | Select files described by `{ name, bytes, type? }`; no files clears the input. |
| `I.nativePress(key)` | Send a real key to the focused app element. |
| `I.nativeMove({ x, y })` | Move the native pointer in viewport coordinates. |
| `I.find('Menu').then.nativeHover(options?)` | Move the native pointer over that element. |
| `defineInteractor({ actions, assertions })` | Define a reusable component. Bind it with `ContactForm(I, selector)`. |

Export custom definitions from your app's test support or beside its components. Bind them inside each test; share definitions, not bound instances. Compose child components with async actions and explicit awaits. See [custom interactors](guide.md#custom-interactors).

`rendered()` includes displayed content below the fold. `visible()` requires viewport visibility. Ordinary actions use DOM methods and synthetic events; [native input](guide.md#native-browser-behavior) requires a managed browser.

## App

| API | Result |
| --- | --- |
| `app.goto(path)` | Wait for the app's document and bridge. Use Interactor to wait for rendered content. |
| `app.request(path, fetchOptions?)` | Same-origin request with the browser session; returns a standard `Response`. |
| `app.setViewport({ width, height })` | Resize the actual managed viewport; returns the resulting size. |
| `app.screenshot(name, options?)` | Save a PNG and return attachment metadata. Required capture fails when unavailable. |
| `app.pause(message?)` | Inspect with `--ui` or `--manual`; Continue resumes the execution budget. |
| `app.document`, `app.window` | Access the app's current browser objects. Resolve elements after navigation. |
| `app.native` | Explicit managed capabilities, listed below. |

[Screenshot options](guide.md#screenshots): `fullPage`, `element`, `mask`, `maskColor`, `animations`, `caret`, `optional`. Element capture cannot combine `fullPage` or `mask`. Await captures and resizing before a test or hook finishes.

Manual runs use the existing viewport and cannot capture screenshots. `optional: true` reports a skipped image when capture is unavailable; provider and storage failures still fail.

## Managed capabilities

Read `app.native.capabilities` before a workflow that needs browser-specific support. Required operations fail when unavailable; there is no synthetic fallback.

| API | Use |
| --- | --- |
| `press(key)`, `move(point)`, `hover(element, options?)` | Native input; prefer the Interactor methods above for DOM targets. |
| `grantPermissions(names)` | Grant supported permissions for this execution. |
| `enableVirtualAuthenticator()`, `disableVirtualAuthenticator()` | Manage a Chromium virtual authenticator. |
| `setOffline(boolean)` | Change Chromium app network availability. |
| `setReducedMotion('reduce' \| 'no-preference')` | Change the browser's motion preference. |
| `withDialog({ action, message?, text? }, work)` | Accept or dismiss a real dialog while running and awaiting `work`. |
| `consoleMessages()` | Read recent native browser console messages. |

These methods are on `app.native`. Permissions, authenticators, offline state and media preferences reset between tests. See [browser support and limits](browsers.md).

## Configuration and Node setup

Import `defineConfig` from `dyno/config` for typed configuration. A plain default-exported object also works. See the [configuration table](guide.md#configuration) for defaults.

A `setup` module exports `async ({ config, signal }) => project`. Its result can contain:

| Field | Use |
| --- | --- |
| `webServer` | Override the app command, URL or environment. |
| `env` | Add environment values for the app process. |
| `fixtures` | Supply JSON-safe browser data, such as test account IDs and fixture URLs. |
| `drain(context)` | Join work started by an execution before its resources can be reused. |
| `teardown()` | Release resources acquired by this setup. |
| `createWorker({ worker, config, signal })` | Return private worker resources; required for multiple workers. |

Worker results accept `webServer`, `env`, `fixtures`, `drain` and `teardown`. A drain receives `{ runId, executionId, workerId, test, signal }`. Hooks, draining and final teardown have distinct jobs; see [Node setup](guide.md#node-setup) and [concurrent runs](guide.md#concurrent-runs).

Factories, sessions, databases, queues, external HTTP fixtures and visual baseline publication stay in your project. Dyno owns execution, resource reservations, reporting and browser capabilities. Browser tests use `app.request` to call project-owned test endpoints; there is no built-in Node task API.

## Commands and output

`dyno`, `dyno init`, `dyno doctor`, `dyno install`, `dyno browsers`. Use `dyno --help` and `dyno run --help` for flags. [Running and inspecting](guide.md#run-and-inspect) covers selection and debugging; [saved reports](guide.md#saved-reports) covers JSON, JUnit, HTML and images; [timings](guide.md#find-slow-work) covers named steps and run/session clocks.

See [current limits](guide.md#current-limits) before adopting a browser-specific workflow.
