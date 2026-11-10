/**
 * @guide native Native browser actions
 * Use native input when you're testing the browser's default behavior, such as Tab navigation or CSS hover. Keep ordinary clicks, fields, and assertions in Interactor.
 *
 * ```js
 * await I.find('Name').then.focus();
 * await I.nativePress('Tab');
 * await I.find('Notes').focused();
 * await I.find('Account menu').then.nativeHover();
 * await I.nativeMove({ x: 0, y: 0 });
 * ```
 *
 * These work with scopes and custom interactors. `nativePress` uses the focused element; it doesn't focus a selector for you. Hover scrolls to a visible point that receives pointer input. Stale or covered targets fail. After an action navigates, assert on the destination with Interactor.
 *
 * `nativeClick` and `nativeTap` also accept a point in app viewport coordinates. Without a point, they resolve the scoped element locally. Tap requires `browser.hasTouch: true`. Use `nativeType(text)` after focusing a field when keyboard events themselves are part of the behavior. `nativeWheel({ deltaX, deltaY })` scrolls beneath the current pointer.
 *
 * Use `setColorScheme('dark' | 'light' | 'no-preference')` for system appearance. `blockExternalRequests()` blocks app-page HTTP requests outside the gateway origin and records up to 1,000 recent URLs; `blockedRequests()` returns them. It doesn't block WebSockets, service-worker traffic, or companion requests. Both settings reset between tests.
 *
 * ## Handle a dialog
 *
 * ```js
 * await app.native.withDialog({
 *   action: 'accept',
 *   message: 'Delete this note?',
 * }, async () => {
 *   await I.click('Delete');
 * });
 * ```
 *
 * The optional message must match exactly. You can also dismiss a dialog or supply prompt `text`. Await the scope, including when the callback navigates; it returns the callback's result.
 *
 * ## Choose supported features
 *
 * `app.native.capabilities` tells you what this browser supports. Required calls fail when unavailable. Manual runs have no native capabilities; managed support varies by engine. See the [browser support table](browsers.md#native-capabilities).
 *
 * Use `grantPermissions([...])`, `enableVirtualAuthenticator()`, `disableVirtualAuthenticator()`, `setOffline(boolean)`, or `setReducedMotion('reduce' | 'no-preference')` before or after navigation. State resets before the next test, including after failure. Failed cleanup ends the managed session, and each operation appears in timings.
 *
 * Virtual authenticators and app offline require Chromium. Your app still performs real passkey registration and validation. Offline keeps companion HTTP connected, but Chromium can change its `navigator.onLine` too; this isn't fully isolated offline state.
 *
 * ## Read browser console messages
 *
 * `app.native.consoleMessages()` returns up to 100 recent entries with increasing `id`, `type`, and `text` (up to 4,000 characters). Save the highest ID before a workflow to find newer messages. Browser-generated warnings are included; these entries aren't automatically copied to reports.
 */

/**
 * Managed operations for browser defaults that DOM events cannot reproduce. Use Interactor for ordinary clicks, fields and assertions. Permissions, authenticator, offline and motion settings reset between tests.
 *
 * @api NativeBrowser
 */

/**
 * Inspect support before a browser-specific workflow. Manual URL sessions expose unavailable capabilities.
 *
 * @api NativeBrowser.capabilities
 */

/**
 * Send a real key or chord. Prefer `I.nativePress` when composing Interactor workflows.
 *
 * @api NativeBrowser.press
 */

/**
 * Move the real pointer to app viewport coordinates.
 *
 * @api NativeBrowser.move
 */

/**
 * Hover a connected element in the current document. Prefer `I.find(...).then.nativeHover()` for a DOM target.
 *
 * @api NativeBrowser.hover
 */

/**
 * Grant supported permissions for this execution. Check the advertised permission names first.
 *
 * @api NativeBrowser.grantPermissions
 */

/**
 * Create a Chromium virtual authenticator for a real WebAuthn workflow.
 *
 * @api NativeBrowser.enableVirtualAuthenticator
 */

/**
 * Remove this execution’s virtual authenticator.
 *
 * @api NativeBrowser.disableVirtualAuthenticator
 */

/**
 * Change Chromium app network availability. It does not change the controller connection.
 *
 * @api NativeBrowser.setOffline
 */

/**
 * Change the managed browser’s reduced-motion preference.
 *
 * @api NativeBrowser.setReducedMotion
 */

/**
 * Read recent browser console messages without evaluating objects in the app.
 *
 * @api NativeBrowser.consoleMessages
 */

/**
 * @api NativeBrowser.withDialog
 * Handle a dialog opened by the callback, then remove the handler. Optionally check its exact message or supply prompt `text`. Returns the callback result.
 */

