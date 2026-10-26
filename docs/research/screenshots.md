# Screenshots in Dyno

Research, October 25, 2026. Screenshot support is **not implemented**. Three independent lanes tested the web platform, DOM export, and an adapter for a browser Dyno launches.

## The direction

Start with an optional Chromium capture adapter. Tests, interactions, and assertions keep running in the browser. Node asks Chromium for rendered pixels when a test explicitly requests an image.

That adds a privileged browser protocol connection for capture and launcher setup. We should say that plainly. It doesn't move DOM queries or actions into Node. Manual browsers keep running functional tests; an explicit screenshot request fails clearly when capture isn't available.

## What we verified

| Approach | Result | First cut? |
| --- | --- | --- |
| Native web capture | Chrome exposed the APIs in all three frames. Synthetic clicks stayed untrusted and created no activation. An automatic capture attempt remained pending until the experiment's deadline; no permission or pixels were obtained. | Later, interactive manual mode |
| DOM export | `html-to-image@1.11.13` preserved simple CSS, canvas pixels, and live input state across frames. A canvas containing a loaded cross-origin image rejected export with `SecurityError`. | Keep separate from screenshots |
| Chromium adapter | Chrome 155 captured a nested app's rendered canvas and background, excluding the runner and iframe borders. DPR 1 produced 320×180 pixels; DPR 2 produced 640×360. | Yes, optional |

[Screen Capture requires activation and fresh user selection](https://w3c.github.io/mediacapture-screen-share/#dom-mediadevices-getdisplaymedia). [Region Capture](https://developer.chrome.com/docs/web-platform/region-capture) and [Element Capture](https://developer.chrome.com/docs/web-platform/element-capture) transform an already-authorized stream. They don't provide unattended permission. Native capture is the strongest URL-only alternative, but it needs an explicit user setup step.

[DOM exporters reconstruct an image](https://html2canvas.hertzen.com/documentation/). Useful, but a successful export still doesn't establish screenshot fidelity. We shouldn't silently substitute that output.

The adapter used [CDP screenshot capture](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl). Actions stayed local; no protocol DOM, Input, or Runtime evaluation commands drove the test. A below-viewport variation returned runner-colored pixels with `captureBeyondViewport: false`; enabling it captured the expected app pixels. That case and the DOM experiment passed again during review. This proves a narrow Chromium path, not full-page or cross-browser support.

## The first API

Proposed, not available yet:

```js
// Enable capture in dyno.config.js:
// screenshots: true

test('opens the dashboard', async ({ app, I }) => {
  await app.goto('/dashboard');
  await I.find('Dashboard').visible();
  await app.screenshot('dashboard');
});
```

Start with PNGs of the app viewport, normal zoom, and fixed frame dimensions. Record browser version, viewport, and pixel ratio with each image. An image is an attachment; baseline comparison can come later.

## Implementation order

1. **Owned browser capture:** add `src/capture.js` and extend `src/launcher.js` behind the config flag. Use the existing disposable profile, a loopback debugger endpoint, and one known page target. Close everything through existing cleanup. [Chrome requires a separate profile for remote debugging](https://developer.chrome.com/blog/remote-debugging-port).
2. **Stable app viewport:** update layout in `src/server.js` and geometry handling in `src/browser/shell.js`. Runner logs must not change app dimensions. Compute the content rectangle through both iframe ancestors, including borders and scrolling. Capture with `fromSurface: true`, `captureBeyondViewport: true`, and clip scale 1. Reject unsupported geometry; this flag doesn't capture the full app document.
3. **Request and acknowledgement:** add `app.screenshot` through `src/browser/app.js` and `runtime.js`. Bind each request to the launcher's target, run, test, document bridge ID, and request ID. The shell validates its active frame, forwards the request, and holds disposal until storage succeeds or a bounded capture deadline fails. Recheck document and geometry before accepting the image; discard stale captures.
4. **Artifacts and reporting:** extend `src/server.js`, `src/run.js`, and the CLI. Generate filesystem names in Node, store immutable attachment metadata, and finish writes before reporting completion or closing the browser. Manual captures must never borrow another browser's adapter. Capture errors must preserve an existing test failure.
5. **Real tests:** verify exact pixels at DPR 1/2, runner exclusion, scrolling, growing logs, navigation during capture, stale/duplicate requests, missing capability, lost connection, deadline handling, and process cleanup. Require an explicit unsupported error in manual mode.

Full-document stitching, element screenshots, browser extensions, automatic failure capture, and visual baselines stay outside this cut. Automatic failure capture needs a point before hooks erase the failed UI and before the shell removes frames. Today's shell disposes them immediately (`src/browser/shell.js:61–66`).

Remaining limits: zoom, transformed/clipped ancestors, cross-origin subframes, animations, and GPU content beyond the tested canvas. Keep these outside the initial guarantee; add focused browser cases before widening it.

## Disposable evidence

Preserved locally at `/private/tmp/dyno-screenshots-ipN38E/`; no prototype code entered the runtime.

- `platform/report.md`, `probe.js`, `results.json`, `activation-attempt.js`: API and activation receipts.
- `dom/report.md`, `spike.js`, `result.json`, `clean-export.png`: clean export and tainted-canvas failure.
- `adapter/report.md`, `spike.js`, `result-1.json`, `result-2.json`, `result-1-offscreen-beyond.json`, `offscreen.log`, `app.png`: pixel assertions and protocol calls.

Reproduce with `node <lane>/spike.js` for DOM/adapter, or `node <lane>/probe.js` for platform. The adapter's decisive variant is `OFFSCREEN=1 BEYOND=1 node <adapter>/spike.js`; DPR 2 uses `SCALE=2`. Each lane's report includes exact paths and setup.
