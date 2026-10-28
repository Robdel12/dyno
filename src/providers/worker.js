let session;
let queue = Promise.resolve();
process.on('message', (request) => {
  queue = queue.then(async () => {
    try {
      let value;
      if (request.method === 'initialize') {
        // Provider dependencies are optional and loaded only in the owned worker.
        let provider = await import(`./${request.input.plan.provider}.js`);
        session = await provider.open(request.input.plan, request.input.viewport, () =>
          process.send?.({ kind: 'disconnected' })
        );
        value = session.identity;
      } else if (request.method === 'open') await session.open(request.input.url);
      else if (request.method === 'resize') await session.resize(request.input);
      else if (request.method === 'capture') value = (await session.capture()).toString('base64');
      else if (request.method === 'stop') await session?.stop();
      else throw new Error('Unknown browser operation.');
      process.send?.({ id: request.id, value });
    } catch (error) {
      process.send?.({ id: request.id, error: error.message });
    }
  });
});
