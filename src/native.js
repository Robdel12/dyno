let clipboard = Object.freeze(['clipboard-read', 'clipboard-write']);
let none = Object.freeze([]);

export function nativeCapabilities(name = null) {
  let chromium = ['chromium', 'chrome', 'edge'].includes(name);
  let managed = chromium || ['firefox', 'webkit'].includes(name);
  return Object.freeze({
    keyboard: managed,
    pointer: managed,
    permissions: chromium
      ? clipboard
      : name === 'webkit'
        ? Object.freeze(['clipboard-read'])
        : none,
    authenticator: chromium,
    offline: chromium,
    media: managed,
    dialogs: managed,
    diagnostics: managed,
  });
}

let properties = Object.freeze({
  key: ['kind', 'key'],
  pointer: ['kind', 'x', 'y'],
  permissions: ['kind', 'permissions'],
  authenticator: ['kind'],
  'remove-authenticator': ['kind'],
  offline: ['kind', 'offline'],
  motion: ['kind', 'value'],
  dialog: ['kind', 'action', 'message', 'text'],
  'dialog-result': ['kind'],
  'dialog-cancel': ['kind'],
  console: ['kind'],
});
let requiredCapability = Object.freeze({
  key: 'keyboard',
  pointer: 'pointer',
  authenticator: 'authenticator',
  'remove-authenticator': 'authenticator',
  offline: 'offline',
  motion: 'media',
  dialog: 'dialogs',
  'dialog-result': 'dialogs',
  'dialog-cancel': 'dialogs',
  console: 'diagnostics',
});
let invalid = (message) => Object.assign(new Error(message), { status: 400 });
let unavailable = (message) => Object.assign(new Error(message), { status: 422 });

export function normalizeNative(input, capabilities) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Object.hasOwn(properties, input.kind)
  )
    throw invalid('Unknown native browser operation.');
  if (Object.keys(input).some((key) => !properties[input.kind].includes(key)))
    throw invalid(`Unexpected option for native ${input.kind}.`);
  let capability = requiredCapability[input.kind];
  if (capability && !capabilities?.[capability])
    throw unavailable(
      `Native ${input.kind} is unavailable in this browser. Use a supported managed browser.`,
    );
  switch (input.kind) {
    case 'key':
      if (
        typeof input.key !== 'string' ||
        !input.key.trim() ||
        input.key.length > 100 ||
        /[\r\n\0]/.test(input.key)
      )
        throw invalid('Native keyboard input needs a key or key combination of 1–100 characters.');
      return Object.freeze({ kind: input.kind, key: input.key });
    case 'pointer':
      if (![input.x, input.y].every((value) => Number.isFinite(value) && value >= 0))
        throw invalid(
          'Native pointer coordinates must be finite, nonnegative viewport coordinates.',
        );
      return Object.freeze({ kind: input.kind, x: input.x, y: input.y });
    case 'permissions': {
      if (
        !Array.isArray(input.permissions) ||
        input.permissions.length === 0 ||
        input.permissions.length > 2 ||
        input.permissions.some((permission) => typeof permission !== 'string') ||
        new Set(input.permissions).size !== input.permissions.length
      )
        throw invalid('Native permissions need a nonempty list of distinct clipboard permissions.');
      if (input.permissions.some((permission) => !capabilities?.permissions?.includes(permission)))
        throw unavailable('Requested clipboard permissions are unavailable in this browser.');
      return Object.freeze({
        kind: input.kind,
        permissions: Object.freeze([...input.permissions]),
      });
    }
    case 'dialog':
      if (
        !['accept', 'dismiss'].includes(input.action) ||
        ['message', 'text'].some(
          (key) =>
            input[key] !== undefined &&
            (typeof input[key] !== 'string' || input[key].length > 10000),
        ) ||
        (input.text !== undefined && input.action !== 'accept')
      )
        throw invalid(
          'Native dialogs need accept or dismiss, optional exact message text, and optional prompt input for accept.',
        );
      return Object.freeze({
        kind: input.kind,
        action: input.action,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
      });
    case 'offline':
      if (typeof input.offline !== 'boolean') throw invalid('Native offline must be a boolean.');
      return Object.freeze({ kind: input.kind, offline: input.offline });
    case 'motion':
      if (!['reduce', 'no-preference'].includes(input.value))
        throw invalid('Native reduced motion must be reduce or no-preference.');
      return Object.freeze({ kind: input.kind, value: input.value });
    default:
      return Object.freeze({ kind: input.kind });
  }
}
