/**
 * The current app window and the operations Dyno owns. Tests run in a separate context and read the app DOM directly. Fresh documents do not reset browser storage or backend data.
 *
 * @api Application
 */

/**
 * Navigate to a same-origin app path and wait for its document bridge. Use Interactor to wait for the UI you care about after navigation.
 *
 * @api Application.goto
 */

/**
 * Make a same-origin fetch with the browser session and test cancellation signal. Returns a standard Response. Call your app’s test-only fixture endpoints here; Dyno does not own database factories.
 *
 * @api Application.request
 */

/**
 * Resize the actual managed viewport and wait for layout. Each dimension must be 1–8192 CSS pixels. Manual runs require the requested dimensions to already match.
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
 * Explicit managed browser capabilities. Unsupported required operations fail clearly; there is no synthetic fallback.
 *
 * @api Application.native
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
 * Managed runs include screenshots and window sizing through Playwright Core. [Download a browser build](browsers.md) once with `dyno install`; no extra dependency is needed. Manual URL-only runs have neither capability.
 *
 * ```js
 * export default {
 *   browser: { name: 'chromium' },
 *   viewport: { width: 1280, height: 800 },
 *   artifactsDir: '.dyno/artifacts',
 *   webServer: {
 *     command: 'npm run dev',
 *     url: 'http://127.0.0.1:3000'
 *   }
 * };
 * ```
 *
 * ```js
 * await I.find('Dashboard').visible();
 * let image = await app.screenshot('dashboard', {
 *   fullPage: true,
 *   mask: [...app.document.querySelectorAll('[data-private]')],
 *   animations: 'disabled',
 *   caret: 'hide'
 * });
 * // image.path, image.url, image.width, image.height, image.pixelRatio
 * ```
 *
 * Dyno captures the original app window with the reporter hidden. By default it captures the viewport; `fullPage: true` captures the whole page without enlarging the viewport. It waits for fonts, checks the document and dimensions, and saves the PNG before resolving. Navigation, Stop, resize, or lost ownership invalidates pending captures. Screenshot and viewport requests run in order; finishing a test or hook with unfinished operations fails clearly. Await both APIs.
 *
 * In a manual run, required capture fails. Use `await app.screenshot('dashboard', { optional: true })` only when the functional test is useful without an image. It returns and reports a skipped image when capture is unavailable. Provider and storage errors still fail.
 *
 * Reported images remain on disk after cleanup. Interrupted runs discard images that weren't reported. JSON attachment events and test results include the path, browser/provider/version, viewport, and pixel ratio. The reporter links to the PNG while the gateway is running.
 *
 * For one element, use `app.screenshot('card', { element: await I.find('$(.card)') })`. It captures the element's document bounds, including content below the fold, without scrolling or resizing. Fractional edges round outward. Element capture cannot combine `fullPage` or `mask`.
 *
 * Capture options are `fullPage` (default `false`), `mask` (an array of app `Element` objects), `animations` (`'allow'` or `'disabled'`, default `'allow'`), and `caret` (`'initial'` or `'hide'`, default `'initial'`). `maskColor` accepts an opaque `#RRGGBB` color (default `#ff00ff`). Masks cover those elements in the PNG; pass current elements from the app document. All managed targets support full-page capture.
 *
 * Screenshots are attachments, without baseline comparison. They record a rendered frame during the request; they don't freeze other app work. Animation suppression finishes finite animations and suspends infinite ones before measuring the document and masks. Temporary styles are removed and suspended animations restart afterward. Use Interactor to wait for the state you want first.
 *
 * @guide screenshots Screenshots
 */

/**
 * Manual runs use the app window's actual viewport. Managed runs default to 1280 × 800 CSS pixels. Set `viewport` in config for fixed dimensions, or await `app.setViewport({ width: 390, height: 844 })` within a managed test. The next test restores its default size.
 *
 * A browser page cannot reliably resize its own tab. Without a managed provider, a matching `app.setViewport` call is a no-op and any different size fails clearly. A fixed config size must also match the actual window. Resize it yourself or use a managed run; Dyno does not fake a viewport with an app iframe.
 *
 * These are layout dimensions, not phone emulation. They don't set touch input, OS orientation, or physical screen size. A mobile-sized desktop viewport does not prove real-device behavior.
 *
 * @guide viewport Viewport sizing
 */

/**
 * `dyno doctor` checks config, bundles tests, checks the selected Playwright build or executable, and checks the app URL without launching anything. It validates headless mode by default; add `--ui` for a visible browser or `--manual` for a URL-only setup. It cannot prove that a configured server command starts successfully; the run checks its output and HTTP readiness.
 *
 * `--watch` keeps the app server and browser session alive. It watches test files and imported project helpers using filesystem events. Edits during a run queue one rebuild of the latest files. Build errors leave the previous results available; fixing the file runs again. Config and Node setup changes need a CLI restart. App code keeps its own hot reload.
 *
 * Use `await app.pause('Inspect this contact')` within a test or setup hook with `--ui` or `--manual`. It opens the reporter immediately, retains the current app and test, and suspends the test deadline. Continue hides the reporter and resumes the remaining budget. It does not freeze application timers or network requests. Cleanup has its own deadline and cannot pause. Headless pause calls fail clearly.
 *
 * The package includes types for tests, hooks, config, fixtures, and app APIs. Browser tests use TypeScript's `moduleResolution: "Bundler"`; Interactor.js currently has extensionless declaration imports that do not support strict NodeNext checking. Config types work independently of those browser declarations. TypeScript is still transpiled during a run; use your project's `tsc --noEmit` for type checking. JavaScript editors get the same declarations.
 *
 * Extend `Fixtures` in your project to type values returned by Node setup:
 *
 * ```ts
 * import 'dyno';
 *
 * declare module 'dyno' {
 *   interface Fixtures { contactId: string }
 * }
 * ```
 *
 * @guide debugging Editing and debugging
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
    request: (path, init = {}) => {
      let url = new URL(path, location.origin);
      if (url.origin !== location.origin)
        throw new Error('app.request requires a same-origin path.');
      return measure('request', `${init.method ?? 'GET'} ${url.pathname}`, () =>
        fetch(url, { ...init, credentials: 'same-origin', signal }),
      );
    },
  });
}
