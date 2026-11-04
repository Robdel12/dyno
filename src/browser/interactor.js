/**
 * Define and export custom interactors at module scope in your app's test support, or beside the components they exercise. Tests import those definitions and bind them to their own `I`. `defineInteractor` uses Interactor's native custom actions and assertions, without changing the test's `I` or other definitions.
 *
 * ```js
 * import { defineInteractor } from 'dyno';
 *
 * // tests/interactors/login.js
 * export let LoginForm = defineInteractor({
 *   actions: {
 *     async enterCredentials({ email, password }) {
 *       await this.find('Email').then.fill(email);
 *       await this.find('Password').then.fill(password);
 *     },
 *     async signIn(user) {
 *       await this.enterCredentials(user);
 *       await this.click('"Log in" $(button)');
 *     },
 *   },
 *   assertions: {
 *     hasError: message => ({ root }) =>
 *       root().querySelector('[role=alert]')?.innerText === message,
 *   },
 * });
 * ```
 *
 * Bind the imported definition to `I` inside a test or hook. Each call creates an independent scope with that test's assertion settings and cancellation signal. Share definitions between tests, not bound instances. Queries follow the app after navigation; elements aren't cached.
 *
 * ```js
 * import { LoginForm } from './interactors/login.js';
 *
 * let login = LoginForm(I, '$(form)');
 * await step('Sign in', () => login.signIn(user));
 * await login.assert.hasError('Check your password');
 * ```
 *
 * Components can bind inside other components. With project-defined `Post`, `Composer`, and `postSelector`:
 *
 * ```js
 * let reply = Composer(Post(I, postSelector(words)), '$([aria-label="Reply"])');
 * await reply.write('I remember this storm.');
 * ```
 *
 * Use async actions and await each operation when composing fields or child components. Native generator actions remain available; their yielded operations share the current subject. Assertion callbacks receive `$` for that subject and `root()` for the component root. Custom assertions support `.not` and Interactor's failure-message objects. Predicates must return a boolean, including `false` for missing content; Interactor treats `undefined` as success to support callbacks that throw on failure. Actions keep native `.then` chaining; deriving a chain doesn't change the original one. `scope()` retains custom methods.
 *
 * Keep navigation, fixture I/O, screenshots, and named steps in workflow functions. Share action functions or combine action/assertion maps with object spread. TypeScript infers custom method arguments and chain methods; import `InteractorContext` when annotating assertion callbacks.
 *
 * @guide custom-interactors Custom interactors
 */

/**
 * An Interactor.js instance rooted in the app’s current document. Dyno adds app-aware events, independent scopes, file inputs and explicit native actions. Use the test’s `I` as your root. Actions are awaitable and support `.then` chaining. Interactor.js owns selectors, convergence and assertions.
 *
 * @api Interactor
 */

/**
 * Bind an independent root that resolves again after navigation. Create scopes before chaining; a missing root fails instead of searching elsewhere.
 *
 * @api Interactor.scope
 */

/**
 * Replace an editable input or textarea value and dispatch input/change events. Empty strings and numeric inputs work. Use upstream `type` when individual keystrokes matter.
 *
 * @api Interactor.fill
 */

/**
 * Select files and dispatch input/change events. Pass no files to clear the selection. File bytes can come from a project fixture endpoint.
 *
 * @api Interactor.upload
 */

/**
 * Send a real key to the focused app element. Requires managed keyboard support; ordinary Interactor `press` uses synthetic events.
 *
 * @api Interactor.nativePress
 */

/**
 * Move the native pointer in app viewport coordinates. Useful for moving away from a hovered element.
 *
 * @api Interactor.nativeMove
 */

/**
 * Move the native pointer over the resolved element. An optional position is relative to its bounding box in CSS pixels.
 *
 * @api Interactor.nativeHover
 */

/**
 * Define reusable component actions and assertions. Keep definitions in your app’s test support or beside the component, then bind them to the test’s `I`. Share definitions, never bound instances.
 *
 * Actions can compose other interactors with explicit awaits. Each binding keeps its own scope, assertion settings and cancellation signal. The custom-interactor guide has a complete example.
 *
 * @api defineInteractor
 */

