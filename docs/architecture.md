# How Dyno runs a test

Node manages processes, bundles, and output. The browser executes tests and Interactor actions. Managed runs use the included Playwright Core. Manual runs only need the URL.

## CLI boundaries

[bin/dyno.js](../bin/dyno.js) owns process signals, exit codes, and terminal streams. [cli.js](../src/cli.js) builds a fresh Commander command tree for parsing, validation, and generated help. Its output and exit hooks return control to Dyno; only immutable options or help/version results leave the parser. [commands.js](../src/commands.js) dispatches those options; [cli-run.js](../src/cli-run.js) owns a test session's resources and reverse-order cleanup. [cli-output.js](../src/cli-output.js) formats human output and JSON events. Project console output goes to stderr.

[watch-session.js](../src/watch-session.js) coordinates the filesystem watcher and immutable watch transitions. It runs one build at a time, keeps queued edits, and waits for an active build during shutdown. Cancelling a build doesn't report a false failure; reload failures explain how to reconnect.

Every command shares cancellation, including browser installation. Shutdown cancels execution before draining cleanup and finalizing session timing. Browser-result deadlines also cancel managed browser opening. There is one command path for each operation.

## Interactor

Dyno ships the pinned Interactor source and generated types in `vendor/interactor`, with its MIT license and upstream commit. Apps don't need a Git subdependency or an Interactor build step. To refresh the snapshot, update the revision in `scripts/vendor-interactor.js` and run `npm run vendor:interactor`. Keep upstream code unchanged; Dyno's extensions stay in `src/browser/interactor.js`.

The exported `Interactor` and each test's `I` use the same app-aware class. Its public Interactor extension points supply app-realm events/files, form replacement, rendered assertions, and dynamic scopes. Scopes create independent contexts with the same assertion settings and signal; they resolve their roots again after navigation. Interactor.js still owns selectors, chaining, retries, and stability checks. Apps keep domain page objects and fixture I/O.

`defineInteractor({ actions, assertions })` registers actions and assertions through Interactor's public API on a private subclass with its own assertion class. Its returned function binds that definition to an existing Interactor and optional selector. Definitions never register methods on `I` or siblings. Binding and `scope()` share one context-copy path; neither caches app elements. The small subclass keeps registrations independent.

## App and test windows

```text
Original app window
└─ reporter iframe: inspection overlay

Persistent companion window: controller
└─ hidden execution iframe: fresh test runtime
   └─ direct access to the app window's current document

Node gateway → Playwright worker → original app window and screenshots
```

The start URL, `/__dyno__/`, opens a named companion before loading the app in the original window. Managed launch activates Dyno's **Start tests** button with a trusted browser gesture and waits for the companion to open. Manual URLs open it automatically when allowed, with the same button available if popups are blocked. The companion keeps its reference to the app through `opener`, so app navigation preserves test execution. Each app document finds the companion over a `BroadcastChannel` named after it; the companion answers by handing its window to that document. Both windows must stay open.

Visible browsers shouldn't take focus from whatever you're doing. Headed Chromium workers open their windows in the background over CDP, screenshots and viewport changes capture the app tab without raising it, and later runs reuse the companion window by navigating it instead of opening a new one. A page that calls `window.open` always activates the browser, so the companion's first opening is the one moment Chrome comes forward. Firefox and WebKit still raise the app window before screenshots and resizes.

A visible Chromium window also fits the screen. When the viewport is larger than the display, Dyno scales the view down through Chromium's device emulation and sizes the window to match. The app still lays out at the configured viewport, and screenshots capture it at full size. Emulation belongs to a CDP session, so [chromium-emulation.js](../src/providers/chromium-emulation.js) keeps one session per page for screenshots, viewport changes, and the fit.

The gateway forwards app requests and WebSocket upgrades to the app server. Its startup HTTP readiness check reads the app’s opener/embedder isolation headers; Dyno applies those headers to its own documents before a browser joins. App response headers stay intact. It inserts a small bridge for errors, document readiness, and the reporter overlay. Test code stays in the companion's execution iframe. See the [guide](guide.md#connect-your-app-server) for cookies, redirects, and CSP behavior.

## Test definitions

