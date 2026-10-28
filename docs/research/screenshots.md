# Screenshot research

Updated October 28, 2026. The browser-control and iframe spikes are now implemented. [Architecture](../architecture.md), [browser setup](../browsers.md), and the [guide](../guide.md#screenshots) describe the actual API.

## What shaped the implementation

- Tests, DOM actions, convergence, and assertions stay in the browser. An optional controller handles launch, host sizing, and actual pixels.
- Playwright covers managed engine builds and branded Chrome/Edge. Stock Firefox and actual Safari use WebDriver. WebKit isn't Safari; no automatic substitution hides that distinction.
- A screenshot of a parked or scaled iframe is unreliable. Chrome captured reporter pixels at negative offscreen coordinates, and showing the app changed IntersectionObserver behavior.
- A sibling reporter overlay preserves app dimensions and document identity, verified in Chrome/WebKit. It still appears in screenshots while covering the app, including captures targeting the execution iframe. Keep it hidden during execution/capture and open it for paused inspection.
- A successful driver command can return another document's pixels. Capture requires local document/viewport checks, explicit ownership, and persistence acknowledgement before test teardown.
- Local iframe sizing changes responsive layout without a driver. Physical screen, DPR, touch, browser chrome, and real-device behavior are separate capabilities.

The seven-lane swarm tested Playwright, WebDriver, browser-only APIs, geometry, lifecycle, API behavior, and navigation races. Real proofs covered exact canvas/background pixels, DPR 1/2, resize without reload, manual/managed separation, and late-result rejection. Actual Safari capture wasn't verified: this Mac refused automation because Remote Automation is disabled. Physical devices and Windows provider capture remain unverified.

## Browser-only capture

Ordinary canvas export reads canvas content; it cannot export arbitrary DOM. DOM exporters reconstruct an image and can fail on cross-origin canvas content. They aren't a transparent screenshot fallback.

[Screen sharing](https://w3c.github.io/mediacapture-screen-share/) can supply real pixels after a real gesture and chosen surface. One sharing session can supply multiple images, but permission doesn't persist and app-only cropping isn't universal. Current compatibility data lists iOS 27 support; physical-device verification is still needed. Keep a possible interactive provider separate from unattended capture.

[HTML-in-Canvas](https://developer.chrome.com/blog/html-in-canvas?hl=en) is an emerging Chrome path, not established cross-browser support for untouched app iframes. Extensions add installation, permissions, release maintenance, and device gaps. Neither belongs in this first implementation.

## Evidence

Disposable artifacts remain at `/private/tmp/dyno-driver-swarm-M4Kckc/`, with one report and runnable proof per lane. The sibling-overlay follow-up lives at `/private/tmp/dyno-overlay-spike-JMby7v/`. Earlier platform/DOM/CDP evidence remains at `/private/tmp/dyno-screenshots-ipN38E/`.

The old Chromium-only recommendation is superseded. Production regression tests now live in the repository; temporary artifacts aren't required to verify the shipped behavior.
