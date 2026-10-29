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
    for (let element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
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
              'Screenshot animation handlers kept creating animations. Wait for the app to settle before capture.'
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
              'The app Content Security Policy blocked screenshot styling. Use an explicit test policy or keep the caret unchanged.'
            );
        }
      if (policy.animations !== 'disabled') return;
      if (typeof document.getAnimations !== 'function')
        throw new Error(
          'This browser cannot disable animations for screenshots. Keep animations unchanged or use a browser with the Web Animations API.'
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
        'Screenshot animation handlers kept creating animations. Wait for the app to settle before capture.'
      );
    },
    restore() {
      for (let cleanup of cleanups.reverse()) cleanup();
      for (let animation of resumed)
        try {
          animation.play();
        } catch {}
    }
  };
}

function capturePolicy(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('Screenshot options must be an object.');
  let fullPage = options.fullPage ?? false;
  let animations = options.animations ?? 'allow';
  let caret = options.caret ?? 'initial';
  if (
    typeof fullPage !== 'boolean' ||
    !['allow', 'disabled'].includes(animations) ||
    !['initial', 'hide'].includes(caret)
  )
    throw new Error(
      'Screenshot options require fullPage:boolean, animations:allow|disabled, and caret:initial|hide.'
    );
  if (options.mask !== undefined && !Array.isArray(options.mask))
    throw new Error('Screenshot masks must be an array of elements from the current app document.');
  return Object.freeze({ fullPage, animations, caret });
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

export function createApp(appWindow, readState, signal, navigate, operation, pause, supportsCapture) {
  let captures = Promise.resolve();
  return Object.freeze({
    goto: navigate,
    pause,
    setViewport: (viewport) =>
      operation({ operation: 'viewport', viewport }, undefined, (result) => Object.freeze(result.viewport)),
    screenshot: (name, options = {}) => {
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
                'Load the app before requesting a screenshot, and keep its document open until capture finishes.'
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
                body?.offsetWidth ?? 0
              )
            ),
            fullHeight: Math.ceil(
              Math.max(
                appWindow.innerHeight,
                html.scrollHeight,
                html.offsetHeight,
                body?.scrollHeight ?? 0,
                body?.offsetHeight ?? 0
              )
            )
          });
          return {
            documentId,
            metrics,
            options: Object.freeze({
              ...policy,
              mask: Object.freeze(maskRectangles(options.mask, document, policy, metrics))
            })
          };
        },
        (result) => Object.freeze(result)
      );
      let result = captured.finally(() => restore());
      captures = result.catch(() => {});
      return result;
    },
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
          'The app navigated cross-origin. This framework requires a cooperating app on the test gateway origin.'
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
      if (url.origin !== location.origin) throw new Error('app.request requires a same-origin path.');
      return fetch(url, { ...init, credentials: 'same-origin', signal });
    }
  });
}