The bundle loads test modules one at a time. Each file registers its own definitions, including across awaited imports. Tests and hooks must belong to a named `describe`; file-level declarations fail. `describe` callbacks run synchronously.

[suite.js](../src/suite.js) builds immutable trees and compiles inherited hooks, focus/skip decisions, and stable file/suite/name IDs into an execution plan. Only serializable test descriptors, including declared resources, cross into the host and gateway; callbacks remain in the test runtime. Named suite paths and hook scopes are explicit in the plan.

`run.js` keeps the test catalog, priority, workers, assignments, and accepted results in immutable state. Before starting a test, hosts request an execution ID. Results must match the worker, execution, and stable test ID. They can arrive out of order; reports keep catalog order. Workers must register matching catalogs before receiving work. One coordinator handles any worker count, with a private browser context, gateway, and project resources per worker.

Tests declare the resources they need. Dyno reserves the whole set together and keeps it after accepting the result. Before taking another assignment, the host removes the test runtime, parks the app on a blank document, and waits for project cleanup. The controller and project storage survive. A failed or timed-out drain stops new assignments without changing accepted results. The final app can stay open for inspection; its assignment stays marked as retained, and its project work still drains before saving.

## State and windows

[execution.js](../src/browser/execution.js) contains pure transitions over immutable state. [shell.js](../src/browser/shell.js) applies DOM and network effects. Window and frame handles, promises, and abort controllers stay outside that state.

The app owns its full, unscaled browser viewport. Manual runs use its actual dimensions; managed runs can resize it. Reporter routes never move the app. Inspection opens an overlay at a test boundary. Continue hides it before the next test starts; pausing doesn't freeze the app's timers or network activity.

Before each test, default sizing runs only when configured, actual, or observed geometry differs. Public sizing calls retain their validation and revision changes. Run-specific bundle bytes can be cached; every execution still registers the complete suite in fresh globals.

## Reporter updates

The reporter owns its route, search, and filter. Its iframe is created on first inspection and retained on close, preserving its route. Closed reporters do not render snapshots; reopening receives current state through the existing ready and presentation messages. Command acknowledgements still arrive while closed. Separate reporter URLs receive server events and send HTTP commands. Both use the same UI.

Each worker publishes changed fields and new output through one ordered publisher. The coordinator merges progress by owned assignment, while accepted outcomes remain the final result. Embedded and standalone reporters consume the same bounded event stream; hidden embedded reporters disconnect and reopen with a fresh snapshot. Reporter commands await acknowledgements in their HTTP response, so closing the overlay cannot lose a pending reply.

The gateway validates each change before applying it. Progress updates can't finish a run or overwrite an accepted result. Fatal errors retain unfinished console output without claiming the test completed. Pure reporting helpers turn these inputs into immutable views.

Standalone observers receive sequenced batches of changed test records. They commit a batch only after its final marker; a reconnect starts a new snapshot. Slow readers retain one in-flight batch and one latest view, with backpressure between records. Each encoded record is limited to 8 MB, with a shared 32 MB reservation for its string and encoded buffer. Object/transport overhead is separate. Command queues and connection counts are bounded too. Exceeding a delivery limit closes that reporter with an explanation; results and saved reports continue independently.

A message task batches rendering, so a paused background animation clock can't stall the reporter. Route, command, and final-result changes render immediately.

## Window ownership

A private `window.name` binds the original app window across navigation and survives project calls to `sessionStorage.clear()`. Names route the bootstrap; they do not authenticate messages. Origin, exact source window, run, execution, and current document are checked before accepting messages or operation results. Old unload messages cannot invalidate a newer document.

Test frames and the app have separate documents and globals. They share an origin and storage, so this is not a security boundary against hostile code.

## Failures and cleanup

Execution and cleanup have separate abort signals. Finishing execution cancels its app APIs and pending capture requests. Only entered scopes clean up; ordinary hook failures are collected while later hooks continue within one cleanup budget. The result keeps the first failure and phase-tagged additional errors. The host gives the runtime one second to deliver that result after both budgets expire, then removes an unresponsive frame.

Reporter Stop asks the runtime to cancel and finish bounded cleanup. App loss interrupts execution and cancels pending operations. Closing or reloading the companion destroys its test JavaScript; it cannot resume that execution. Start a new run with a fresh binding. Shared backend resources still belong in Node setup teardown.

