# How Dyno runs a test

The CLI owns app/server processes, bundle snapshots, optional browser controllers, and artifacts. The browser owns test execution. Opening the execution URL works without a driver.

```text
Browser host
├─ execution frame: fresh test runtime
│  └─ app frame: fresh app document and globals
└─ reporter frame: inspection overlay, separate URL

Node gateway → optional owned controller → browser pixels/window
```

## State and ownership

`src/browser/execution.js` holds pure transitions over immutable execution snapshots. The host in `shell.js` applies DOM, network, and lifecycle effects. Frame handles, pending promises, and abort controllers stay outside render state. The reporter keeps its own route, search, and filter; it receives execution snapshots rather than owning app frames.

The app stays unscaled at the viewport origin. Native/manual defaults fill the actual browser and follow its resize events. Explicit dimensions and managed defaults stay fixed until a deliberate sizing request. Reporter routes never move it. Inspect requests pause at a test boundary; the overlay opens once paused. Continue hides it before running the next test. A paused runner doesn't freeze app timers or network activity. Inspection can deliberately change focus and viewport.

An embedded reporter uses checked postMessage messages; a standalone observer uses server events and narrow HTTP commands. Both render the same UI. No snapshot loop polls the DOM or server. Interactor owns assertion convergence.

Each CLI-owned browser has a private launch binding. Each join gets its own run and connection identity. Each test gets a fresh execution ID; the existing app bridge identifies each document. A manual browser never borrows a managed controller. Reruns invalidate old ownership and notify observers of the replacement run.

## Provider boundary

`browser-session.js` exposes identity, capabilities, open, resize, capture, and stop. Native sessions only open URLs. Playwright and WebDriver implementations live behind optional imports in an owned worker process. The parent owns disposable profiles and process cleanup, including after a provider crash. Cleanup also finds SDK-detached browsers by that unique profile before removing it. Test code gets `app` and Interactor; it never gets a driver, remote selectors, or arbitrary protocol commands.

`app.setViewport` changes app-frame CSS dimensions locally. A managed controller also prepares enough top-level visible space. WebDriver OS window dimensions aren't CSS viewport dimensions, so the browser reports its actual size and permits one measured correction for browser chrome. Unsupported sizes fail instead of producing a scaled image.

## Screenshot completion

1. Runtime waits for the app's fonts and requests capture with execution, document, and request IDs.
2. Host checks its active frame, hidden reporter, document bridge, viewport revision, actual host dimensions, and DPR.
3. Gateway verifies connection/owned run and captures only that controller's known page. It verifies PNG dimensions against the reported host size and DPR, crops actual pixels to the app viewport when needed and stages the PNG under a generated filename.
4. Host rechecks document and geometry before requesting commit.
5. Gateway rechecks context, atomically renames the file, and records immutable attachment metadata. Only then does the test receive acknowledgement. Attachments are published with the accepted test result; interrupted runs discard unreported images.

Navigation, disposal, rerun, Stop, or changed geometry invalidates pending capture. Late results and partial files are discarded. Tests awaiting capture cannot finish before persistence. App APIs return native promises; unfinished operations at the test or cleanup boundary fail clearly, while explicitly caught failures remain catchable. Optional missing capability produces an explicit skipped image; provider failures remain failures.

A screenshot observes a rendered frame during the request. It doesn't freeze arbitrary async work, establish visual equality, or emulate a physical device. Playwright WebKit is labeled WebKit; Safari requires its own provider and environment validation.

## Tests and limits

Tests run actual CLI/app/browser workflows and assert real image dimensions and solid-color/canvas pixels. HTTP-gated Service Worker requests force navigation and host resize during capture, proving stale images are discarded. Real filesystem failures verify that optional capture doesn't swallow errors. Reporter tests exercise independent routes, messages, pause/continue, app preservation, and standalone Stop.

Same-origin frames isolate documents, styles, and globals; they share origin storage and can access one another intentionally. They aren't a security boundary against hostile app/test code. Storage and backend cleanup remain explicit project choices.
