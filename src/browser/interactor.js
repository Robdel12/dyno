import { Interactor } from 'interactor.js';

function dispatch(element, eventName, { bubbles = true, cancelable = true, ...properties } = {}, signal) {
  signal?.throwIfAborted();
  let window = element.ownerDocument.defaultView;
  let EventConstructor = eventName === 'click' ? window.MouseEvent : window.Event;
  let event = new EventConstructor(eventName, { bubbles, cancelable, ...properties });
  for (let [name, value] of Object.entries(properties)) if (!(name in event)) event[name] = value;
  return element.dispatchEvent(event);
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
      let style = window.getComputedStyle($);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 0.1)
        return false;
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
