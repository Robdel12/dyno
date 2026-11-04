/**
 * @guide custom-interactors Custom interactors
 * Once a few tests use the same form or component, give that workflow a name. Keep the definition with your app's test support—or beside the component—so tests can import it.
 *
 * ```js
 * // tests/interactors/login.js
 * import { defineInteractor } from 'dyno';
 *
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
 * Bind it to the test's `I` when you use it:
 *
 * ```js
 * import { LoginForm } from './interactors/login.js';
 *
 * let login = LoginForm(I, '$(form)');
 * await step('Sign in', () => login.signIn(user));
 * await login.assert.hasError('Check your password');
 * ```
 *
 * Share definitions, not bound instances. Each binding gets the test's scope, assertion settings and cancellation signal. It follows the app after navigation without caching elements or changing other interactors.
 *
 * ## Compose smaller components
 *
 * A custom interactor can bind inside another one. With your own `Post`, `Composer` and selector:
 *
 * ```js
 * let reply = Composer(Post(I, postSelector(words)), '$([aria-label="Reply"])');
 * await reply.write('I remember this storm.');
 * ```
 *
 * Use async actions and await each operation. Interactor's generator actions and `.then` chains work too, and `scope()` keeps your custom methods.
 *
 * Assertions receive `$` for the current subject and `root()` for the component root. Return a boolean, including `false` when content is missing. Interactor treats `undefined` as success for callbacks that throw on failure. Custom assertions support `.not` and failure-message objects.
 *
 * Keep navigation, fixture requests, screenshots and named steps in the surrounding workflow. TypeScript infers custom method arguments; use `InteractorContext` when annotating assertion callbacks.
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
 * @guide interactors Interact with the app
 * Your test gets two things you'll use constantly: `app` to navigate and make requests, and `I` to interact with the UI. `I` is [Interactor.js](https://github.com/wwilsman/interactor.js), rooted in your app's current document.
 *
 * ```js
 * await app.goto('/contacts/new');
 * await I.find('Name').then.fill('Robert');
 * await I.click('Save');
 * await I.find('$([role=status])').text('Contact saved');
 * ```
 *
 * `app.goto` waits for the document. The last assertion waits for the result you care about. You don't need a sleep between those steps.
 *
 * ## Find what someone would use
 *
 * Strings match text, placeholders and related label controls. They match the whole text; use a regular expression for a partial match. Use `$(...)` when you need CSS:
 *
 * ```js
 * await I.find('Email').then.fill('rob@example.com');
 * await I.find(/Contact saved/).rendered();
 * await I.find('$(input[name=email])').value('rob@example.com');
 * ```
 *
 * `rendered()` checks displayed content, including below the fold. `visible()` also requires it to be in the viewport. `expectTimeout` sets the assertion deadline.
 *
 * For changing browser state, use an assertion callback:
 *
 * ```js
 * await I.assert(
 *   () => app.window.location.pathname === '/dashboard',
 *   'Expected the dashboard URL'
 * );
 * ```
 *
 * ## Work within a component
 *
 * Use `scope()` to narrow the root. It finds that root again after navigation, so you can reuse the scope within a test:
 *
 * ```js
 * let contact = I.scope('$(form)');
 * await contact.find('Email').then.fill('rob@example.com');
 * ```
 *
 * A missing root fails. Create scopes before chaining; use `I.scope(selector)` rather than `I.find(selector).then.scope()`.
 *
 * `fill()` replaces an editable input or textarea value and sends input/change events. To select a file:
 *
 * ```js
 * await contact.find('Photo').then.upload({
 *   name: 'note.txt',
 *   bytes: 'Storm notes',
 *   type: 'text/plain',
 * });
 * ```
 *
 * Pass no files to clear the input. Use [custom interactors](guide.md#custom-interactors) when these actions form a workflow you'll share.
 *
 * ## Check the right thing
 *
 * Built-in assertions cover text, values, visibility and more. `contains(selector)` checks for a descendant, not a text substring. For a DOM predicate, bind a scope:
 *
 * ```js
 * await I.scope('$([role=status])').assert(
 *   ({ $ }) => $.textContent.includes('Saved')
 * );
 * ```
 *
 * Ordinary actions use DOM methods and synthetic events. For browser defaults such as Tab order or CSS hover, use [native browser behavior](guide.md#native-browser-actions).
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
