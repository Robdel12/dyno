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
  let option = yield ({ $ }) => $.localName === 'option' ? $ : $.closest('option');
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

Interactor.defineAssertion('focused', () => ({ $ }) => $ === $.ownerDocument.activeElement,
  '#{this} is not focused', '#{this} is focused');

export function createInteractor(app, signal, timeout) {
  return new Interactor({ root: () => app.document.body, signal, assert: { timeout } });
}
