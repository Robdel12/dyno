# How Dyno runs a test

Node manages processes, bundles, and output. The browser executes tests and Interactor actions. A driver is optional.

```text
Browser host
├─ execution iframe: fresh test runtime
│  └─ app iframe: fresh document and globals
└─ reporter iframe: inspection overlay

Node gateway → optional provider → browser window and screenshots
```

The gateway forwards app requests and WebSocket upgrades to the app server. It adds a small script for errors and document readiness. The test bundle stays in the execution frame. See the [guide](guide.md#app-server-integration) for cookies, redirects, and CSP behavior.

## Test definitions

The bundled entry loads test modules sequentially through the registration boundary. Each file gets its own scope, including when module evaluation awaits an import. `describe` callbacks register synchronously. [suite.js](../src/suite.js) builds immutable trees and compiles inherited hooks, focus/skip decisions, and stable file/suite/name IDs into an execution plan. Only serializable test descriptors cross into the host and gateway; callbacks remain in the test runtime.

## State and frames

[execution.js](../src/browser/execution.js) contains pure transitions over immutable state. [shell.js](../src/browser/shell.js) applies DOM and network effects. Frame handles, promises, and abort controllers stay outside that state.

The app stays unscaled at the viewport origin. URL-only runs follow the browser's size by default; managed runs use fixed dimensions. Reporter routes never move the app. Inspection opens an overlay at a test boundary. Continue hides it before the next test starts; pausing doesn't freeze the app's timers or network activity.

The reporter owns its route, search, and filter. Embedded reporters receive checked `postMessage` messages. Separate reporter URLs receive server events and send HTTP commands. Both use the same UI.

Frames isolate documents, styles, and globals. They share origin storage and can access each other, so they aren't a security boundary against hostile code.

## Failures and cleanup

Execution and cleanup have separate abort signals. Finishing execution cancels its app APIs and pending capture requests. Only entered scopes clean up; ordinary hook failures are collected while later hooks continue within one cleanup budget. The result keeps the first failure and phase-tagged additional errors. The host gives the runtime one second to deliver that result after both budgets expire, then removes an unresponsive frame.

Reporter Stop asks the runtime to cancel and finish bounded cleanup. Closing the browser or terminating the CLI can end it sooner; shared backend resources still belong in Node setup teardown.

## Browser providers

[browser-session.js](../src/browser-session.js) exposes `open`, `resize`, `capture`, `stop`, identity, and capabilities. Native sessions only launch URLs. Playwright and WebDriver load in an owned worker when selected. The CLI removes disposable profiles and stops owned processes, including detached browsers left by a worker crash.

Each launched browser has a private launch token. Each browser that joins gets its own run. Manual visitors can't use another run's controller. Reruns replace the old run and notify its observers.

`app.setViewport` changes app-frame dimensions locally. Managed providers also make room in the browser window. WebDriver window dimensions include browser chrome, so the host measures the actual viewport and allows one correction. A size that still won't fit fails clearly.

## Editing tests

`doctor` validates config, bundling, browser prerequisites, and the app URL without acquiring processes. Test watches use filesystem events for the test directory and imported project helpers. Immutable watch state tracks builds and browser runs independently. Edits during either stay queued; the next run gets the latest source. Config and Node setup changes require restart.

`app.pause()` uses a browser message, without a driver. It suspends the execution deadline and host watchdog while retaining the test and app. Continue hides the reporter before resuming the remaining budget. Cleanup cannot pause, and headless runs reject the call.

## Saving a screenshot

1. The runtime waits for app fonts and sends the execution, document, and request IDs.
2. The host checks the active frame, hidden reporter, viewport revision, host dimensions, and device pixel ratio.
3. The gateway verifies ownership, captures its known page, checks PNG dimensions, crops to the app, and writes a temporary file.
4. The host checks the document and geometry again. The gateway then renames the file and returns attachment metadata.
5. The test receives the saved attachment. It becomes run output when the gateway accepts that test's result.

Navigation, resizing, Stop, disposal, or lost ownership invalidates pending captures. Late results and partial files are removed. Interrupted runs also discard saved images that weren't reported. Reported images remain on disk.

These operations return promises. Finishing a test or hook with unfinished screenshot or viewport work fails clearly. Missing optional capture produces a skipped image; provider and storage errors still fail. A screenshot records a rendered frame during the request, without freezing other app work.

The real browser workflows in [tests](../tests) cover image pixels, resizing, navigation races, manual/managed ownership, reporter controls, interruption, and cleanup. Internal modules aren't mocked.
