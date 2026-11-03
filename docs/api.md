<!-- Generated from source JSDoc. Run npm --prefix site run generate -- --write-markdown. -->
# API reference

Tests run in the browser. Configuration and project setup run in Node. Use the guides to start a project; use this reference to look up arguments, return values and browser capabilities.

Start with `describe` and `test`, then look up what you need:

- `TestContext`: the values passed to tests and hooks.
- `Application`: navigation, requests, screenshots and browser access.
- `defineInteractor`: reusable component actions and assertions.
- `Config`: app server and run settings.
- `ProjectSetup`: shared setup and private worker resources.

Signatures: [browser types](../types/index.d.ts), [configuration](../types/config.d.ts). See the [guide](guide.md) for examples.

## Tests and hooks

| API | Use |
| --- | --- |
| `TestContext.app` | Navigate, make session requests, capture images and inspect the current app window. |
| `TestContext.I` | Interactor rooted in the current app document. Bind custom interactors to this instance. |
| `TestContext.fixtures` | JSON-safe values returned by project setup. These are visible to browser code. |
| `TestContext.signal` | Cancellation for this test or hook. Cleanup receives a fresh signal and its own budget. |
| `TestContext.test` | The current test’s stable ID, file, suite path, name and declared resources. |
| `TestContext` | The browser context passed to a test or hook. `I` resolves against the current app document; fixtures are JSON-safe data supplied by Node setup. |
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
| `Application` | The current app window and the operations Dyno owns. Tests run in a separate context and read the app DOM directly. Fresh documents do not reset browser storage or backend data. |
| `Application.goto` | Navigate to a same-origin app path and wait for its document bridge. Use Interactor to wait for the UI you care about after navigation. |
| `Application.request` | Make a same-origin fetch with the browser session and test cancellation signal. Returns a standard Response. Call your app’s test-only fixture endpoints here; Dyno does not own database factories. |
| `Application.setViewport` | Resize the actual managed viewport and wait for layout. Each dimension must be 1–8192 CSS pixels. Manual runs require the requested dimensions to already match. |
| `Application.screenshot` | Save an exact PNG of the app, excluding the reporter. Full-page and element captures are supported. Required capture fails when unavailable; explicitly optional capture can skip. |
| `Application.pause` | Open the reporter and suspend the execution deadline until Continue. Requires `--ui` or `--manual`. App timers and network work keep running; cleanup cannot pause. |
| `Application.document` | Read the current app document after navigation is ready. Resolve elements again after navigation. |
| `Application.window` | Read the current app window. Browser APIs are available directly; use Interactor assertions for changing state. |
| `Application.native` | Explicit managed browser capabilities. Unsupported required operations fail clearly; there is no synthetic fallback. |
| `Viewport` | App viewport dimensions in CSS pixels. Resizing changes the real viewport, so responsive layouts behave normally. |
| `BrowserIdentity` | The managed browser and provider recorded with a screenshot. This identifies the capture environment, not a simulated device. |
| `CapturedScreenshot` | Saved PNG metadata, including the file path, image dimensions, pixel ratio, viewport and capture policy. Use the path from Node to publish an image to your visual service. |
| `SkippedScreenshot` | An explicitly optional image that could not be captured. Read `reason`; storage or provider failures still fail the test. |
| `Screenshot` | A captured PNG or an explicitly skipped optional image. Check `status` before consuming the path. |
| `ScreenshotRenderingOptions` | Capture policy. Animations default to `allow`, caret to `initial`, and masks to opaque `#ff00ff`. Optional capture skips only when the capability is unavailable. |
| `ScreenshotOptions` | Choose a viewport, full-page or element capture. Element capture cannot combine with `fullPage` or `mask`. Masks use elements from the current app document. |

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
| `NativeBrowser.withDialog` | Arm an accept/dismiss response, await the callback that opens the dialog, then disarm it. An optional message checks the dialog text; `text` supplies a prompt response. |
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
| `defineConfig` | Define typed Node configuration. Paths resolve relative to the config file. A plain default-exported object works too; this helper gives JavaScript editors the same type hints. |
| `Config` | The project configuration. Supply a web-server origin and optionally its startup command. The configuration guide lists defaults, setup ownership and CLI overrides. |
| `ProjectWorker.env` | Environment values added to this worker’s app process. |
| `ProjectWorker.fixtures` | JSON-safe IDs, paths and other values supplied to browser tests. |
| `ProjectWorker.webServer` | Override the app command, URL or readiness settings for this worker. |
| `ProjectWorker` | Private app resources for one worker: server overrides, environment, browser-visible fixtures, optional drain and teardown. Share immutable build output; isolate mutable databases, queues, files and sessions. |
| `ProjectWorker.drain` | Join work started by this execution after Dyno retires its documents. Honor cancellation. Failed draining ends the run and preserves accepted results; teardown must remain safe afterward. |
| `ProjectWorker.teardown` | Release resources acquired by this worker. Setup teardown runs once after all workers close. |
| `ProjectSetup` | The value returned by the Node setup module. One setup owns run-wide resources; each worker owns its private app state. |
| `ProjectSetup.createWorker` | Create private resources for a worker. Required for concurrent managed runs. Manual runs always use one worker. If acquisition fails before returning, clean up anything already created. |
