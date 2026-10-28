# Screenshot research

Dyno keeps tests in the browser and uses an optional provider for real screenshots. The [architecture](../architecture.md) and [guide](../guide.md#screenshots) describe the implementation.

## What we learned

- DOM interaction and assertions can stay local. Drivers only need to manage the browser window and capture pixels.
- Moving an iframe offscreen or scaling it can change layout and visibility behavior. Capturing it can also include the reporter.
- Keep the app unscaled at the viewport origin. Hide the sibling reporter during execution and capture; open it for paused inspection.
- A successful capture command can return pixels from a later document. Check ownership, document identity, viewport, and persistence before accepting an attachment.
- Local iframe sizing handles responsive layout. It doesn't emulate a physical screen, touch input, or device pixel ratio.
- Playwright covers its engine builds and branded Chrome/Edge. WebDriver provides a path to installed Firefox and Safari. WebKit isn't Safari.

Real browser tests check canvas/background pixels, image dimensions, DPR 2, resize without navigation, manual/managed separation, navigation races, and interrupted capture cleanup. Safari capture, physical-device capture, and Windows providers still need verification.

## Browser-only alternatives

Canvas export reads an existing canvas; it doesn't capture arbitrary DOM. DOM-to-image libraries reconstruct a page and can miss browser rendering and cross-origin content. Neither gives us a reliable screenshot of an unchanged app.

[Screen sharing](https://w3c.github.io/mediacapture-screen-share/) can provide real pixels after user interaction and permission to capture a chosen surface. That could support an interactive provider later. Surface selection and app-only cropping still need browser-specific verification, so it isn't the unattended fallback.

Browser-specific DOM capture APIs and extensions would add installation and maintenance requirements. Keep those separate from the URL-only runner rather than making them a requirement for tests.

The regression tests live in [tests/capture.test.js](../../tests/capture.test.js) and [tests/reporter.test.js](../../tests/reporter.test.js). They replace the temporary spike scripts as the reproducible checks.
