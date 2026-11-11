import { fixtureOperationName, snapshotJson, readFixtureResponse, fixtureRequestLimit } from '../fixture-protocol.js';
/**
 * @api Application
 * Navigate and inspect your app from a test. Tests have their own context and read the app DOM directly. Fresh documents don't reset browser storage or backend data.
 */

/**
 * @api Application.goto
 * Navigate to a same-origin app path and wait for its document bridge. Then use Interactor to wait for the UI you care about.
 */

/**
 * Fetch options pass through, including `credentials: 'omit'` for API setup that should not change the browser session. Same-origin cookies are included by default. Dyno owns the cancellation signal.
 *
 * @api Application.request
 * Fetch a same-origin URL using the browser session and test cancellation signal. Returns a standard Response. Use this for your app's test-only fixture endpoints; keep database factories in your project.
 */

/**
 * Resize the actual managed viewport and wait for layout. Each dimension must be 1–16384 CSS pixels. Manual runs require the requested dimensions to already match.
 *
 * @api Application.setViewport
 */

/**
 * Save an exact PNG of the app, excluding the reporter. Full-page and element captures are supported. Required capture fails when unavailable; explicitly optional capture can skip.
 *
 * @api Application.screenshot
 */

/**
 * Open the reporter and suspend the execution deadline until Continue. Requires `--ui` or `--manual`. App timers and network work keep running; cleanup cannot pause.
 *
 * @api Application.pause
 */

/**
 * Read the current app document after navigation is ready. Resolve elements again after navigation.
 *
 * @api Application.document
 */

/**
 * Read the current app window. Browser APIs are available directly; use Interactor assertions for changing state.
 *
 * @api Application.window
 */

/**
 * @api Application.native
 * Use managed browser features such as native input and permissions. Required operations fail when unsupported.
 */

/**
 * App viewport dimensions in CSS pixels. Resizing changes the real viewport, so responsive layouts behave normally.
 *
 * @api Viewport
 */

/**
 * The managed browser and provider recorded with a screenshot. This identifies the capture environment, not a simulated device.
 *
 * @api BrowserIdentity
 */

/**
 * Saved PNG metadata, including the file path, image dimensions, pixel ratio, viewport and capture policy. Use the path from Node to publish an image to your visual service.
 *
 * @api CapturedScreenshot
 */

/**
 * An explicitly optional image that could not be captured. Read `reason`; storage or provider failures still fail the test.
 *
 * @api SkippedScreenshot
 */

/**
 * A captured PNG or an explicitly skipped optional image. Check `status` before consuming the path.
 *
 * @api Screenshot
 */

/**
 * Capture policy. Animations default to `allow`, caret to `initial`, and masks to opaque `#ff00ff`. Optional capture skips only when the capability is unavailable.
 *
 * @api ScreenshotRenderingOptions
 */

/**
 * Choose a viewport, full-page or element capture. Element capture cannot combine with `fullPage` or `mask`. Masks use elements from the current app document.
 *
 * @api ScreenshotOptions
 */