Unload messages aren't guaranteed. Dyno also checks the gateway connection and run deadlines to detect a lost browser; `window.closed` alone isn't enough.

## Managed browsers

[browser-session.js](../src/browser-session.js) owns one Playwright browser server and a bounded pool of private contexts. Each context exposes `open`, `activate`, `resize`, `capture`, `retire`, `stop`, identity and capabilities. One IPC process connects through the SDK and keeps a separate operation queue per context, so a waiting operation cannot block another worker. The CLI sizes the pool from the managed worker count; the coordinator assigns tests to those private contexts.

The parent owns the public SDK server handle, including forced shutdown after IPC failure. Contexts close before that server. The SDK owns browser discovery, channels, downloads, temporary profiles and browser process cleanup. Dyno owns operation deadlines and signal handling. There is no process-name discovery, native launcher or WebDriver path.

Retirement closes companion/test pages and navigates the original app tab to the gateway blank document. Keeping that tab preserves session storage along with origin cookies, local storage and IndexedDB. Failed retirement or native restoration closes the pool before reuse. This stops document JavaScript; service workers and backend work still need project-owned draining. Interactive inspection must finish before retirement releases an execution.

Each managed worker has a private launch token and joins the group's shared run. Manual visitors get independent runs and can't use another run's controller. Reruns replace the old run and notify its observers.

The worker retains the original app page. The companion becoming active cannot redirect capture or sizing to the wrong window.

`app.setViewport` changes the actual app viewport through Playwright. Manual calls succeed only when the requested size already matches. A configured fixed size must also match; Dyno never simulates it with a larger iframe.

## Editing tests

`doctor` checks config, bundling, browser prerequisites, and the app URL without starting processes. Test watches use filesystem events for the test directory and imported project helpers. Immutable watch state tracks builds and browser runs independently. Edits during either stay queued; the next run gets the latest source. Config and Node setup changes require restart.

`app.pause()` uses a browser message, without a driver. It suspends the execution deadline and host watchdog while retaining the test and app. Continue hides the reporter before resuming the remaining budget. Cleanup cannot pause, and headless runs reject the call.

## Saving a screenshot

The app stays in the top-level window because nested iframe captures can have the right image dimensions while clipping content below the iframe viewport. Enlarging the iframe changes the layout under test. Capturing the original page preserves its viewport and real browser rendering; capture tests check offscreen pixels as well as dimensions.

1. The provider activates its owned app tab; the runtime prepares animations and caret state, waits for app fonts and sends execution, document, and request IDs with capture options.
2. The controller checks ownership, the hidden reporter, viewport revision, dimensions, and pixel ratio.
3. The gateway captures the original app page, verifies PNG dimensions, and writes a temporary file. Full-page capture keeps the viewport unchanged.
4. The controller checks the document and geometry again. The gateway then publishes the file and returns attachment metadata.
5. The test receives the saved attachment. It becomes run output when the gateway accepts that test's result.

Navigation, resizing, Stop, disposal, or lost ownership invalidates pending captures. Late results and partial files are removed. Interrupted runs also discard saved images that weren't reported. Reported images remain on disk.

These operations return promises. Finishing a test or hook with unfinished screenshot or viewport work fails clearly. Missing optional capture produces a skipped image; provider and storage errors still fail. A screenshot records a rendered frame during the request. Masks are painted into the PNG. Browser-local preparation finishes finite animations and suspends infinite ones before measuring masks, then restores temporary caret styles and restarts suspended animations. [Browser setup](browsers.md) lists capture limits.

Chromium's beyond-viewport capture briefly emulates a 1 × 1 page ([upstream issue](https://github.com/puppeteer/puppeteer/issues/7251)). For full-page and element captures, the managed provider pauses app JavaScript with a capture-owned debugger marker and captures through Playwright’s CDP session API. It preserves queued callbacks, restores execution before returning pixels, and never resumes a developer’s existing pause. The capture session matches the SDK’s viewport, screen, pixel ratio and mobile orientation; using an unconfigured second session would reset pixel ratio. CSS animation and backend work continue. Failed restoration closes the context instead of reusing a paused page. Document, viewport, execution and cancellation checks still apply.

