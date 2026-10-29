# Screenshot research

Keep the app in the original top-level window. Run tests in a persistent companion window, with a fresh hidden runtime iframe for each test. The reporter is an iframe over the app, hidden during capture. This gives providers a real page to capture while tests and Interactor stay in the browser.

The [architecture](../architecture.md) describes ownership and cancellation. The [guide](../guide.md#screenshots) covers the API; [browser setup](../browsers.md#known-limits) lists verification gaps.

## Why we changed the window layout

A nested iframe can produce a full-height PNG without rendering the whole app. Our 800 × 600 app had 3000px of colored content. Chrome and WebKit returned 800 × 3000 images from iframe element screenshots, but everything below 600px was white or transparent. Chromium's capture-beyond-viewport command had the same clipping. Checking image dimensions alone would have missed the lost coverage.

Expanding the iframe would change media queries, fixed positioning, and the viewport under test. Scroll stitching and DOM reconstruction also change capture semantics. We chose a top-level app so full-page capture can preserve the actual viewport and browser rendering.

## What the spikes proved

| Check | Result |
| --- | --- |
| Nested iframe, Chrome and WebKit | Full-height PNG; missing pixels below the iframe viewport |
| Top-level app, Chrome and WebKit | 800 × 3000 PNG with every content band and mask; viewport stayed 800 × 600 |
| App-first companion, Chrome and WebKit | Browser-local Interactor survived full app navigation; reporter stayed out of captures |
| App/controller close and reload, Chrome and WebKit | Pending HTTP work canceled, stale messages rejected, fresh-run recovery worked |
| Project storage cleanup | `window.name` binding survived `sessionStorage.clear()`, app navigation, and reload |
| Normal Chrome popup policy | Automatic open was blocked; an explicit launch gesture recovered |
| WebDriver Chrome | Real full-page pixels verified without expanding the viewport |
| WebDriver Firefox 159 beta | Full-page pixels, viewport sizing, and masks passed; installed Firefox 158 failed initialization |

The implementation also passed the local framework suite and capture regressions through Playwright Chrome/WebKit and WebDriver Chrome/Firefox 159 beta. Those checks cover pixels, masks, sizing, navigation, interruption, and animation cleanup. They do not establish every browser or device. Safari viewport capture, Windows providers, and companion execution on phones, iOS, and TVs still need verification. WebKit results do not establish Safari behavior.

## Capture and recovery rules

Providers keep the original app page or window handle. They never choose the active tab or the latest popup. Playwright uses its screenshot API; WebDriver Chrome, Edge, and Firefox use BiDi viewport or document capture. WebDriver Safari rejects full-page capture clearly.

Screenshots support app-element masks, animation suppression, and caret hiding. Dyno finishes finite animations and suspends infinite ones before measuring the document and masks. It restores capture styles and restarts suspended animations afterward. Document identity, viewport, ownership, and saved pixels still need checking before accepting an attachment. Navigation or cancellation discards stale results and partial files.

Keep both windows open. App navigation replaces its document while the companion retains test execution. Closing or reloading the companion destroys that JavaScript stack; start a fresh run. Unload messages are best effort, so connection loss and bounded execution deadlines also cancel work. A private window name routes the initial binding; origin, exact source, run, execution, and document checks decide which messages to accept.

Without a managed provider, tests use the actual app viewport. They cannot request a different window size or take screenshots. Matching size requests can succeed; unsupported required operations fail clearly. Dyno matches the app’s startup opener/embedder policies on its own documents. Cross-origin navigation or policy changes that sever the relationship during a run remain unsupported.

## Browser-only alternatives

Canvas export reads an existing canvas, not arbitrary DOM. DOM-to-image libraries reconstruct a page and can miss native rendering or cross-origin content. Neither captures an unchanged app reliably.

[Screen sharing](https://w3c.github.io/mediacapture-screen-share/) can provide real pixels after user interaction and surface selection. It could support an interactive provider later, but is not an unattended fallback. Browser-specific extensions would add installation and maintenance requirements; they should remain optional.

The reproducible regression checks belong in [capture tests](../../tests/capture/screenshots.test.js) and [reporter tests](../../tests/browser/reporter.test.js), rather than temporary spike scripts. URL-only execution across modern browsers remains the goal; broad device support still needs real-device checks.