/**
 * @guide screenshots Screenshots
 * Wait for the UI you care about, then capture it:
 *
 * ```js
 * await I.find('Dashboard').visible();
 * let image = await app.screenshot('dashboard', { fullPage: true });
 * ```
 *
 * Managed browsers capture the original app page with the reporter hidden. The default is a viewport image; `fullPage: true` captures the whole page without changing its viewport. The result includes `path`, `url`, dimensions, and pixel ratio. Images appear in live and [saved reports](guide.md#saved-reports).
 *
 * ## Choose what to capture
 *
 * ```js
 * await app.screenshot('dashboard', {
 *   mask: [...app.document.querySelectorAll('[data-private]')],
 *   maskColor: '#ff00ff',
 *   animations: 'disabled',
 *   caret: 'hide',
 * });
 *
 * await app.screenshot('card', {
 *   element: await I.find('$(.card)'),
 * });
 * ```
 *
 * Masks cover current app elements in the PNG. `maskColor` takes an opaque `#RRGGBB` color. Element capture uses the element's document bounds, including content below the fold, without scrolling or resizing. Fractional edges round outward; element capture can't combine with `fullPage` or masks.
 *
 * Animations and carets stay unchanged by default. With suppression enabled, finite animations finish, infinite animations pause, and temporary styles are removed afterward. Dyno waits for fonts and checks the document and dimensions, but other app work can continue. Use Interactor to choose the state first.
 *
 * Always await captures and viewport changes. They run in order; navigation, Stop, resize, or lost ownership invalidates pending captures. Leaving operations unfinished fails the test or hook.
 *
 * ## Manual browsers
 *
 * URL-only runs can't take screenshots. Required captures fail. Use `{ optional: true }` only when the functional test is useful without an image; Dyno returns and reports a skipped image. Provider and storage errors still fail.
 *
 * Reported PNGs stay on disk after cleanup; interrupted runs discard unreported images. Capture metadata includes the browser/provider/version, viewport, and pixel ratio. Dyno saves attachments; your visual-comparison service owns baselines and diffs.
 */

/**
 * @guide viewport Viewport sizing
 * Managed runs start at 1280 × 800 CSS pixels. Set `viewport` in config or change it during a test:
 *
 * ```js
 * await app.setViewport({ width: 390, height: 844 });
 * ```
 *
 * The next test restores its default size. These dimensions change desktop layout; they don't emulate touch input, a phone's OS, or its physical screen.
 *
 * Manual runs use the actual window. A browser can't reliably resize its own tab, so a matching `app.setViewport` request succeeds and a different size fails. Fixed config dimensions must match too. Resize the window yourself or use a managed browser.
 */

/**
 * @guide debugging Editing and debugging
 * Keep the app and browser running while you change tests:
 *
 * ```sh
 * dyno --ui --watch
 * ```
 *
 * Edits to tests or imported helpers queue a rebuild. If a run is active, Dyno waits for it before running the latest code. A build error leaves the previous results available; fix the file to run again.
 *
 * Your app keeps its own hot reload. Restart Dyno after changing config or Node setup.
 *
 * ## Stop where the problem is
 *
 * ```js
 * await app.pause('Inspect this contact');
 * ```
 *
 * Use this in a test or setup hook with `--ui` or `--manual`. It opens the reporter immediately and suspends the test deadline. Continue hides the reporter and resumes the remaining budget.
 *
 * The app's timers and requests keep running. Cleanup cannot pause, and headless runs reject the call. For failures anywhere in a suite, use **Pause on failure** in the reporter.
 *
 * ## Check the setup first
 *
 * Run `dyno doctor` to check config, bundling, browser prerequisites and the app URL without launching anything. Add `--ui` or `--manual` to check that mode. The actual run still needs to start the server successfully.
 *
 * ## Type-check your tests
 *
 * Dyno transpiles TypeScript without checking it. Run your project's `tsc --noEmit`, using `moduleResolution: "Bundler"` for browser tests; Interactor's declarations don't currently support strict NodeNext checking. JavaScript editors use the same included types.
 *
 * To type values from Node setup, extend `Fixtures` in your project:
 *
 * ```ts
 * import 'dyno';
 *
 * declare module 'dyno' {
 *   interface Fixtures { contactId: string }
 * }
 * ```
 *
 * Config types work independently of the browser declarations.
 */

import { createNative } from './native.js';

function applyLayout(document, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let channel = new MessageChannel();
    let close = () => {
      channel.port1.close();
      channel.port2.close();
      signal.removeEventListener('abort', abort);
    };
    let abort = () => {
      close();
      reject(signal.reason);
    };
    channel.port1.onmessage = () => {
      close();
      try {
        signal.throwIfAborted();
        document.documentElement.getBoundingClientRect();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    channel.port2.postMessage(null);
  });
}

