# How Dyno runs a test

Node manages processes, bundles, and output. The browser executes tests and Interactor actions. A driver is optional.

## CLI boundaries

[bin/dyno.js](../bin/dyno.js) owns process signals, exit codes, and terminal streams. [cli.js](../src/cli.js) builds a fresh Commander command tree for parsing, validation, and generated help. Its output and exit hooks return control to Dyno; only immutable options or help/version results leave the parser. [commands.js](../src/commands.js) dispatches those options; [cli-run.js](../src/cli-run.js) owns a test session's resources and reverse-order cleanup. [cli-output.js](../src/cli-output.js) formats human output and JSON events. Project console output goes to stderr.

[watch-session.js](../src/watch-session.js) coordinates the filesystem watcher and immutable watch transitions. It serializes builds, retains queued edits, and waits for an active build during shutdown. Cancelled builds don't emit spurious failures; reload failures explain how to reconnect the browser.

Every command shares cancellation, including browser installation. Shutdown cancels execution before draining cleanup and finalizing session timing. Browser-result deadlines also cancel managed browser opening. There is one command path for each operation.

## Interactor

The exported `Interactor` and each test's `I` use the same app-aware class. Its public Interactor extension points supply app-realm events/files, form replacement, rendered assertions, and dynamic scopes. Scopes create independent contexts with the same assertion settings and signal; they resolve their roots again after navigation. Interactor.js still owns selectors, chaining, retries, and stability checks. Apps keep domain page objects and fixture I/O.

`defineInteractor({ actions, assertions })` registers native extensions on a private subclass with its own assertion class. Its returned function binds that definition to an existing Interactor and optional selector. Definitions never register methods on `I` or siblings. Binding and `scope()` share one context-copy path; neither caches app elements. The small subclass isolates native registration rather than introducing another interaction engine.

```text
Original app window
└─ reporter iframe: inspection overlay

Persistent companion window: controller
└─ hidden execution iframe: fresh test runtime
   └─ direct access to the app window's current document

Node gateway → optional provider → original app window and screenshots
```

The start URL, `/__dyno__/`, opens a named companion before loading the app in the original window. The companion keeps its reference to that window through `opener`. App navigation replaces its document without destroying test execution. If a browser blocks the popup, the start page offers **Start** to open it with a user gesture. Both windows must stay open.

The gateway forwards app requests and WebSocket upgrades to the app server. Its startup HTTP readiness check reads the app’s opener/embedder isolation headers; Dyno applies those headers to its own documents before a browser joins. App response headers stay intact. It inserts a small bridge for errors, document readiness, and the reporter overlay. Test code stays in the companion's execution iframe. See the [guide](guide.md#app-server-integration) for cookies, redirects, and CSP behavior.

## Test definitions

The bundled entry loads test modules sequentially through the registration boundary. Each file gets its own scope, including when module evaluation awaits an import. `describe` callbacks register synchronously. [suite.js](../src/suite.js) builds immutable trees and compiles inherited hooks, focus/skip decisions, and stable file/suite/name IDs into an execution plan. Only serializable test descriptors cross into the host and gateway; callbacks remain in the test runtime.

## State and windows

[execution.js](../src/browser/execution.js) contains pure transitions over immutable state. [shell.js](../src/browser/shell.js) applies DOM and network effects. Window and frame handles, promises, and abort controllers stay outside that state.

The app owns its full, unscaled browser viewport. Native and manual runs use its actual dimensions; managed providers can resize it. Reporter routes never move the app. Inspection opens an overlay at a test boundary. Continue hides it before the next test starts; pausing doesn't freeze the app's timers or network activity.

The reporter owns its route, search, and filter. Embedded reporters receive checked `postMessage` messages. Separate reporter URLs receive server events and send HTTP commands. Both use the same UI.

A private `window.name` binds the original app window across navigation and survives project calls to `sessionStorage.clear()`. Names route the bootstrap; they do not authenticate messages. Origin, exact source window, run, execution, and current document are checked before accepting messages or operation results. Old unload messages cannot invalidate a newer document.

Test frames and the app have separate documents and globals. They share an origin and storage, so this is not a security boundary against hostile code.

## Failures and cleanup

Execution and cleanup have separate abort signals. Finishing execution cancels its app APIs and pending capture requests. Only entered scopes clean up; ordinary hook failures are collected while later hooks continue within one cleanup budget. The result keeps the first failure and phase-tagged additional errors. The host gives the runtime one second to deliver that result after both budgets expire, then removes an unresponsive frame.

