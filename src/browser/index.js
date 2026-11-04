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
 * @guide overview Browser tests, in the browser
 * Write a test the way you'd use your app: open a page, fill in a field, and check what changed. Dyno runs that JavaScript in the browser, with Interactor handling DOM interaction and waiting for the UI.
 *
 * You get the browser APIs you already know and its devtools for debugging. The CLI starts your app, opens a browser, and reports the results.
 *
 * ## Write your first test
 *
 * Give Dyno your app's command and URL, then pick one workflow to test. [The setup guide](guide.md#write-your-first-test) walks through it. You'll need Node 24+; Playwright Core is included.
 *
 * ## See what happened
 *
 * Run `dyno --ui` to keep the app open. Bring up the reporter to read failures, console output, screenshots and timings. The app keeps its full viewport while you inspect it.
 *
 * You can also open the test URL yourself in another browser. [Browser setup](browsers.md) explains what's available in managed and manual runs.
 */

/**
 * @guide api-overview API reference
 * Write tests with browser APIs; configure the app and its resources in Node. This reference covers arguments, return values, and available capabilities. Start with the [first test guide](guide.md#write-your-first-test) if you're setting up a project.
 *
 * - [describe](api/dyno/variables/describe/) and [test](api/dyno/variables/test/) organize your tests.
 * - [TestContext](api/dyno/interfaces/testcontext/) has the values passed to tests and hooks.
 * - [Application](api/dyno/interfaces/application/) handles navigation, requests, screenshots, and browser access.
 * - [defineInteractor](api/dyno/functions/defineinteractor/) creates reusable component actions and assertions.
 * - [Config](api/config/interfaces/config/) sets up your app server and test run.
 * - [ProjectSetup](api/config/interfaces/projectsetup/) prepares shared and private worker resources.
 */

/**
 * @api TestContext
 * The values you receive in a test or hook. Use `app` for navigation and browser access, `I` for interaction, and `step` to name work in reports.
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
 * @guide limits Current limits
 * Dyno tests web UI. Keep platform UI tests for native iOS and macOS apps, and real-device checks for behavior a desktop viewport can't prove.
 *
 * ## Browser support
 *
 * The runner needs ES2022 and modern APIs: `AbortSignal.timeout`, `AbortSignal.any`, `Promise.withResolvers`, `crypto.getRandomValues`, and `EventSource`. Older browsers, including historical WebOS builds, need compatibility work. Phones, iOS, and TVs still need verification of companion popups and background execution. See [browser setup](browsers.md#known-limits).
 *
 * Ordinary Interactor actions use DOM methods and synthetic events. Use explicit native actions for browser defaults or trusted input. Closed shadow roots, downloads, video, visual baselines, and HTTPS gateway serving are outside this version.
 *
 * ## App origins and isolation
 *
 * The gateway uses HTTP. Secure cookies and secure-context features may need a different test origin. HTML routes, including fixtures, need the app's opener and agent-cluster isolation headers; changing policy can disconnect the companion even on the same origin.
 *
 * Avoid changing `window.name` during a run; Dyno uses it to keep the companion connected. Tests and app code have separate contexts but share an origin. This isn't a security sandbox. An infinite loop can freeze the browser; Node can stop a managed browser, but can't recover a manual browser's event loop.
 *
 * ## Run limits
 *
 * The gateway rejects unknown Host headers and foreign WebSocket origins. Event and command requests have a 1 MB limit. Large observer views stream in bounded records; a slow reader may disconnect without losing accepted results or saved output.
 *
 * Up to 20 browser runs can be active. Dyno drops finished runs as new ones join. If all 20 are still active, finish or close one before joining again.
 */

export { Interactor, defineInteractor } from './interactor.js';
export { describe, test, beforeEach, afterEach } from './registry.js';