/**
 * Check support before a browser-specific workflow. Virtual authenticators and app offline require Chromium; clipboard permission support varies by engine. Manual URL runs have no native capabilities.
 *
 * @api NativeCapabilities
 */

/**
 * A point in CSS pixels. Pointer moves use viewport coordinates; hover positions use the element’s bounding box.
 *
 * @api NativePoint
 */

/**
 * Optionally choose a point inside the target element. Without it, Dyno chooses a visible point that receives pointer input.
 *
 * @api NativeHoverOptions
 */

/**
 * Accept or dismiss the next dialog opened by the callback. Optionally require a message and supply prompt text.
 *
 * @api NativeDialogOptions
 */

/**
 * A captured console entry with its sequence ID, type and text.
 *
 * @api NativeConsoleMessage
 */

import { nativeCapabilities, normalizeNative } from '../native.js';

function currentDocument(appWindow, readState, signal, allowBlank) {
  signal.throwIfAborted();
  let state = readState();
  let document;
  try {
    document = appWindow.document;
    if (
      document === state.readyDocument &&
      state.readyId === appWindow.__browserTestBridge?.id &&
      (allowBlank || appWindow.location.pathname !== '/__dyno__/blank')
    )
      return document;
  } catch {
    throw new Error('Native browser operations require the app on the test gateway origin.');
  }
  throw new Error(
    'Load the app and wait for its current document before using native browser input.',
  );
}

function containsHit(element, hit) {
  for (let node = hit; node; node = node.getRootNode().host)
    if (element === node || element.contains(node)) return true;
  return false;
}

function receivesPointer(element, x, y) {
  let hit = element.ownerDocument.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    let nested = hit.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === hit) break;
    hit = nested;
  }
  return containsHit(element, hit);
}

