<!-- Generated from source JSDoc. Run npm --prefix site run generate -- --write-markdown. -->
# API reference

Write tests with browser APIs and set up app resources in Node. This reference covers arguments, return values, and browser support. Start with the [first test guide](guide.md#write-your-first-test) if you're setting up a project.

- `describe` and `test` organize your tests.
- `TestContext` has the values passed to tests and hooks.
- `Application` handles navigation, requests, screenshots, and browser access.
- `defineInteractor` creates reusable component actions and assertions.
- `Config` sets up your app server and test run.
- `ProjectSetup` prepares shared and private worker resources.

Signatures: [browser types](../types/index.d.ts), [configuration](../types/config.d.ts), [app-process fixtures](../types/fixtures.d.ts). See the [guide](guide.md) for examples.

## Tests and hooks

| API | Use |
| --- | --- |
| `TestContext.app` | Navigate, make session requests, capture images and inspect the current app window. |
| `TestContext.I` | Interactor rooted in the current app document. Bind custom interactors to this instance. |
| `TestContext.fixtures` | JSON-safe values returned by project setup. These are visible to browser code. |
| `TestContext.signal` | Cancellation for this test or hook. Cleanup receives a fresh signal and its own budget. |
| `TestContext.test` | The current test’s stable ID, file, suite path, name and declared resources. |
| `TestContext` | The values you receive in a test or hook. Use `app` for navigation and browser access, `I` for interaction, and `step` to name work in reports. |
| `TestContext.step` | Name meaningful work in the timing report. Await it; it returns the callback’s value and preserves its error. Use it in hooks too. Keep secrets out of step names. |
| `Fixtures` | Browser-visible JSON-safe values from project setup. Extend this interface in your app to type fixture IDs and paths. Never put production credentials in fixtures. |
| `test` | Run one user workflow in the browser. |
| `describe` | Group tests and hooks under a name. Suites can nest. Definitions must be synchronous; put asynchronous work in hooks or tests. `.only` focuses a suite and `.skip` reports its descendants as skipped. |
| `beforeEach` | Prepare each test in this suite and its descendants. Outer hooks run first. Register the hook inside its owning `describe`. |
| `afterEach` | Clean up each entered suite, including after failure. Inner hooks run first, with fresh APIs and a separate cleanup budget. Keep run-wide cleanup in Node setup teardown. |
| `TestFunction` | Declare, focus or skip a test. A skipped test can omit its callback and supply `{ reason: "Waiting for billing" }`. |
| `DescribeFunction` | Declare a named suite. Its definition runs once while Dyno registers the test file. |
| `TestCallback` | Tests and hooks receive the same browser context. Return or await all asynchronous work. |
| `TestOptions` | Override the test deadline in milliseconds, reserve named shared resources, or explain a skipped test. Resources stay reserved through document retirement and project draining. |
| `TestDescriptor` | A stable test ID, file, suite path, name, catalog index and declared resources. Reports and fixture cleanup receive this same descriptor. Reordering definitions does not change stable IDs. |

## Interactors

| API | Use |
| --- | --- |
| `Interactor` | An Interactor.js instance rooted in the app’s current document. Dyno adds app-aware events, independent scopes, file inputs and explicit native actions. Use the test’s `I` as your root. Actions are awaitable and support `.then` chaining. Interactor.js handles selectors, waiting for the UI, and assertions. |
| `Interactor.scope` | Bind an independent root that resolves again after navigation. Create scopes before chaining; a missing root fails instead of searching elsewhere. |
| `Interactor.fill` | Replace an editable input or textarea value and dispatch input/change events. Empty strings and numeric inputs work. Use upstream `type` when individual keystrokes matter. |
| `Interactor.upload` | Select files and dispatch input/change events. Pass no files to clear the selection. File bytes can come from a project fixture endpoint. |
| `Interactor.nativePress` | Send a real key to the focused app element when browser defaults matter, such as Tab navigation. Requires managed keyboard support. Use upstream `press` for app-defined keyboard handlers; it runs directly in the browser. |
| `Interactor.nativeMove` | Move the native pointer in app viewport coordinates. Useful for moving away from a hovered element. |
| `Interactor.nativeHover` | Move the native pointer over the resolved element. An optional position is relative to its bounding box in CSS pixels. |
| `defineInteractor` | Define reusable component actions and assertions. Keep definitions in your app’s test support or beside the component, then bind them to the test’s `I`. Share definitions, never bound instances. |
| `UploadFile` | A browser file input fixture. `bytes` accepts a string, Blob or other BlobPart; `name` is the filename and `type` is an optional MIME type. |
| `CustomInteractor` | The app-aware Interactor plus your named actions and assertions. Bind it inside each test so scopes and cancellation belong to that execution. |
| `InteractorContext` | Interactor.js’s action/assertion context, available to custom definitions. Keep DOM access inside the supplied context. |

## App and screenshots

| API | Use |
| --- | --- |
| `Application` | Navigate and inspect your app from a test. Tests have their own context and read the app DOM directly. Fresh documents don't reset browser storage or backend data. |
| `Application.goto` | Navigate to a same-origin app path and wait for its document bridge. Then use Interactor to wait for the UI you care about. |
| `Application.request` | Fetch options pass through, including `credentials: 'omit'` for API setup that should not change the browser session. Same-origin cookies are included by default. Dyno owns the cancellation signal. |
| `Application.setViewport` | Resize the actual managed viewport and wait for layout. Each dimension must be 1–16384 CSS pixels. Manual runs require the requested dimensions to already match. |
| `Application.screenshot` | Save an exact PNG of the app, excluding the reporter. Full-page and element captures are supported. Required capture fails when unavailable; explicitly optional capture can skip. |
| `Application.pause` | Open the reporter and suspend the execution deadline until Continue. Requires `--ui` or `--manual`. App timers and network work keep running; cleanup cannot pause. |
| `Application.document` | Read the current app document after navigation is ready. Resolve elements again after navigation. |
| `Application.window` | Read the current app window. Browser APIs are available directly; use Interactor assertions for changing state. |
| `Application.native` | Use managed browser features such as native input and permissions. Required operations fail when unsupported. |
| `Viewport` | App viewport dimensions in CSS pixels. Resizing changes the real viewport, so responsive layouts behave normally. |
| `BrowserIdentity` | The managed browser and provider recorded with a screenshot. This identifies the capture environment, not a simulated device. |
| `CapturedScreenshot` | Saved PNG metadata, including the file path, image dimensions, pixel ratio, viewport and capture policy. Use the path from Node to publish an image to your visual service. |
| `SkippedScreenshot` | An explicitly optional image that could not be captured. Read `reason`; storage or provider failures still fail the test. |
| `Screenshot` | A captured PNG or an explicitly skipped optional image. Check `status` before consuming the path. |
| `ScreenshotRenderingOptions` | Capture policy. Animations default to `allow`, caret to `initial`, and masks to opaque `#ff00ff`. Optional capture skips only when the capability is unavailable. |
| `ScreenshotOptions` | Choose a viewport, full-page or element capture. Element capture cannot combine with `fullPage` or `mask`. Masks use elements from the current app document. |
| `Application.fixture` | Call a named fixture in this worker's app process. Connect the fixture controller through `beforeExecution`; Dyno handles access, JSON limits, cancellation, and timing. Omitted input means `null`. Calls never retry or follow redirects, and cancellation can't undo committed writes. Await every call before the test or hook ends. |

## Managed capabilities

| API | Use |
| --- | --- |
| `NativeBrowser` | Managed operations for browser defaults that DOM events cannot reproduce. Use Interactor for ordinary clicks, fields and assertions. Permissions, authenticator, offline and motion settings reset between tests. |
| `NativeBrowser.capabilities` | Inspect support before a browser-specific workflow. Manual URL sessions expose unavailable capabilities. |
| `NativeBrowser.press` | Send a real key or chord. Prefer `I.nativePress` when composing Interactor workflows. |
| `NativeBrowser.move` | Move the real pointer to app viewport coordinates. |
| `NativeBrowser.hover` | Hover a connected element in the current document. Prefer `I.find(...).then.nativeHover()` for a DOM target. |
| `NativeBrowser.grantPermissions` | Grant supported permissions for this execution. Check the advertised permission names first. |
| `NativeBrowser.enableVirtualAuthenticator` | Create a Chromium virtual authenticator for a real WebAuthn workflow. |
| `NativeBrowser.disableVirtualAuthenticator` | Remove this execution’s virtual authenticator. |
| `NativeBrowser.setOffline` | Change Chromium app network availability. It does not change the controller connection. |
| `NativeBrowser.setReducedMotion` | Change the managed browser’s reduced-motion preference. |
| `NativeBrowser.consoleMessages` | Read recent browser console messages without evaluating objects in the app. |
| `NativeBrowser.withDialog` | Handle a dialog opened by the callback, then remove the handler. Optionally check its exact message or supply prompt `text`. Returns the callback result. |
| `NativeCapabilities` | Check support before a browser-specific workflow. Virtual authenticators and app offline require Chromium; clipboard permission support varies by engine. Manual URL runs have no native capabilities. |
| `NativePoint` | A point in CSS pixels. Pointer moves use viewport coordinates; hover positions use the element’s bounding box. |
| `NativeHoverOptions` | Optionally choose a point inside the target element. Without it, Dyno chooses a visible point that receives pointer input. |
| `NativeDialogOptions` | Accept or dismiss the next dialog opened by the callback. Optionally require a message and supply prompt text. |
| `NativeConsoleMessage` | A captured console entry with its sequence ID, type and text. |
| `NativeBrowser.setColorScheme` | Choose the app system color scheme: light, dark, or no-preference. Cleanup restores the original preference. |
| `NativeBrowser.blockExternalRequests` | Block app-page HTTP requests outside the gateway origin. Data and blob URLs remain available. Does not cover service workers or WebSockets; resets between tests. |
| `NativeBrowser.blockedRequests` | Read an immutable list of up to 1,000 recent URLs blocked by the external-request guard. |

## Timings

| API | Use |
| --- | --- |
| `TimingEntry` | One recorded interval, including time in nested steps. Numbers are milliseconds from the browser's monotonic clock. Nested and parallel intervals overlap, so don't add them together. |
| `Timings` | Execution duration and up to 500 recorded intervals. `truncated` counts omitted intervals. A runtime that could not report has no timings rather than invented zeros. |

## Configuration and Node setup

| API | Use |
| --- | --- |
| `defineConfig` | Get type hints for your Node config. Paths resolve relative to the config file. A plain default-exported object works too. |
| `Config` | Set your app server and test-run options. Start with the app URL and, if Dyno should start it, a command. The configuration guide lists defaults and setup examples. |
| `ProjectWorker.beforeExecution` | Prepare a test before its browser hooks start. Return optional JSON fixtures and a fixture connection without replacing static fixture keys. This runs once per assignment, even if its reply is replayed, and uses the test's timeout. Honor cancellation: Dyno waits for your callback before releasing resources. Failed or interrupted preparation requires a restart. Your app still owns database reset and background jobs. |
| `ProjectContext` | Your config, setup cancellation signal, immutable session ID, and `onCleanup` callback. |
| `ProjectContext.session` | The CLI session's stable random ID. It survives watch reruns and differs between simultaneous CLI invocations. |
| `ProjectContext.onCleanup` | Register cleanup as you acquire each resource. Callbacks run once in reverse order after app work stops, even if setup throws. Register before setup returns, and don't use its aborted signal for cleanup. |
| `ProjectWorkerContext` | Setup inputs plus this worker's immutable string ID and numeric index. Include the session ID in resource names to keep simultaneous runs separate. |
| `ProjectExecution` | The run, worker, and execution IDs, selected test, and cancellation signal. Preparation and cleanup get separate signals. |
| `FixtureTransport` | The same-origin fixture path and access token for one execution, created by the fixture control helper. Private control credentials stay in Node. |
| `ExecutionPreparation` | JSON data returned by beforeExecution. Fixtures extend static values without replacing keys; the optional transport binds app.fixture to this execution only. |
| `ProjectWorker.env` | Environment values added to this worker’s app process. |
| `ProjectWorker.fixtures` | JSON-safe IDs, paths and other values supplied to browser tests. |
| `ProjectWorker.webServer` | Override the app command, URL or readiness settings for this worker. |
| `ProjectWorker` | Private app resources for one worker: server overrides, environment, browser-visible fixtures, execution preparation, drain and cleanup. Share immutable build output; isolate mutable databases, queues, files and sessions. |
| `ProjectWorker.drain` | Stop new work from this test and wait for its backend work to finish after Dyno retires the document. The final app may stay open for inspection; drain its backend work anyway. Honor cancellation. A failure ends the run and saves accepted results, so teardown must still be safe. |
| `ProjectWorker.teardown` | Release resources acquired by this worker. Setup teardown runs once after all workers close. |
| `ProjectSetup` | The value returned by the Node setup module. One setup owns CLI-session resources; each worker owns its private app state. |
| `ProjectSetup.createWorker` | Create private resources for a worker. Required for concurrent managed runs; manual runs use one worker. Register releases with `onCleanup` as you go so a setup failure also cleans up. |

## App-process fixtures

| API | Use |
| --- | --- |
| `defineFixtureOperations` | Compose named app operations without changing their definitions. Duplicate names fail immediately. |
| `createFixtureController` | Control fixture access for one app worker. Operations receive `(context, input, execution)`; reset and drain receive `(context, execution)`. Execution has IDs and an abort signal. For reset support, the controller immediately pauses app requests when created. |
| `createFixtureHttpHandler` | Handle fixed POST begin/call/drain routes in an outer Node listener. Returns false outside its path. Keep this handler reachable while the app is paused; the control token never belongs in browser fixtures. |
| `connectFixtureControl` | Connect Node worker callbacks to the app's fixed fixture protocol. Calls never retry or follow redirects. `begin` returns execution fixtures and a same-origin browser binding; `drain` returns no browser data. |
| `JsonValue` | Plain JSON accepted by fixture operations: finite numbers, strings, booleans, null, dense arrays and plain records. Runtime validation rejects custom serializers and values JSON would silently drop. |
| `FixtureIdentity` | Run, worker and execution identity supplied by Dyno's coordinator. |
| `FixtureScope` | Execution identity plus its short-lived browser operation capability. Never reuse it across tests or log its token. |
| `FixtureExecution` | Explicit operation identity and cancellation signal. App dependencies arrive separately through the controller context. |
| `FixtureHold` | A pause on new app work. `idle` waits for accepted work to finish; `resume` releases this hold after reset. Resuming one hold must leave any other holds in place. |
| `FixtureOperation` | An app factory or helper with explicit dependencies, JSON input, and execution context. Return browser-safe JSON after committing writes; your app must still drain any background work. |
| `FixtureController` | Run named fixtures in the app process. Creating the controller can pause app requests; failed or cancelled preparation/drain leaves them paused. Close it before releasing app dependencies. |

## Code coverage

| API | Use |
| --- | --- |
| `CoverageConfig` | Coverage build inputs, original-source filters, report formats, and optional minimum percentages. Set enabled or pass --coverage to collect application coverage. A baseline includes unvisited files from the same instrumented app build. |
| `CoverageSourceMap` | A version 3 source map from the app's compiler. Include source content to keep the HTML report portable and identify source changes. |
| `CoverageFile` | Istanbul counters and source locations for one JavaScript module. A fresh helper result has zero hits and can be saved in an all-files baseline. |
| `CoverageInstrumentOptions` | JavaScript source, its absolute module filename, and an optional compiler source map. |
| `CoverageInstrumentResult` | Instrumented JavaScript, its composed source map, and the module's zero-hit Istanbul coverage entry. |
| `instrumentCoverage` | Instrument one compiled JavaScript module for a Dyno coverage run. This Node-only helper does not read files, change environment variables, or write the baseline. The app's build owns those steps. |