/**
 * A browser file input fixture. `bytes` accepts a string, Blob or other BlobPart; `name` is the filename and `type` is an optional MIME type.
 *
 * @api UploadFile
 */

/**
 * The app-aware Interactor plus your named actions and assertions. Bind it inside each test so scopes and cancellation belong to that execution.
 *
 * @api CustomInteractor
 */

/**
 * Interactor.js’s action/assertion context, available to custom definitions. Keep DOM access inside the supplied context.
 *
 * @api InteractorContext
 */

/**
 * Import `describe`, `test`, `beforeEach`, and `afterEach` from `dyno`. Tests and hooks receive `{ app, I, fixtures, signal, test, step }`. `I` is an [Interactor.js](https://github.com/wwilsman/interactor.js) instance rooted in the current app document.
 *
 * ```js
 * await I.type('Robert').into('$(input[name=name])');
 * await I.click('Save');
 * await I.find('$([role=status])').text('Saved Robert');
 * await I.find('No projects yet').visible();
 * await I.assert(
 *   () => app.window.location.pathname === '/dashboard',
 *   'Expected the dashboard URL'
 * );
 * ```
 *
 * Text selectors match text, placeholders and related label controls. Strings match the whole text; use a regular expression for a partial match. `$(...)` selects with CSS. Interactor owns actions, retries and errors; `expectTimeout` sets its assertion deadline. Wait for the result you care about rather than assuming all background work is idle.
 *
 * - `app.goto('/path')` waits for the app's bridge and document readiness. Use Interactor to wait for rendered UI.
 * - `app.setViewport({ width, height })` asks a managed provider to resize the actual app viewport and waits for layout. Each dimension must be 1–8192 CSS pixels. Manual runs require the requested size to already match.
 * - `app.screenshot(name, options)` waits for a saved PNG. See [screenshots](#screenshots).
 * - `app.request('/api/path', fetchOptions)` makes a same-origin request with the browser session and returns a standard `Response`.
 * - `app.document` and `app.window` expose the app's document and window. Await navigation before direct access; use `I.assert` callbacks for changing state.
 *
 * Each test gets fresh test and app documents and globals. Queries use the current document after navigation. Execution timeout cancels the test APIs. Entered scopes still get their `afterEach` hooks, from the inside out, with fresh APIs and a separate `cleanupTimeout` budget (5 seconds by default). A failed cleanup hook does not hide the original error or prevent later cleanup within that budget. Dyno then replaces the hidden test runtime before the next test. The persistent companion survives full app navigation.
 *
 * Fresh documents don't reset cookies, localStorage, IndexedDB, service workers, or database records. Use hooks to reset sessions and fixtures. Node setup teardown should clean up shared resources even if a browser test times out before `afterEach` finishes. Dyno's private window binding survives `sessionStorage.clear()`; avoid changing `window.name` during a run.
 *
 * Dyno exports the same `Interactor` class that provides `I`. Custom actions and assertions work in tests and scopes.
 *
 * ```js
 * let contact = I.scope('$(form)');
 * await contact.find('Email').then.fill('rob@example.com');
 * await contact.find('Photos').then.upload({ name: 'note.txt', bytes: 'Storm notes', type: 'text/plain' });
 * await contact.find('Saved').rendered();
 * ```
 *
 * `scope(selector)` returns another Interactor rooted in that element. Scopes resolve against the current app document, even after navigation, and retain the assertion settings and cancellation signal. Nest them for page objects. A missing scope fails instead of searching elsewhere. Create scopes before chaining: use `I.scope(selector)`, not `I.find(selector).then.scope()`. Pending chains cannot bind scopes or custom interactors; Dyno rejects them before they can target the wrong element.
 *
 * Use built-in assertions such as `I.find('$([role=status])').text('Saved')`. `contains(selector)` checks for a descendant, not a text substring. For a custom DOM predicate, bind a scope and call its assertion: `I.scope('$([role=status])').assert(({ $ }) => $.textContent.includes('Saved'))`. Reusable assertions belong in a custom interactor.
 *
 * `fill(value)` waits for an editable input or textarea, replaces its value, and sends input/change events. Empty strings and number inputs work too. Use upstream `type()` and `press()` when individual keys matter. `upload(...files)` sets a file input's selection and sends input/change events; each file needs `name` and `bytes`, with an optional MIME `type`. Pass no files to clear it. Load fixture bytes through your project's setup or `app.request`.
 *
 * `rendered()` checks that content has layout and is displayed, including below the fold. Transparent parents count as hidden. It doesn't scroll or require viewport visibility; use `visible()` for that. Both keep Interactor's normal retries and stability settings. Upstream text/CSS selectors, `find(...).times(count)`, `not.overflows('x')`, option clicks, and custom selector functions work directly. Keep page objects focused on your app's workflows.
 *
 * @guide interactors Interact with the app
 */