function pointerPoint(element, position, document) {
  if (element?.nodeType !== 1 || element.ownerDocument !== document || !element.isConnected)
    throw new Error('Native pointer input needs a connected element from the current app document.');
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  let window = document.defaultView;
  let box = element.getBoundingClientRect();
  let points;
  if (position !== undefined) {
    if (
      !position ||
      ![position.x, position.y].every(Number.isFinite) ||
      position.x < 0 ||
      position.y < 0 ||
      position.x >= box.width ||
      position.y >= box.height
    )
      throw new Error('Native pointer position must be a finite point inside the element.');
    points = [{ x: box.left + position.x, y: box.top + position.y }];
  } else {
    points = [...element.getClientRects()].flatMap((rect) => {
      let left = Math.max(0, rect.left),
        top = Math.max(0, rect.top);
      let right = Math.min(window.innerWidth, rect.right),
        bottom = Math.min(window.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return [];
      let x = (left + right) / 2,
        y = (top + bottom) / 2;
      let inset = Math.min(1, (right - left) / 2, (bottom - top) / 2);
      return [
        { x, y },
        { x, y: top + inset },
        { x, y: bottom - inset },
        { x: left + inset, y },
        { x: right - inset, y },
      ];
    });
  }
  let point = points.find(
    ({ x, y }) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      y >= 0 &&
      x < window.innerWidth &&
      y < window.innerHeight &&
      receivesPointer(element, x, y),
  );
  if (!point)
    throw new Error('Native pointer target has no visible point that receives pointer input.');
  return point;
}

export function createNative({
  appWindow,
  readState,
  signal,
  operation,
  measure,
  capabilities = nativeCapabilities(),
}) {
  let supported = Object.freeze({
    ...capabilities,
    permissions: Object.freeze([...capabilities.permissions]),
  });
  let invoke = (name, input, prepare = () => ({}), select = () => undefined) =>
    measure('native', name, () => {
      signal.throwIfAborted();
      let normalized = normalizeNative(input, supported);
      let allowBlank = !['key', 'type', 'pointer', 'click', 'tap', 'wheel'].includes(normalized.kind);
      return operation(
        { operation: 'native', input: normalized },
        () => {
          let document = currentDocument(appWindow, readState, signal, allowBlank);
          let documentId = readState().readyId;
          let prepared = prepare(document);
          if (
            currentDocument(appWindow, readState, signal, allowBlank) !== document ||
            readState().readyId !== documentId
          )
            throw new Error('The app document changed while preparing native browser input.');
          return { documentId, ...prepared };
        },
        select,
      );
    });
  let pointerInput = (kind, target) => {
    if (target?.nodeType === 1)
      return invoke(`Native ${kind} element`, { kind, x: 0, y: 0 }, document => ({
        input: normalizeNative({ kind, ...pointerPoint(target, undefined, document) }, supported),
      }));
    return invoke(`Native ${kind} at ${target?.x}, ${target?.y}`, { kind, x: target?.x, y: target?.y });
  };
  return Object.freeze({
    capabilities: supported,
    type: (text) => invoke('Type with native keyboard', { kind: 'type', text }),
    press: (key) => invoke(`Press ${key}`, { kind: 'key', key }),
    move: (point) =>
      invoke(`Move pointer to ${point?.x}, ${point?.y}`, {
        kind: 'pointer',
        x: point?.x,
        y: point?.y,
      }),
    click: (target) => pointerInput('click', target),
    tap: (target) => pointerInput('tap', target),
    wheel: (delta) => invoke('Scroll with native wheel', { kind: 'wheel', deltaX: delta?.deltaX, deltaY: delta?.deltaY }),
    setColorScheme: (value) => invoke(`Set color scheme to ${value}`, { kind: 'color-scheme', value }),
    blockExternalRequests: () => invoke('Block external app requests', { kind: 'block-external' }),
    blockedRequests: () => invoke('Read blocked app requests', { kind: 'blocked-requests' }, undefined, urls => Object.freeze([...urls])),
    hover: (element, options = {}) =>
      invoke('Hover element', { kind: 'pointer', x: 0, y: 0 }, (document) => {
        if (
          !options ||
          typeof options !== 'object' ||
          Array.isArray(options) ||
          Object.keys(options).some((key) => key !== 'position')
        )
          throw new Error('Native hover options only accept an optional position.');
        let point = pointerPoint(element, options.position, document);
        return { input: normalizeNative({ kind: 'pointer', ...point }, supported) };
      }),
    grantPermissions: (permissions) =>
      invoke('Grant clipboard permissions', { kind: 'permissions', permissions }),
    enableVirtualAuthenticator: () =>
      invoke('Enable virtual authenticator', { kind: 'authenticator' }),
    disableVirtualAuthenticator: () =>
      invoke('Disable virtual authenticator', { kind: 'remove-authenticator' }),
    setOffline: (offline) =>
      invoke(offline ? 'Set app offline' : 'Set app online', { kind: 'offline', offline }),
    setReducedMotion: (value) =>
      invoke(`Set reduced motion to ${value}`, { kind: 'motion', value }),
    consoleMessages: () =>
      invoke('Read browser console', { kind: 'console' }, undefined, (entries) =>
        Object.freeze(entries.map(({ id, type, text }) => Object.freeze({ id, type, text }))),
      ),
    withDialog: (options, work) =>
      measure('native', 'Handle browser dialog', async () => {
        signal.throwIfAborted();
        if (
          !options ||
          typeof options !== 'object' ||
          Array.isArray(options) ||
          Object.keys(options).some((key) => !['action', 'message', 'text'].includes(key)) ||
          typeof work !== 'function'
        )
          throw new Error('withDialog needs action, optional message and text, and a callback.');
        let result = normalizeNative({ kind: 'dialog-result' }, supported);
        let armed = false;
        let value;
        // Register the entire callback as a pending operation before arming. The
        // runtime then catches a missing await even between its native requests.
        try {
          return await operation(
            { operation: 'native', input: result },
            async () => {
              await invoke('Arm browser dialog', { kind: 'dialog', ...options });
              armed = true;
              value = await work();
              currentDocument(appWindow, readState, signal, true);
              return { documentId: readState().readyId };
            },
            () => value,
          );
        } finally {
          if (armed && !signal.aborted)
            await invoke('Disarm browser dialog', { kind: 'dialog-cancel' });
        }
      }),
  });
}

/**
 * Type text with the real keyboard into the focused element. Prefer `I.nativeType` when composing native keyboard workflows.
 *
 * @api NativeBrowser.type
 */

/**
 * Click a connected element or a point in app viewport coordinates with the real mouse. Ordinary clicks stay in Interactor.
 *
 * @api NativeBrowser.click
 */

/**
 * Tap a connected element or viewport point with a real touch event. Requires a managed context with `browser.hasTouch: true`.
 *
 * @api NativeBrowser.tap
 */

/**
 * Send finite wheel deltas in CSS pixels under the current pointer. Mobile WebKit does not support wheel input.
 *
 * @api NativeBrowser.wheel
 */

/**
 * Choose the app system color scheme: light, dark, or no-preference. Cleanup restores the original preference.
 *
 * @api NativeBrowser.setColorScheme
 */

/**
 * Block app-page HTTP requests outside the gateway origin. Data and blob URLs remain available. Does not cover service workers or WebSockets; resets between tests.
 *
 * @api NativeBrowser.blockExternalRequests
 */

/**
 * Read an immutable list of up to 1,000 recent URLs blocked by the external-request guard.
 *
 * @api NativeBrowser.blockedRequests
 */

/**
 * Horizontal and vertical wheel deltas in CSS pixels. Negative values scroll left or up.
 *
 * @api NativeWheel
 */
