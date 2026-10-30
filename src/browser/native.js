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

function hoverPoint(element, position, document) {
  if (element?.nodeType !== 1 || element.ownerDocument !== document || !element.isConnected)
    throw new Error('Native hover needs a connected element from the current app document.');
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
      throw new Error('Native hover position must be a finite point inside the element.');
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
    throw new Error('Native hover target has no visible point that receives pointer input.');
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
      let allowBlank = !['key', 'pointer'].includes(normalized.kind);
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
  return Object.freeze({
    capabilities: supported,
    press: (key) => invoke(`Press ${key}`, { kind: 'key', key }),
    move: (point) =>
      invoke(`Move pointer to ${point?.x}, ${point?.y}`, {
        kind: 'pointer',
        x: point?.x,
        y: point?.y,
      }),
    hover: (element, options = {}) =>
      invoke('Hover element', { kind: 'pointer', x: 0, y: 0 }, (document) => {
        if (
          !options ||
          typeof options !== 'object' ||
          Array.isArray(options) ||
          Object.keys(options).some((key) => key !== 'position')
        )
          throw new Error('Native hover options only accept an optional position.');
        let point = hoverPoint(element, options.position, document);
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
