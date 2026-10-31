import { observerChange } from './browser/reporting.js';

// A slow observer retains one in-flight message and one latest view. It never
// holds up result acceptance or queues every intermediate run snapshot.
export function createObserver(response, reserve) {
  let previous, latest, publishing;
  let sequence = 0;
  let commands = [], queuedBytes = 0;
  let controller = new AbortController();
  let close = () => {
    latest = previous = undefined;
    commands = [];
    queuedBytes = 0;
    controller.abort(new Error('Reporter connection closed.'));
  };
  response.once('close', close);
  response.once('error', close);
  let write = async (message) => {
    controller.signal.throwIfAborted();
    let size = Buffer.byteLength(message);
    let release = size <= 8_000_000 ? reserve(size + message.length * 2) : null;
    if (!release) throw new Error('Reporter delivery reached its buffer limit. Close other reporters or open the saved report.');
    try {
      let bytes = Buffer.from(message);
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        controller.signal.throwIfAborted();
        if (response.write(bytes.subarray(offset, offset + 65536))) continue;
        await new Promise((resolve, reject) => {
          let cleanup = () => {
            response.removeListener('drain', drained);
            controller.signal.removeEventListener('abort', aborted);
          };
          let drained = () => { cleanup(); resolve(); };
          let aborted = () => { cleanup(); reject(controller.signal.reason); };
          response.once('drain', drained);
          controller.signal.addEventListener('abort', aborted, { once: true });
          if (controller.signal.aborted) aborted();
        });
      }
    } finally { release(); }
  };
  let frame = (kind, data) => write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
  let drain = () => {
    if (publishing || controller.signal.aborted) return;
    publishing = (async () => {
      while (commands.length || latest) {
        if (commands.length) {
          let [message, ...remaining] = commands;
          commands = remaining;
          queuedBytes -= Buffer.byteLength(message);
          await write(message);
          continue;
        }
        let view = latest;
        latest = undefined;
        let change = observerChange(previous, view);
        if (!change) continue;
        let reset = Boolean(change.snapshot);
        sequence = reset ? 0 : sequence + 1;
        let { tests: allTests, ...metadata } = view;
        let tests = reset ? allTests.map((value, position) => ({ value, position })) : change.tests;
        await frame('view-start', { sequence, reset, count: tests.length, set: reset ? metadata : change.set });
        for (let test of tests) await frame('view-tests', { sequence, tests: [test] });
        await frame(reset ? 'snapshot' : 'view-change', { sequence });
        previous = view;
      }
    })().catch((error) => {
      close();
      if (!response.destroyed && !response.writableEnded)
        response.end(`event: reporter-error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    }).finally(() => {
      publishing = undefined;
      if (!controller.signal.aborted && (latest || commands.length)) drain();
    });
  };
  return Object.freeze({
    publish(view) { if (!controller.signal.aborted) { latest = view; drain(); } },
    send(type, value) {
      if (controller.signal.aborted) return;
      let message = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
      queuedBytes += Buffer.byteLength(message);
      if (commands.length >= 32 || queuedBytes > 1_000_000) {
        response.destroy();
        return;
      }
      commands = [...commands, message];
      drain();
    },
  });
}