function renderingPreparation(document, policy, signal) {
  let roots = [document];
  for (let root of roots)
    for (let element of root.querySelectorAll('*'))
      if (element.shadowRoot) roots.push(element.shadowRoot);
  let cleanups = [];
  let resumed = new Set();
  let handled = new Set();
  let pending = new Set();
  let failure;
  let handleAnimations = () => {
    try {
      signal.throwIfAborted();
      for (let root of roots)
        for (let animation of root.getAnimations()) {
          if (
            handled.has(animation) ||
            !animation.effect ||
            animation.playbackRate === 0 ||
            animation.playState === 'finished'
          )
            continue;
          handled.add(animation);
          if (handled.size > 1000)
            throw new Error(
              'Screenshot animation handlers kept creating animations. Wait for the app to settle before capture.',
            );
          if (!Number.isFinite(animation.effect.getComputedTiming().endTime)) {
            animation.cancel();
            resumed.add(animation);
            continue;
          }
          let finished = new Promise((resolve) => {
            let done = () => {
              animation.removeEventListener('finish', done);
              animation.removeEventListener('cancel', done);
              signal.removeEventListener('abort', done);
              resolve();
            };
            animation.addEventListener('finish', done, { once: true });
            animation.addEventListener('cancel', done, { once: true });
            signal.addEventListener('abort', done, { once: true });
            cleanups.push(done);
            try {
              animation.finish();
            } catch {
              done();
            }
          });
          pending.add(finished);
          finished.then(() => pending.delete(finished));
        }
    } catch (error) {
      failure = error;
    }
  };
  return {
    async prepare() {
      if (policy.caret === 'hide')
        for (let root of roots) {
          let style = document.createElement('style');
          let nonce = document.querySelector('style[nonce],script[nonce]')?.nonce;
          if (nonce) style.nonce = nonce;
          style.textContent = '*,*::before,*::after{caret-color:transparent!important}';
          (root === document ? document.documentElement : root).append(style);
          cleanups.push(() => style.remove());
          if (!style.sheet)
            throw new Error(
              'The app Content Security Policy blocked screenshot styling. Use an explicit test policy or keep the caret unchanged.',
            );
        }
      if (policy.animations !== 'disabled') return;
      if (typeof document.getAnimations !== 'function')
        throw new Error(
          'This browser cannot disable animations for screenshots. Keep animations unchanged or use a browser with the Web Animations API.',
        );
      for (let root of roots) {
        root.addEventListener('animationstart', handleAnimations);
        root.addEventListener('transitionrun', handleAnimations);
        cleanups.push(() => {
          root.removeEventListener('animationstart', handleAnimations);
          root.removeEventListener('transitionrun', handleAnimations);
        });
      }
      for (let pass = 0; pass < 20; pass++) {
        handleAnimations();
        if (failure) throw failure;
        let count = handled.size;
        await Promise.all(pending);
        await applyLayout(document, signal);
        handleAnimations();
        if (failure) throw failure;
        if (handled.size === count && pending.size === 0) return;
      }
      throw new Error(
        'Screenshot animation handlers kept creating animations. Wait for the app to settle before capture.',
      );
    },
    restore() {
      for (let cleanup of cleanups.reverse()) cleanup();
      for (let animation of resumed)
        try {
          animation.play();
        } catch {}
    },
  };
}

