# How Dyno runs a test

Node manages processes, bundles, and output. The browser executes tests and Interactor actions. Managed runs use the included Playwright Core. Manual runs only need the URL.

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

Node gateway → Playwright worker → original app window and screenshots
```

The start URL, `/__dyno__/`, opens a named companion before loading the app in the original window. The companion keeps its reference to that window through `opener`. App navigation replaces its document without destroying test execution. If a browser blocks the popup, the start page offers **Start** to open it with a user gesture. Both windows must stay open.

The gateway forwards app requests and WebSocket upgrades to the app server. Its startup HTTP readiness check reads the app’s opener/embedder isolation headers; Dyno applies those headers to its own documents before a browser joins. App response headers stay intact. It inserts a small bridge for errors, document readiness, and the reporter overlay. Test code stays in the companion's execution iframe. See the [guide](guide.md#app-server-integration) for cookies, redirects, and CSP behavior.

## Test definitions

The bundled entry loads test modules sequentially through the registration boundary. Each file gets its own registration boundary, including when module evaluation awaits an import. Tests and hooks must belong to a named describe; file-level declarations fail. `describe` callbacks register synchronously. [suite.js](../src/suite.js) builds immutable trees and compiles inherited hooks, focus/skip decisions, and stable file/suite/name IDs into an execution plan. Only serializable test descriptors cross into the host and gateway; callbacks remain in the test runtime. Named suite paths and hook scopes are explicit in the plan. Execution stays sequential; future parallel scheduling must assign separate browser, storage, and backend ownership rather than treating a fresh test document as isolation.

## State and windows

[execution.js](../src/browser/execution.js) contains pure transitions over immutable state. [shell.js](../src/browser/shell.js) applies DOM and network effects. Window and frame handles, promises, and abort controllers stay outside that state.

The app owns its full, unscaled browser viewport. Manual runs use its actual dimensions; managed runs can resize it. Reporter routes never move the app. Inspection opens an overlay at a test boundary. Continue hides it before the next test starts; pausing doesn't freeze the app's timers or network activity.

Before each test, default sizing runs only when configured, actual, or observed geometry differs. Public sizing calls retain their validation and revision changes. Run-specific bundle bytes can be cached; every execution still registers the complete suite in fresh globals.

The reporter owns its route, search, and filter. Its iframe is created on first inspection and retained on close, preserving its route. Closed reporters do not render snapshots; reopening receives current state through the existing ready and presentation messages. Command acknowledgements still arrive while closed. Separate reporter URLs receive server events and send HTTP commands. Both use the same UI.

Live progress carries changed fields and new output through one ordered publisher. The gateway validates each whole change before applying it. Accepted events own final test data; progress cannot finish a run or overwrite an accepted outcome. Fatal results retain unfinished console output without pretending the test completed. Pure reporting helpers create immutable views from those sources.

Standalone observers receive sequenced batches of changed test records. They commit a batch only after its final marker; a reconnect starts a new snapshot. Slow readers retain one in-flight batch and one latest view, with backpressure between records. Each encoded record is limited to 8 MB, with a shared 32 MB reservation for its string and encoded buffer. Object/transport overhead is separate. Command queues and connection counts are bounded too. Exceeding a delivery limit closes that reporter with an explanation; results and saved reports continue independently.

Rendering coalesces through a message turn, so a suspended background animation clock cannot stall the reporter. Route, command and terminal changes render immediately.

A private `window.name` binds the original app window across navigation and survives project calls to `sessionStorage.clear()`. Names route the bootstrap; they do not authenticate messages. Origin, exact source window, run, execution, and current document are checked before accepting messages or operation results. Old unload messages cannot invalidate a newer document.

Test frames and the app have separate documents and globals. They share an origin and storage, so this is not a security boundary against hostile code.

## Failures and cleanup

Execution and cleanup have separate abort signals. Finishing execution cancels its app APIs and pending capture requests. Only entered scopes clean up; ordinary hook failures are collected while later hooks continue within one cleanup budget. The result keeps the first failure and phase-tagged additional errors. The host gives the runtime one second to deliver that result after both budgets expire, then removes an unresponsive frame.

Reporter Stop asks the runtime to cancel and finish bounded cleanup. App loss interrupts execution and cancels pending operations. Closing or reloading the companion destroys its test JavaScript; it cannot resume that execution. Start a new run with a fresh binding. Shared backend resources still belong in Node setup teardown.

Unload messages are best effort. The gateway connection and bounded run deadlines also detect lost ownership; checking `window.closed` alone is insufficient.

## Managed browsers

[browser-session.js](../src/browser-session.js) owns one Playwright browser server and a bounded pool of private contexts. Each context exposes `open`, `activate`, `resize`, `capture`, `retire`, `stop`, identity and capabilities. One IPC process connects through the SDK and keeps a separate operation queue per context, so a waiting operation cannot block another worker. The CLI currently uses one context; native test scheduling is still being implemented.

The parent owns the public SDK server handle, including forced shutdown after IPC failure. Contexts close before that server. The SDK owns browser discovery, channels, downloads, temporary profiles and browser process cleanup. Dyno owns operation deadlines and signal handling. There is no process-name discovery, native launcher or WebDriver path.

Retirement closes companion/test pages and navigates the original app tab to the gateway blank document. Keeping that tab preserves session storage along with origin cookies, local storage and IndexedDB. Failed retirement or native restoration closes the pool before reuse. This stops document JavaScript; service workers and backend work still need project-owned draining. Interactive inspection must finish before retirement releases an execution.

Each launched browser has a private launch token. Each browser that joins gets its own run. Manual visitors can't use another run's controller. Reruns replace the old run and notify its observers.

The worker retains the original app page. The companion becoming active cannot redirect capture or sizing to the wrong window.

`app.setViewport` changes the actual app viewport through Playwright. Manual calls succeed only when the requested size already matches. A configured fixed size must also match; Dyno never simulates it with a larger iframe.

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

Normal completion, browser replacement and shutdown share terminal cleanup and persistence. Final state becomes visible after the write succeeds. A failed save reports an infrastructure error while preserving accepted outcomes. Event delivery uses bounded exact-replay receipts; live delivery retains its last sequence digest. The browser can repeat one outstanding reporting request after a network failure, without repeating test callbacks, actions or native operations. Changed replays and sequence gaps fail plainly.

## Timings

The runtime records bounded monotonic intervals around phases, app operations, and named steps. Interactor runs unchanged. Abort ends pending measurements, and immutable snapshots cross the existing result boundary; the gateway validates bounds and drops unknown fields. Inclusive intervals may overlap, so rankings do not add them together.

CLI lifecycle intervals use a separate session clock. Each report saves a running session snapshot; shutdown finalizes session.json atomically after resource cleanup. Browser-run and CLI wall times remain distinct. No per-poll messages or driver commands are added.

## Native browser operations

Rare native keys, pointer movement, permissions, media, offline transport, and virtual authenticators use the existing runtime message, controller queue, authenticated gateway, and owned worker. Interactor resolves DOM targets locally. No exposed SDK binding, driver selector, or generic evaluation API enters the app.

Requests carry execution and document identity. The worker checks the original page bridge immediately before dispatch. Geometry stays tied to that document; keys may navigate within their execution. Cancellation rejects queued requests and late results, but cannot undo delivered input. The checks detect races rather than making browser input atomic.

The controller resets managed native state after each test. The gateway also restores it on completion, replacement, and shutdown. Cleanup must finish before another execution proceeds; failed restoration ends the session. Locale and time zone are context configuration. Native calls use the existing first-class timing model.

Element screenshots extend the existing capture path with a document-coordinate clip and checked PNG dimensions. They keep the viewport and scroll position unchanged. Fractional edges round outward to include the element's painted bounds; element capture cannot combine full-page or mask options.