import { Interactor as BrowserInteractor } from 'interactor.js';

export class Interactor extends BrowserInteractor {
  static Assert = class extends BrowserInteractor.Assert {};

  scope(selector) {
    return bindInteractor(this, selector, this.constructor);
  }
}

function bindInteractor(interactor, selector, Type) {
  let Context = interactor?.constructor?.Context;
  if (!Context || !Object.hasOwn(interactor, Context.Symbol))
    throw new Error(
      'Bind a scope or custom interactor to an Interactor instance, not a pending chain. Use I.scope(selector) or Custom(I, selector) instead of I.find(selector).then.scope().',
    );
  let context = new Context(interactor[Context.Symbol]);
  if (selector !== undefined) context.selector = selector;
  return new Type({
    root: () => context.$,
    signal: context.signal,
    native: context.native,
    // Context inherits these settings; spreading assert would drop them.
    assert: {
      timeout: context.assert.timeout,
      frequency: context.assert.frequency,
      reliability: context.assert.reliability,
    },
  });
}

export function defineInteractor({ actions = {}, assertions = {} }) {
  class CustomInteractor extends Interactor {
    static Assert = class extends Interactor.Assert {};
  }
  CustomInteractor.defineActions(actions);
  CustomInteractor.defineAssertions(assertions);
  return (interactor, selector) => bindInteractor(interactor, selector, CustomInteractor);
}

function dispatch(
  element,
  eventName,
  { bubbles = true, cancelable = true, ...properties } = {},
  signal,
) {
  signal?.throwIfAborted();
  let window = element.ownerDocument.defaultView;
  let EventConstructor = eventName === 'click' ? window.MouseEvent : window.Event;
  let event = new EventConstructor(eventName, { bubbles, cancelable, ...properties });
  for (let [name, value] of Object.entries(properties)) if (!(name in event)) event[name] = value;
  return element.dispatchEvent(event);
}

function isDisplayed(element, minimumOpacity = 0) {
  let window = element.ownerDocument.defaultView;
  let style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility !== 'visible') return false;
  let opacity = 1;
  for (let node = element; node; node = node.parentElement ?? node.getRootNode().host) {
    opacity *= Number(window.getComputedStyle(node).opacity);
    if (opacity <= 0 || opacity < minimumOpacity) return false;
  }
  return true;
}

// Interactor.js 3.6.2's defaults use the runner's Event/MouseEvent/document.
// Its public extensions keep those three operations in the target element's realm.
Interactor.defineAction('trigger', function* trigger(eventName, properties) {
  return yield ({ $, signal }) => dispatch($, eventName, properties, signal);
});

Interactor.defineAction('click', function* click(selector) {
  yield this.find(selector);
  yield this.assert.not.disabled();
  let option = yield ({ $ }) => ($.localName === 'option' ? $ : $.closest('option'));
  let select = option?.closest('select');
  if (select) {
    yield this.assert(!select.disabled, '#{this} select is disabled');
    yield this.find(select);
    return yield ({ signal }) => {
      signal?.throwIfAborted();
      option.selected = select.multiple ? !option.selected : true;
      // A change can render or navigate. Keep the captured select through
      // dispatch instead of resolving the old document afterward.
      dispatch(select, 'input', { cancelable: false }, signal);
      dispatch(select, 'change', { cancelable: false }, signal);
      return select;
    };
  }
  // A React navigation may remove the target during dispatch. Return the clicked
  // element instead of querying its old selector again after the side effect.
  return yield ({ $, signal }) => {
    dispatch($, 'click', { view: $.ownerDocument.defaultView }, signal);
    return $;
  };
});

