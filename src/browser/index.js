/**
 * Navigate, make session requests, capture images and inspect the current app window.
 *
 * @api TestContext.app
 */

/**
 * Interactor rooted in the current app document. Bind custom interactors to this instance.
 *
 * @api TestContext.I
 */

/**
 * JSON-safe values returned by project setup. These are visible to browser code.
 *
 * @api TestContext.fixtures
 */

/**
 * Cancellation for this test or hook. Cleanup receives a fresh signal and its own budget.
 *
 * @api TestContext.signal
 */

/**
 * The current test’s stable ID, file, suite path, name and declared resources.
 *
 * @api TestContext.test
 */

/**
 * Dyno starts your app, bundles tests, and serves a URL. Tests and Interactor.js run in that browser. The CLI reports results and stops the processes it owns.
 *
 * You'll need Node 24+. Playwright Core is included. Dyno isn't published to npm yet; install it from GitHub.
 *
 * [Write your first test](guide.md#add-it-to-an-app). Run it headlessly, inspect it in the browser, or open the URL yourself on another device.
 *
 * ## Keep the app in view
 *
 * The app gets its full viewport. Tests stay in a companion window while the app navigates. Open the reporter when you need output, screenshots or timings.
 *
 * ## Know what ran
 *
 * Named suites, real app workflows and recorded timings make failures easier to understand. Project setup owns databases and fixtures. Dyno owns the run and cleans up the processes it starts.
 *
 * This is the documentation for the version shown above. Next follows development; release versions keep the docs built from that exact tag.
 *
 * @guide overview Browser tests, in the browser
 */

/**
 * Tests run in the browser. Configuration and project setup run in Node. Use the guides to start a project; use this reference to look up arguments, return values and browser capabilities.
 *
 * Start with [describe](api/dyno/variables/describe/) and [test](api/dyno/variables/test/), then look up what you need:
 *
 * - [TestContext](api/dyno/interfaces/testcontext/): the values passed to tests and hooks.
 * - [Application](api/dyno/interfaces/application/): navigation, requests, screenshots and browser access.
 * - [defineInteractor](api/dyno/functions/defineinteractor/): reusable component actions and assertions.
 * - [Config](api/config/interfaces/config/): app server and run settings.
 * - [ProjectSetup](api/config/interfaces/projectsetup/): shared setup and private worker resources.
 *
 * @guide api-overview API reference
 */

/**
 * The browser context passed to a test or hook. `I` resolves against the current app document; fixtures are JSON-safe data supplied by Node setup.
 *
 * @api TestContext
 */

/**
 * Name meaningful work in the timing report. Await it; it returns the callback’s value and preserves its error. Use it in hooks too. Keep secrets out of step names.
 *
 * @api TestContext.step
 */

/**
 * Browser-visible JSON-safe values from project setup. Extend this interface in your app to type fixture IDs and paths. Never put production credentials in fixtures.
 *
 * @api Fixtures
 */

/**
 * Dyno tests web UI. Native iOS and macOS interfaces keep their platform UI tests.
 *
 * The runner uses ES2022 syntax and modern APIs, including `AbortSignal.timeout`, `AbortSignal.any`, `Promise.withResolvers`, `crypto.getRandomValues`, and `EventSource`. Older browsers, including historical WebOS builds, need compatibility work. See [browser setup](browsers.md#known-limits) for verification gaps.
 *
 * Ordinary Interactor actions use DOM methods and synthetic events. Use explicit native actions when a workflow needs browser defaults or trusted input. Closed shadow roots, downloads, video capture, visual baselines and HTTPS gateway serving are outside this version. Companion popups and background execution on iOS, phones, and TVs still need real-device verification; URL-only execution across browsers remains the goal.
 *
 * The gateway uses HTTP. Secure cookies and secure-context-only features may need a different test origin. Cooperating HTML routes, including test fixtures, need the same opener and agent-cluster isolation headers as the app; changing them can sever the companion even on the same origin. The app and test contexts share an origin and aren't a security sandbox. An infinite loop can freeze the browser; the Node deadline can stop a browser it owns but can't recover a manual browser's event loop.
 *
 * The gateway rejects unknown Host headers and foreign WebSocket origins. Event and command requests are limited to 1 MB. Observers stream large views in bounded records; a slow reader can be disconnected without losing accepted results or saved output. Active browser runs are limited to 20. New joins fail at capacity; finished runs can be removed to make room.
 *
 * @guide limits Current limits
 */

export { Interactor, defineInteractor } from './interactor.js';
export { describe, test, beforeEach, afterEach } from './registry.js';
