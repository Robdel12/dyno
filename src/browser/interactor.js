import { Interactor as BrowserInteractor } from 'interactor.js';

export class Interactor extends BrowserInteractor {
  static Assert = class extends BrowserInteractor.Assert {};

  scope(selector) {
    let context = new this.constructor.Context(this[this.constructor.Context.Symbol]);
    context.selector = selector;
    return new this.constructor({
      root: () => context.$,
      signal: context.signal,
      // Context inherits these settings; spreading assert would drop them.
      assert: {
        timeout: context.assert.timeout,
        frequency: context.assert.frequency,
        reliability: context.assert.reliability,
      },
    });
  }
}

function dispatch(element, eventName, { bubbles = true, cancelable = true, ...properties } = {}, signal) {
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
    yield ({ signal }) => {
      signal?.throwIfAborted();
      option.selected = select.multiple ? !option.selected : true;
    };
    yield this.find(select);
    yield this.trigger('input', { cancelable: false });
    yield this.trigger('change', { cancelable: false });
    return select;
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
    if (!['input', 'textarea'].includes($.localName)) throw new Error('fill requires an input or textarea');
    let window = $.ownerDocument.defaultView;
    let prototype = $.localName === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    let setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call($, String(value));
  };
  yield this.trigger('input', { cancelable: false, inputType: 'insertReplacementText', data: String(value) });
  yield this.trigger('change', { cancelable: false });
  return ({ $ }) => $;
});

Interactor.defineAction('upload', function* upload(...files) {
  yield this.assert.not.disabled();
  yield ({ $, signal }) => {
    signal?.throwIfAborted();
    if ($.localName !== 'input' || $.type !== 'file') throw new Error('upload requires a file input');
    if (files.length > 1 && !$.multiple) throw new Error('Multiple files require a multiple file input');
    let window = $.ownerDocument.defaultView;
    let transfer = new window.DataTransfer();
    for (let { bytes, name, type = '' } of files) transfer.items.add(new window.File([bytes], name, { type }));
    $.files = transfer.files;
  };
  yield this.trigger('input', { cancelable: false });
  yield this.trigger('change', { cancelable: false });
  return ({ $ }) => $;
});

Interactor.defineAssertion(
  'rendered',
  () => ({ $ }) => isDisplayed($) && [...$.getClientRects()].some(rect => rect.width > 0 && rect.height > 0),
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
  return new Interactor({ root: () => app.document.body, signal, assert: { timeout } });
}
