import { Interactor } from 'interactor.js';

export { Interactor };
export let suite = { tests: [], beforeEach: [], afterEach: [] };
export function test(name, run, options = {}) {
  if (typeof name !== 'string' || typeof run !== 'function') throw new Error('test requires a name and a function.');
  if (suite.tests.some(item => item.name === name)) throw new Error(`Duplicate test name: ${name}`);
  if (options.timeout !== undefined && (!Number.isInteger(options.timeout) || options.timeout <= 0)) throw new Error(`Invalid timeout for ${name}.`);
  suite.tests.push({ name, run, timeout: options.timeout });
}
export function beforeEach(run) { suite.beforeEach.push(run); }
export function afterEach(run) { suite.afterEach.push(run); }

export function createApp(frame, state, signal, navigate) {
  return {
    goto: navigate,
    get document() {
      signal.throwIfAborted();
      try {
        let document = frame.contentDocument;
        if (state.readyDocument === document && state.readyId === frame.contentWindow.__browserTestBridge?.id) return document;
      } catch { throw new Error('The app navigated cross-origin. This framework requires a cooperating app on the test gateway origin.'); }
      throw new Error('App document is navigating or its startup bridge has not loaded.');
    },
    get window() { signal.throwIfAborted(); return frame.contentWindow; },
    request: (path, init = {}) => {
      let url = new URL(path, location.origin);
      if (url.origin !== location.origin) throw new Error('app.request requires a same-origin path.');
      return fetch(url, { ...init, credentials: 'same-origin', signal });
    }
  };
}
