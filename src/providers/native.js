import { normalizeNative } from '../native.js';

let sameExecution = (left, right) =>
  left && right && left.runId === right.runId && left.executionId === right.executionId;

async function abortable(work, signal) {
  signal.throwIfAborted();
  let interrupted = Promise.withResolvers();
  let aborted = () => interrupted.reject(signal.reason);
  signal.addEventListener('abort', aborted, { once: true });
  try {
    return await Promise.race([work, interrupted.promise]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}

export function createNative({ context, page, capabilities, close }) {
  let owner;
  let client;
  let authenticator;
  let originalMotion;
  let dialog;
  let activeRequests = new Map();
  let consoleId = 0;
  let consoleMessages = Object.freeze([]);
  let captureConsole = (message) => {
    let entry = Object.freeze({
      id: ++consoleId,
      type: message.type(),
      text: message.text().slice(0, 4000),
    });
    consoleMessages = Object.freeze([...consoleMessages, entry].slice(-100));
  };
  page.on('console', captureConsole);
  context.once('close', () => page.off('console', captureConsole));
  let changed = new Set();
  let cancelled = new Set();
  let requestKey = (request) =>
    JSON.stringify([request?.runId, request?.context?.executionId, request?.requestId]);
  let assertActive = (request) => {
    if (cancelled.has(requestKey(request)))
      throw new Error('Native browser input was cancelled before it completed.');
  };
  let cdp = async () => (client ??= await context.newCDPSession(page));
  let cancelDialog = async (
    error = new Error('Native dialog scope ended before a dialog completed.'),
  ) => {
    let pending = dialog;
    if (!pending) return;
    dialog = undefined;
    page.off('dialog', pending.handler);
    pending.result.reject(error);
    if (pending.handling) await pending.handling;
    if (pending.observed && !pending.closed) await pending.observed.dismiss();
  };
  let armDialog = (input) => {
    if (dialog) throw new Error('A native dialog scope is already active for this test.');
    let pending = {
      result: Promise.withResolvers(),
      observed: null,
      closed: false,
      handling: null,
    };
    // A callback can fail before it requests the result; keep that rejection handled.
    pending.result.promise.catch(() => {});
    pending.handler = (observed) => {
      pending.observed = observed;
      pending.handling = (async () => {
        let result = Object.freeze({
          type: observed.type(),
          message: observed.message(),
          defaultValue: observed.defaultValue(),
        });
        let mismatch = input.message !== undefined && result.message !== input.message;
        let invalidText = input.text !== undefined && result.type !== 'prompt';
        if (mismatch || invalidText) {
          await observed.dismiss();
          pending.closed = true;
          throw new Error(
            mismatch
              ? `Native dialog message did not match: expected ${JSON.stringify(input.message)}, received ${JSON.stringify(result.message)}.`
              : 'Native dialog text can only be supplied for a prompt.',
          );
        }
        if (input.action === 'accept') await observed.accept(input.text);
        else await observed.dismiss();
        pending.closed = true;
        pending.result.resolve(result);
      })().catch((error) => pending.result.reject(error));
    };
    dialog = pending;
    page.once('dialog', pending.handler);
  };
  let reset = async () => {
    let failures = [];
    let restore = async (work) => {
      try {
        await work();
      } catch (error) {
        failures.push(error);
      }
    };
    await restore(() => cancelDialog());
    if (changed.has('offline'))
      await restore(async () => {
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await client.send('Network.disable');
      });
    if (changed.has('motion'))
      await restore(() => page.emulateMedia({ reducedMotion: originalMotion }));
    if (changed.has('permissions')) await restore(() => context.clearPermissions());
    if (changed.has('authenticator'))
      await restore(async () => {
        if (authenticator)
          await client.send('WebAuthn.removeVirtualAuthenticator', {
            authenticatorId: authenticator,
          });
        await client.send('WebAuthn.disable');
      });
    if (client) await restore(() => client.detach());
    client = undefined;
    authenticator = undefined;
    originalMotion = undefined;
    changed = new Set();
    owner = undefined;
    if (failures.length) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
      throw new Error(
        `Native browser cleanup failed; the managed session ended. ${failures.map((error) => error.message).join(' ')}`,
      );
    }
  };
  let binding = () =>
    page.evaluate(() => {
      let bridge = window.__browserTestBridge;
      let name;
      try {
        name = JSON.parse(window.name);
      } catch {}
      return {
        runId: bridge?.runId ?? name?.runId,
        executionId: bridge?.executionId ?? name?.executionId,
        documentId: bridge?.id ?? null,
        width: innerWidth,
        height: innerHeight,
      };
    });
  let check = async (request, after = false) => {
    let actual;
    try {
      actual = await binding();
    } catch (error) {
      if (
        !after ||
        request.input.kind !== 'key' ||
        !/execution context was destroyed|cannot find context|because of a navigation/i.test(
          error.message,
        )
      )
        throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      actual = await binding();
    }
    let expected = { runId: request.runId, ...request.context };
    if (!sameExecution(actual, expected))
      throw new Error('The owned app page has moved to another test execution.');
    let navigation = after && request.input.kind === 'key';
    if (
      !navigation &&
      (actual.documentId !== expected.documentId ||
        actual.width !== expected.width ||
        actual.height !== expected.height)
    )
      throw new Error('The owned app document or viewport changed before native input completed.');
  };
  let dispatch = async (request) => {
    let input = request.input;
    assertActive(request);
    switch (input.kind) {
      case 'key':
        await page.keyboard.press(input.key);
        break;
      case 'pointer':
        await page.mouse.move(input.x, input.y);
        break;
      case 'permissions':
        changed.add('permissions');
        await context.grantPermissions(input.permissions, { origin: new URL(page.url()).origin });
        break;
      case 'authenticator': {
        if (authenticator)
          throw new Error('A virtual authenticator is already active for this test.');
        let session = await cdp();
        assertActive(request);
        changed.add('authenticator');
        await session.send('WebAuthn.enable');
        assertActive(request);
        ({ authenticatorId: authenticator } = await session.send(
          'WebAuthn.addVirtualAuthenticator',
          {
            options: {
              protocol: 'ctap2',
              transport: 'internal',
              hasResidentKey: true,
              hasUserVerification: true,
              isUserVerified: true,
              automaticPresenceSimulation: true,
            },
          },
        ));
        break;
      }
      case 'remove-authenticator':
        if (authenticator) {
          await client.send('WebAuthn.removeVirtualAuthenticator', {
            authenticatorId: authenticator,
          });
          authenticator = undefined;
        }
        break;
      case 'offline': {
        let session = await cdp();
        assertActive(request);
        changed.add('offline');
        await session.send('Network.enable');
        assertActive(request);
        await session.send('Network.emulateNetworkConditions', {
          offline: input.offline,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        break;
      }
      case 'console':
        return consoleMessages;
      case 'dialog':
        armDialog(input);
        break;
      case 'dialog-result': {
        let pending = dialog;
        if (!pending) throw new Error('Arm a native dialog scope before waiting for its result.');
        let result = await abortable(
          pending.result.promise,
          activeRequests.get(requestKey(request)).signal,
        );
        if (dialog === pending) dialog = undefined;
        return result;
      }
      case 'dialog-cancel':
        await cancelDialog();
        break;
      case 'motion':
        if (!changed.has('motion')) {
          originalMotion = await page.evaluate(() =>
            matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference',
          );
          assertActive(request);
        }
        changed.add('motion');
        await page.emulateMedia({ reducedMotion: input.value });
        break;
    }
    return null;
  };
  return Object.freeze({
    cancelNative(request) {
      let key = requestKey(request);
      cancelled.add(key);
      activeRequests
        .get(key)
        ?.abort(new Error('Native browser input was cancelled before it completed.'));
    },
    async native(request) {
      let key = requestKey(request);
      try {
        assertActive(request);
        activeRequests.set(key, new AbortController());
        let binding = request?.context;
        if (
          typeof request?.requestId !== 'string' ||
          !request.requestId ||
          typeof request?.runId !== 'string' ||
          !request.runId ||
          typeof binding?.executionId !== 'string' ||
          !binding.executionId ||
          typeof binding?.documentId !== 'string' ||
          !binding.documentId ||
          !Number.isInteger(binding.revision) ||
          binding.revision < 0 ||
          ![binding.width, binding.height].every(
            (value) => Number.isSafeInteger(value) && value > 0,
          )
        )
          throw new Error('Native input needs the current run, execution, document, and viewport.');
        let input = normalizeNative(request.input, capabilities);
        if (input.kind === 'pointer' && (input.x >= binding.width || input.y >= binding.height))
          throw new Error('Native pointer coordinates must be inside the app viewport.');
        request = { ...request, input };
        if (['key', 'pointer'].includes(input.kind)) await page.bringToFront();
        await check(request);
        assertActive(request);
        let next = { runId: request.runId, executionId: request.context.executionId };
        if (owner && !sameExecution(owner, next)) {
          await reset();
          await check(request);
        }
        assertActive(request);
        owner = Object.freeze(next);
        let result = await dispatch(request);
        assertActive(request);
        await check(request, true);
        assertActive(request);
        return result;
      } finally {
        activeRequests.delete(key);
        cancelled.delete(key);
      }
    },
    async resetNative(expected) {
      if (owner && sameExecution(owner, expected)) await reset();
    },
  });
}