The real browser workflows in [tests](../tests) cover image pixels, resizing, navigation races, manual/managed ownership, reporter controls, interruption, and cleanup. Internal modules aren't mocked.

## Saved results

The gateway owns accepted run snapshots. On completion or interruption, a pure report model selects public result fields; formatters produce versioned JSON, JUnit, and standalone HTML. The writer copies accepted images into a temporary run folder and renames it into place after all files finish. Missing source images become explicit unavailable attachments.

Shutdown stops accepting new runs before waiting for pending writes. A join already rebuilding tests checks again before creating a run. The CLI waits for report persistence before releasing the gateway. Saved HTML needs neither a driver nor a running server.

Normal completion, browser replacement and shutdown share terminal cleanup and persistence. Final state becomes visible after the write succeeds. A failed save reports an infrastructure error while preserving accepted outcomes. The gateway keeps a small cache of accepted messages and the last live sequence hash. The browser can repeat one outstanding reporting request after a network failure, without repeating test callbacks, actions or native operations. Changed replays and sequence gaps fail plainly.

## Application coverage

Apps enable Istanbul instrumentation in their own build. The optional `dyno/coverage` helper instruments compiled modules; Dyno does not transform application JavaScript in the gateway. A build-produced zero-hit baseline includes modules that never load. Without that baseline, reports describe loaded files only.

The app bridge sends cumulative counters to the persistent companion synchronously. The companion checks the source window before navigation, then copies the counters in a message task after app `pagehide` handlers finish. It drops the old document reference before uploading through a separate authenticated endpoint. Uploads must be acknowledged before an execution is released or the run completes. New snapshots replace earlier counters from the same document; independent documents and workers add their hits once. Released executions merge into one aggregate.

The coordinator validates counter shapes, ownership, sequence, source definitions, and source-map content. It freezes coverage before saving terminal results. Interrupted collection is explicit; accepted test outcomes remain separate from coverage failures. The existing report staging directory owns coverage HTML, LCOV, and JSON. Repeated rounds merge compatible app coverage once per run and evaluate thresholds on their combined result. Watch runs start fresh.

Collection covers the top-level app window. App workers, embedded frames, server code, and CSS need separate collectors. Source maps with `sourcesContent` let Dyno detect source changes whose counter locations remain the same; an Istanbul schema hash alone does not identify an app build.

## Timings

The runtime records bounded monotonic intervals around phases, app operations, and named steps. Interactor runs unchanged. Abort ends pending measurements, and immutable snapshots cross the existing result boundary; the gateway validates bounds and drops unknown fields. Inclusive intervals may overlap, so rankings do not add them together.

CLI lifecycle intervals use a separate session clock. Each report saves a running session snapshot; shutdown finalizes session.json atomically after resource cleanup. Browser-run and CLI wall times remain distinct. No per-poll messages or driver commands are added.

## Native browser operations

Interactor owns clicks, typing, app keyboard handlers, and scrolling through local actions. The managed input surface is limited to real keys for browser defaults and pointer movement for CSS hover. Permissions, media, offline transport, and virtual authenticators use the same runtime message, controller queue, authenticated gateway, and owned worker. Interactor resolves DOM targets locally. No exposed SDK binding, driver selector, or generic evaluation API enters the app.

Requests carry execution and document identity. The worker checks the original page bridge immediately before dispatch. Geometry stays tied to that document; keys may navigate within their execution. Cancellation rejects queued requests and late results, but cannot undo delivered input. The checks detect races rather than making browser input atomic.

The controller resets managed native state after each test. The gateway also restores it on completion, replacement, and shutdown. Cleanup must finish before another execution proceeds; failed restoration ends the session. Locale and time zone are context configuration. Native calls appear in the same timing reports as other operations.

Element screenshots extend the existing capture path with a document-coordinate clip and checked PNG dimensions. They keep the viewport and scroll position unchanged. Fractional edges round outward to include the element's painted bounds; element capture cannot combine full-page or mask options.

## Execution order

Declared order is the default. An explicit or generated seed ranks stable test IDs with versioned SHA-256 ordering; filtering preserves their relative priority. It does not replace application randomness.

