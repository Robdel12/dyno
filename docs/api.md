<!-- Generated from source JSDoc. Run npm --prefix site run generate -- --write-markdown. -->
# API reference

Write tests with browser APIs; configure the app and its resources in Node. This reference covers arguments, return values, and available capabilities. Start with the [first test guide](guide.md#write-your-first-test) if you're setting up a project.

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
| `Interactor` | An Interactor.js instance rooted in the app’s current document. Dyno adds app-aware events, independent scopes, file inputs and explicit native actions. Use the test’s `I` as your root. Actions are awaitable and support `.then` chaining. Interactor.js owns selectors, convergence and assertions. |
| `Interactor.scope` | Bind an independent root that resolves again after navigation. Create scopes before chaining; a missing root fails instead of searching elsewhere. |
| `Interactor.fill` | Replace an editable input or textarea value and dispatch input/change events. Empty strings and numeric inputs work. Use upstream `type` when individual keystrokes matter. |
| `Interactor.upload` | Select files and dispatch input/change events. Pass no files to clear the selection. File bytes can come from a project fixture endpoint. |
| `Interactor.nativePress` | Send a real key to the focused app element. Requires managed keyboard support; ordinary Interactor `press` uses synthetic events. |
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
| `Application.request` | Fetch a same-origin URL using the browser session and test cancellation signal. Returns a standard Response. Use this for your app's test-only fixture endpoints; keep database factories in your project. |
| `Application.setViewport` | Resize the actual managed viewport and wait for layout. Each dimension must be 1–8192 CSS pixels. Manual runs require the requested dimensions to already match. |
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
| `Application.fixture` | Call a named fixture in this worker's actual app process. Dyno supplies the execution capability, bounded JSON, cancellation, and a named timing step. Configure the optional fixture controller through beforeExecution. Omitted input is null. Calls never retry or follow redirects; abort cannot undo a committed write. Await every call before finishing the test or hook. |

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

## Timings

| API | Use |
| --- | --- |
| `TimingEntry` | One inclusive interval in an execution. Numbers are milliseconds from the browser’s monotonic clock. Nested and parallel intervals overlap; do not add them together. |
| `Timings` | Execution duration and up to 500 recorded intervals. `truncated` counts omitted intervals. A runtime that could not report has no timings rather than invented zeros. |

## Configuration and Node setup

| API | Use |
| --- | --- |
| `defineConfig` | Get type hints for your Node config. Paths resolve relative to the config file. A plain default-exported object works too. |
| `Config` | Set your app server and test-run options. Start with the app URL and, if Dyno should start it, a command. The configuration guide lists defaults and setup examples. |
| `ProjectWorker.beforeExecution` | Prepare one assignment before browser hooks start. Return optional JSON fixtures and a fixture transport binding. Keys must not replace static fixture keys. Preparation consumes this test's timeout and runs once across assignment reply replays. Callbacks must honor cancellation; Dyno joins actual settlement before resource destruction, so uncooperative Node work can delay shutdown. Interrupted or failed preparation requires restarting Dyno. Only the app owns database reset and independent jobs. |
| `ProjectContext` | Inputs to shared project setup: configuration, acquisition signal, immutable CLI session identity, and immediate cleanup registration. |
| `ProjectContext.session` | The CLI session's stable random ID. It survives watch reruns and differs between simultaneous CLI invocations. |
| `ProjectContext.onCleanup` | Register one owned release during acquisition. Callbacks run once in reverse order after app work stops, including when setup throws. Do not reuse the aborted acquisition signal for cleanup or register work after the factory settles. |
| `ProjectWorkerContext` | Project acquisition inputs plus this worker's immutable string ID and numeric index. Resource names still need session identity to separate simultaneous runs. |
| `ProjectExecution` | One owned test execution, with run/worker/execution IDs, the selected test descriptor, and a cancellation signal. Preparation and cleanup get separate live signals. |
| `FixtureTransport` | An execution-owned, same-origin fixture call path and capability. Produced by the fixture control helper; private control credentials never enter this value. |
| `ExecutionPreparation` | JSON data returned by beforeExecution. Fixtures extend static values without replacing keys; the optional transport binds app.fixture to this execution only. |
| `ProjectWorker.env` | Environment values added to this worker’s app process. |
| `ProjectWorker.fixtures` | JSON-safe IDs, paths and other values supplied to browser tests. |
| `ProjectWorker.webServer` | Override the app command, URL or readiness settings for this worker. |
| `ProjectWorker` | Private app resources for one worker: server overrides, environment, browser-visible fixtures, execution preparation, drain and cleanup. Share immutable build output; isolate mutable databases, queues, files and sessions. |
| `ProjectWorker.drain` | Wait for work this execution started after document retirement between tests. The final successful document can remain for inspection; close app admission and join its backend work anyway. Honor cancellation. Failed draining ends the run and saves accepted results; teardown must remain safe afterward. |
| `ProjectWorker.teardown` | Release resources acquired by this worker. Setup teardown runs once after all workers close. |
| `ProjectSetup` | The value returned by the Node setup module. One setup owns CLI-session resources; each worker owns its private app state. |
| `ProjectSetup.createWorker` | Create private resources for a worker. Required for concurrent managed runs. Manual runs always use one worker. Use onCleanup while acquiring resources so partial setup is released if the factory throws. |

## App-process fixtures

| API | Use |
| --- | --- |
| `defineFixtureOperations` | Compose named app operations without changing their definitions. Duplicate names fail immediately. |
| `createFixtureController` | Own fixture admission for one real app worker. Operations receive `(context, input, execution)`; reset and drain receive `(context, execution)`. Execution contains identity and an abort signal. A reset requires a synchronous app admission hold, acquired before the controller returns. |
| `createFixtureHttpHandler` | Handle fixed POST begin/call/drain routes in an outer Node listener. Returns false outside its path. Keep this handler reachable while the app is paused; the control token never belongs in browser fixtures. |
| `connectFixtureControl` | Connect Node worker callbacks to the app's fixed fixture protocol. Calls never retry or follow redirects. `begin` returns execution fixtures and a same-origin browser binding; `drain` returns no browser data. |
| `JsonValue` | Plain JSON accepted by fixture operations: finite numbers, strings, booleans, null, dense arrays and plain records. Runtime validation rejects custom serializers and values JSON would silently drop. |
| `FixtureIdentity` | Run, worker and execution identity supplied by Dyno's coordinator. |
| `FixtureScope` | Execution identity plus its short-lived browser operation capability. Never reuse it across tests or log its token. |
| `FixtureExecution` | Explicit operation identity and cancellation signal. App dependencies arrive separately through the controller context. |
| `FixtureHold` | An app-owned admission hold. Idle waits for accepted work; resume explicitly reopens this owner's admission after successful reset. Independent holds must compose. |
| `FixtureOperation` | A real app factory or helper receiving dependencies, JSON input and its execution context. Return committed browser-safe JSON; detached work still needs app-owned drain. |
| `FixtureController` | App-process fixture lifecycle and named dispatch. Construction can hold app admission; failed or cancelled preparation/drain never reopens it. Close before releasing app dependencies. |
