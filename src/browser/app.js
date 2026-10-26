export function createApp(frame, readState, signal, navigate) {
  return Object.freeze({
    goto: navigate,
    get document() {
      signal.throwIfAborted();
      try {
        let state = readState();
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
  });
}