function capturePolicy(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('Screenshot options must be an object.');
  let fullPage = options.fullPage ?? false;
  let animations = options.animations ?? 'allow';
  let caret = options.caret ?? 'initial';
  let color = options.maskColor === undefined ? '#ff00ff' : options.maskColor;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('Screenshot maskColor must be an opaque #RRGGBB color.');
  let maskColor = Object.freeze(
    [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)).concat(255),
  );
  if (
    typeof fullPage !== 'boolean' ||
    !['allow', 'disabled'].includes(animations) ||
    !['initial', 'hide'].includes(caret)
  )
    throw new Error(
      'Screenshot options require fullPage:boolean, animations:allow|disabled, and caret:initial|hide.',
    );
  if (options.mask !== undefined && !Array.isArray(options.mask))
    throw new Error('Screenshot masks must be an array of elements from the current app document.');
  if (
    options.element !== undefined &&
    (options.fullPage !== undefined || options.mask !== undefined)
  )
    throw new Error('Element screenshots cannot also specify fullPage or mask.');
  return Object.freeze({
    fullPage: options.element !== undefined || fullPage,
    animations,
    caret,
    maskColor,
  });
}

function elementClip(element, document, metrics) {
  if (element?.nodeType !== 1 || element.ownerDocument !== document || !element.isConnected)
    throw new Error('Element screenshots need a connected element from the current app document.');
  let box = element.getBoundingClientRect();
  let window = document.defaultView;
  let left = Math.floor(box.left + window.scrollX),
    top = Math.floor(box.top + window.scrollY);
  let right = Math.ceil(box.right + window.scrollX),
    bottom = Math.ceil(box.bottom + window.scrollY);
  if (
    ![left, top, right, bottom].every(Number.isSafeInteger) ||
    box.width <= 0 ||
    box.height <= 0 ||
    left < 0 ||
    top < 0 ||
    right > metrics.fullWidth ||
    bottom > metrics.fullHeight ||
    right <= left ||
    bottom <= top
  )
    throw new Error('Element screenshot bounds must fit inside the current app document.');
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

function maskRectangles(elements, document, policy, metrics) {
  let window = document.defaultView;
  let width = policy.fullPage ? metrics.fullWidth : window.innerWidth;
  let height = policy.fullPage ? metrics.fullHeight : window.innerHeight;
  return (elements ?? []).flatMap((element) => {
    if (element?.nodeType !== 1 || element.ownerDocument !== document || !element.isConnected)
      throw new Error('Screenshot masks must be connected elements from the current app document.');
    let box = element.getBoundingClientRect();
    let x = box.left + (policy.fullPage ? window.scrollX : 0);
    let y = box.top + (policy.fullPage ? window.scrollY : 0);
    let left = Math.max(0, x),
      top = Math.max(0, y),
      right = Math.min(width, x + box.width),
      bottom = Math.min(height, y + box.height);
    return right > left && bottom > top
      ? [Object.freeze({ x: left, y: top, width: right - left, height: bottom - top })]
      : [];
  });
}

/**
 * Call a named fixture in this worker's actual app process. Dyno supplies the execution capability, bounded JSON, cancellation, and a named timing step. Configure the optional fixture controller through beforeExecution. Omitted input is null. Calls never retry or follow redirects; abort cannot undo a committed write. Await every call before finishing the test or hook.
 *
 * @api Application.fixture
 */
export function createApp(
  appWindow,
  readState,
  signal,
  navigate,
  operation,
  pause,
  supportsCapture,
  measure,
  nativeCapabilities,
  fixtureTransport,
  fixtureStep = (name, work) => measure('step', name, work),
) {
  let captures = Promise.resolve();
  return Object.freeze({
    native: createNative({
      appWindow,
      readState,
      signal,
      operation,
      measure,
      capabilities: nativeCapabilities,
    }),
    goto: (path) =>
      measure('navigation', new URL(path, location.origin).pathname, () => navigate(path)),
    pause: (message) => measure('pause', 'Debug pause', () => pause(message)),
    setViewport: (viewport) =>
      measure('viewport', `${viewport?.width} × ${viewport?.height}`, () =>
        operation({ operation: 'viewport', viewport }, undefined, (result) =>
          Object.freeze(result.viewport),
        ),
      ),
    screenshot: (name, options = {}) =>
      measure('screenshot', name, () => {
        let policy = capturePolicy(options);
        let previous = captures;
        let restore = () => {};
        let captured = operation(
          { operation: 'screenshot', name, optional: options.optional },
          async () => {
            await previous;
            signal.throwIfAborted();
            let document = readState().readyDocument;
            let documentId = readState().readyId;
            let current = () => {
              signal.throwIfAborted();
              if (
                !document ||
                document !== appWindow.document ||
                readState().readyDocument !== document ||
                readState().readyId !== documentId ||
                appWindow.__browserTestBridge?.id !== documentId ||
                appWindow.location.pathname === '/__dyno__/blank'
              )
                throw new Error(
                  'Load the app before requesting a screenshot, and keep its document open until capture finishes.',
                );
            };
            current();
            if (supportsCapture) {
              await operation({ operation: 'activate' });
              current();
            }
            await document.fonts.ready;
            current();
            if (supportsCapture) {
              let preparation = renderingPreparation(document, policy, signal);
              restore = preparation.restore;
              await preparation.prepare();
            }
            current();
            let html = document.documentElement,
              body = document.body;
            let metrics = Object.freeze({
              fullWidth: Math.ceil(
                Math.max(
                  appWindow.innerWidth,
                  html.scrollWidth,
                  html.offsetWidth,
                  body?.scrollWidth ?? 0,
                  body?.offsetWidth ?? 0,
                ),
              ),
              fullHeight: Math.ceil(
                Math.max(
                  appWindow.innerHeight,
                  html.scrollHeight,
                  html.offsetHeight,
                  body?.scrollHeight ?? 0,
                  body?.offsetHeight ?? 0,
                ),
              ),
            });
            return {
              documentId,
              metrics,
              options: Object.freeze({
                ...policy,
                ...(options.element !== undefined
                  ? { clip: elementClip(options.element, document, metrics) }
                  : {}),
                mask: Object.freeze(maskRectangles(options.mask, document, policy, metrics)),
              }),
            };
          },
          (result) => Object.freeze(result),
        );
        let result = captured.finally(() => restore());
        captures = result.catch(() => {});
        return result;
      }),
    get document() {
      signal.throwIfAborted();
      try {
        let state = readState();
        let document = appWindow.document;
        if (
          state.readyDocument === document &&
          state.readyId === appWindow.__browserTestBridge?.id &&
          appWindow.location.pathname !== '/__dyno__/blank'
        )
          return document;
      } catch {
        throw new Error(
          'The app navigated cross-origin. This framework requires a cooperating app on the test gateway origin.',
        );
      }
      throw new Error('App document is navigating or its startup bridge has not loaded.');
    },
    get window() {
      signal.throwIfAborted();
      return appWindow;
    },
    fixture: (name, input = null) => {
      signal.throwIfAborted();
      fixtureOperationName(name);
      if (!fixtureTransport) throw new Error('This project has no execution fixture transport. Configure beforeExecution with a fixture controller.');
      let body = JSON.stringify(snapshotJson({ scope: fixtureTransport.scope, name, input }, { maxBytes: fixtureRequestLimit }));
      return fixtureStep(`Fixture ${name}`, async () => {
        let response = await measure('request', `POST ${fixtureTransport.path}`, () =>
          fetch(fixtureTransport.path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body, credentials: 'same-origin', redirect: 'error', signal,
          }));
        let result = await readFixtureResponse(response);
        signal.throwIfAborted();
        if (!result || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'value'))
          throw new Error('The fixture server returned an invalid result envelope.');
        return result.value;
      });
    },
    request: (path, init = {}) => {
      let url = new URL(path, location.origin);
      if (url.origin !== location.origin)
        throw new Error('app.request requires a same-origin path.');
      return measure('request', `${init.method ?? 'GET'} ${url.pathname}`, () =>
        fetch(url, { credentials: 'same-origin', ...init, signal }),
      );
    },
  });
}