The CLI, live reporter and saved report expose the seed. `schedule.json` records selected IDs, priority, actual assignments and completion order. Version 2 schedules include the source-content fingerprint and catalog. `--replay` validates those inputs and restores each recorded worker queue; an interrupted prefix explicitly omits unassigned tests. Replay constrains queue heads even when a later queued test could bypass a resource. It reproduces queues, not asynchronous interleaving.

## Repeated runs and shared resources

Managed headless `--repeat` composes ordinary runs inside one CLI session. `repeat.js` folds accepted round outcomes into immutable per-test counts; the existing run model still accepts one execution per stable test ID. Each seeded round uses a versioned root-derived seed, with the literal root preserved for round one. Queue replay stays fixed. The coordinator's common replacement path receives the next seed and reuses the pinned test bundle, worker contexts, servers and project resources.

Repeated runs park the final app document before draining and releasing resources, even after the last test. The next round waits for results to be saved and the current operation to finish. Each round has its own browser-result deadline; cleanup and storage failures stop repetition. Interactive runs can still keep the final app open for inspection. Your project owns storage and backend reset.

`repeat-reports.js` saves compact round outcomes and schedules independently of the coordinator's 20-run cache. Failed/interrupted and final rounds use the ordinary portable formatter. Successful intermediate captures are removed after evidence persistence. A 256 MiB evidence limit stops further rounds explicitly; accepted counts and aggregate/session metadata remain available outside that budget. The test fingerprint does not identify the running app or backend, and rerunning a batch prefix does not replay asynchronous interleaving.

`coordinator.js` owns run snapshots, processes results in order, and coordinates assignment waiting, message replays, draining and final saves. `run.js` contains pure ownership/resource transitions. Private gateways bind requests to their worker ID; posted worker IDs cannot borrow a peer execution. Cross-gateway image reads resolve accepted UUIDs from the same canonical outcomes.

Project setup runs once per CLI session and can return `createWorker`. Both receive a frozen session ID and `onCleanup`. Register releases before the factory returns; partial failures use the same cleanup stack as returned teardown. Dyno waits for all started setup callbacks before releasing worker or shared resources. Each factory supplies private server, environment, fixtures, preparation, drain, and teardown settings. Cleanup closes the coordinator and gateways first, then app servers, worker projects, shared setup, and finally the browser.

Managed rerun and watch retire all old documents, drain the previous run, rebuild once and reopen one new group. Manual refresh parks its old app through browser APIs before joining. A missing controller has a bounded reconnection window; a lost managed worker ends the shared run without retrying it. Browser document retirement precedes project draining on failure. Project callbacks must honor cancellation; Dyno cannot force arbitrary Node code to stop.

`run-timings.js` derives wall, execution, handoff, queue and unassigned intervals from the coordinator clock. Browser intervals keep their own clocks. Saved JSON and live/offline reports distinguish elapsed wall from summed test work; project cleanup is a measured part of handoff.

## Execution preparation and fixtures

The coordinator reserves an assignment, then runs `beforeExecution` without blocking the run queue. Duplicate assignment requests wait for the same preparation. A handshake checks the source window, run, and execution before passing its JSON to the test runtime. The result never enters frame URLs or gateway-wide settings, and its keys can't replace static fixtures. Preparation uses the test timeout; delivery and replay recalculate the time left. Preparation timings use the coordinator clock and count toward execution duration, separately from cleanup. Debug pauses work as usual.

Stop, rerun, controller loss, and shutdown cancel pending preparation before waiting on run queues. A failed preparation prevents worker reuse. Dyno waits for the callback before releasing resources, so Node work must honor cancellation. The final app can stay open for inspection while project drain stops new backend work. Shutdown retires retained managed documents before closing app and project resources.

The optional `dyno/fixtures` module combines named operations with an app-process controller that accepts explicit worker dependencies. Its HTTP handler and control client share a JSON protocol with size limits, outside the gateway's reserved path. Begin and drain use private control credentials; browser calls get a fresh token for their execution. Reset finishes before the execution opens. Cancellation can't roll back writes, so drain still waits for operations to finish. Failed or cancelled preparation/drain leaves app requests paused. Calls never retry or follow redirects.

A framework that parses requests can call the controller directly. Keep its control endpoints reachable while app requests are paused. Your app chooses the database, queues, request holds, and background-work cleanup; no Cricket integration is required.