Reporter Stop asks the runtime to cancel and finish bounded cleanup. App loss interrupts execution and cancels pending operations. Closing or reloading the companion destroys its test JavaScript; it cannot resume that execution. Start a new run with a fresh binding. Shared backend resources still belong in Node setup teardown.

Unload messages are best effort. The gateway connection and bounded run deadlines also detect lost ownership; checking `window.closed` alone is insufficient.

## Browser providers

[browser-session.js](../src/browser-session.js) exposes `open`, `activate`, `resize`, `capture`, `stop`, identity, and capabilities. Native sessions only launch URLs. Playwright and WebDriver load in an owned worker when selected. The CLI removes disposable profiles and stops owned processes, including detached browsers left by a worker crash.

Each launched browser has a private launch token. Each browser that joins gets its own run. Manual visitors can't use another run's controller. Reruns replace the old run and notify its observers.

Providers retain the original app page or window handle. The companion becoming active cannot redirect capture or sizing to the wrong window.

`app.setViewport` requires a managed provider to change the actual app viewport. Native and manual calls succeed only when the requested size already matches. A configured fixed size must also match; Dyno never simulates it with a larger iframe. WebDriver Chrome, Edge, and Firefox use BiDi to size the actual viewport. Safari uses window dimensions; the controller measures the app viewport and allows one correction. Sizes that still do not match fail clearly.

## Editing tests

`doctor` validates config, bundling, browser prerequisites, and the app URL without acquiring processes. Test watches use filesystem events for the test directory and imported project helpers. Immutable watch state tracks builds and browser runs independently. Edits during either stay queued; the next run gets the latest source. Config and Node setup changes require restart.

`app.pause()` uses a browser message, without a driver. It suspends the execution deadline and host watchdog while retaining the test and app. Continue hides the reporter before resuming the remaining budget. Cleanup cannot pause, and headless runs reject the call.

## Saving a screenshot

1. The provider activates its owned app tab; the runtime prepares animations and caret state, waits for app fonts and sends execution, document, and request IDs with capture options.
2. The controller checks ownership, the hidden reporter, viewport revision, dimensions, and pixel ratio.
3. The gateway captures the original app page, verifies PNG dimensions, and writes a temporary file. Full-page capture keeps the viewport unchanged.
4. The controller checks the document and geometry again. The gateway then publishes the file and returns attachment metadata.
5. The test receives the saved attachment. It becomes run output when the gateway accepts that test's result.

Navigation, resizing, Stop, disposal, or lost ownership invalidates pending captures. Late results and partial files are removed. Interrupted runs also discard saved images that weren't reported. Reported images remain on disk.

These operations return promises. Finishing a test or hook with unfinished screenshot or viewport work fails clearly. Missing optional capture produces a skipped image; provider and storage errors still fail. A screenshot records a rendered frame during the request, without freezing other app work. Masks are painted into the PNG. Browser-local preparation finishes finite animations and suspends infinite ones before measuring masks, then restores temporary caret styles and restarts suspended animations. [Browser setup](browsers.md) lists capture limits.

The real browser workflows in [tests](../tests) cover image pixels, resizing, navigation races, manual/managed ownership, reporter controls, interruption, and cleanup. Internal modules aren't mocked.

## Saved results

The gateway owns accepted run snapshots. On completion or interruption, a pure report model selects public result fields; formatters produce versioned JSON, JUnit, and standalone HTML. The writer copies accepted images into a temporary run folder and renames it into place after all files finish. Missing source images become explicit unavailable attachments.

Shutdown closes admission before waiting for pending writes. Joins already rebundling must recheck admission before creating a run. The CLI waits for report persistence before releasing the gateway. Saved HTML needs neither a driver nor a running server.

## Timings

The runtime records bounded monotonic intervals around phases, app operations, and named steps. Interactor runs unchanged. Abort ends pending measurements, and immutable snapshots cross the existing result boundary; the gateway validates bounds and drops unknown fields. Inclusive intervals may overlap, so rankings do not add them together.

CLI lifecycle intervals use a separate session clock. Each report saves a running session snapshot; shutdown finalizes session.json atomically after resource cleanup. Browser-run and CLI wall times remain distinct. No per-poll messages or driver commands are added.
