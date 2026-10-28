export function createApp(frame, readState, signal, navigate, operation) {
  return Object.freeze({
    goto: navigate,
    setViewport: (viewport) =>
      operation({ operation: 'viewport', viewport }, undefined, (result) => Object.freeze(result.viewport)),
    screenshot: (name, options = {}) =>
      operation(
        { operation: 'screenshot', name, optional: options.optional },
        async () => {
          signal.throwIfAborted();
          let document = readState().readyDocument;
          let documentId = readState().readyId;
          if (!document || document !== frame.contentDocument)
            throw new Error('Load the app before requesting a screenshot.');
          await document.fonts.ready;
          if (readState().readyDocument !== document || readState().readyId !== documentId)
            throw new Error('App navigated before screenshot started.');
          return { documentId };
        },
        (result) => Object.freeze(result)
      ),
    get document() {
      signal.throwIfAborted();
      try {
        let state = readState();
        let document = frame.contentDocument;
        if (state.readyDocument === document && state.readyId === frame.contentWindow.__browserTestBridge?.id)
          return document;
      } catch {
        throw new Error(
          'The app navigated cross-origin. This framework requires a cooperating app on the test gateway origin.'
        );
      }
      throw new Error('App document is navigating or its startup bridge has not loaded.');
    },
    get window() {
      signal.throwIfAborted();
      return frame.contentWindow;
    },
    request: (path, init = {}) => {
      let url = new URL(path, location.origin);
      if (url.origin !== location.origin) throw new Error('app.request requires a same-origin path.');
      return fetch(url, { ...init, credentials: 'same-origin', signal });
    }
  });
}