Interactor.defineAction('fill', function* fill(value) {
  yield this.focus();
  yield this.assert(({ $ }) => !$.disabled && !$.readOnly, '#{this} is disabled or read-only');
  yield ({ $, signal }) => {
    signal?.throwIfAborted();
    if (!['input', 'textarea'].includes($.localName))
      throw new Error('fill requires an input or textarea');
    let window = $.ownerDocument.defaultView;
    let prototype =
      $.localName === 'textarea'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    let setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call($, String(value));
  };
  yield this.trigger('input', {
    cancelable: false,
    inputType: 'insertReplacementText',
    data: String(value),
  });
  yield this.trigger('change', { cancelable: false });
  return ({ $ }) => $;
});

Interactor.defineAction('upload', function* upload(...files) {
  yield this.assert.not.disabled();
  yield ({ $, signal }) => {
    signal?.throwIfAborted();
    if ($.localName !== 'input' || $.type !== 'file')
      throw new Error('upload requires a file input');
    if (files.length > 1 && !$.multiple)
      throw new Error('Multiple files require a multiple file input');
    let window = $.ownerDocument.defaultView;
    let transfer = new window.DataTransfer();
    for (let { bytes, name, type = '' } of files)
      transfer.items.add(new window.File([bytes], name, { type }));
    $.files = transfer.files;
  };
  yield this.trigger('input', { cancelable: false });
  yield this.trigger('change', { cancelable: false });
  return ({ $ }) => $;
});

function nativeBrowser(native) {
  if (!native)
    throw new Error('Native browser input requires an Interactor bound to the current app.');
  return native;
}

Interactor.defineAction('nativePress', function* nativePress(key) {
  return yield ({ native }) => nativeBrowser(native).press(key);
});

Interactor.defineAction('nativeMove', function* nativeMove(point) {
  return yield ({ native }) => nativeBrowser(native).move(point);
});

Interactor.defineAction('nativeHover', function* nativeHover(options) {
  yield this.assert.rendered();
  return yield async ({ $, native }) => {
    await nativeBrowser(native).hover($, options);
    return $;
  };
});

Interactor.defineAssertion(
  'rendered',
  () =>
    ({ $ }) =>
      isDisplayed($) && [...$.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0),
  '#{this} is not rendered',
  '#{this} is rendered',
);

Interactor.defineAssertion(
  'focused',
  () =>
    ({ $ }) =>
      $ === $.ownerDocument.activeElement,
  '#{this} is not focused',
  '#{this} is focused',
);

// DOM focus works in a background app tab too. Browser window activation is
// outside local interaction; focus() and the focused assertion check the element.
Interactor.defineAssertion(
  'focusable',
  () =>
    ({ $ }) =>
      !$.disabled && !$.closest('[inert]') && ($.tabIndex >= 0 || $.isContentEditable),
  '#{this} is not focusable',
  '#{this} is focusable',
);

Interactor.defineAssertion(
  'visible',
  () =>
    ({ $ }) => {
      let document = $.ownerDocument;
      let window = document.defaultView;
      if (!isDisplayed($, 0.1)) return false;
      // Wrapped inline elements have several painted rectangles. Their union can
      // contain whitespace, so check the visible part of each fragment instead.
      return [...$.getClientRects()].some((rect) => {
        let left = Math.max(0, rect.left),
          top = Math.max(0, rect.top);
        let right = Math.min(window.innerWidth, rect.right),
          bottom = Math.min(window.innerHeight, rect.bottom);
        if (right <= left || bottom <= top) return false;
        let x = (left + right) / 2,
          y = (top + bottom) / 2;
        let inset = Math.min(1, (right - left) / 2, (bottom - top) / 2);
        return [
          [x, y],
          [x, top + inset],
          [x, bottom - inset],
          [left + inset, y],
          [right - inset, y],
        ].some(([x, y]) => $.contains(document.elementFromPoint(x, y)));
      });
    },
  '#{this} is not visible',
  '#{this} is visible',
);

export function createInteractor(app, signal, timeout) {
  return new Interactor({
    root: () => app.document.body,
    signal,
    native: app.native,
    assert: { timeout },
  });
}
