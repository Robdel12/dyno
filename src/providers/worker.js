import { open as openBrowser } from './playwright.js';

let session;
let queue = Promise.resolve();
let nativeRequests = new Set();
let nativeKey = (input) =>
  JSON.stringify([input?.runId, input?.context?.executionId, input?.requestId]);
process.on('message', (request) => {
  if (request.kind === 'cancel-native') {
    if (nativeRequests.has(nativeKey(request.input))) session?.cancelNative(request.input);
    return;
  }
  if (request.method === 'native') nativeRequests.add(nativeKey(request.input));
  queue = queue.then(async () => {
    try {
      let value;
      if (request.method === 'initialize') {
        session = await openBrowser(request.input.plan, request.input.viewport, () =>
          process.send?.({ kind: 'disconnected' }),
        );
        value = session.identity;
      } else if (request.method === 'open') await session.open(request.input.url);
      else if (request.method === 'activate') await session.activate();
      else if (request.method === 'resize') await session.resize(request.input);
      else if (request.method === 'capture')
        value = (await session.capture(request.input)).toString('base64');
      else if (request.method === 'native') value = await session.native(request.input);
      else if (request.method === 'resetNative') await session.resetNative(request.input);
      else if (request.method === 'stop') await session?.stop();
      else throw new Error('Unknown browser operation.');
      process.send?.({ id: request.id, value });
    } catch (error) {
      process.send?.({ id: request.id, error: error.message });
    } finally {
      if (request.method === 'native') nativeRequests.delete(nativeKey(request.input));
    }
  });
});
