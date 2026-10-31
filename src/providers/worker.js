import { browserEngine } from '../browsers.js';
import { open as openWorker } from './playwright.js';

let browser;
let sessions = new Map();
let queues = new Map();
let requests = new Map();
let stopping = false;
let reply = (message) => {
  if (!process.connected) return;
  try { process.send(message, () => {}); }
  catch { /* The parent owns process shutdown after an IPC disconnect. */ }
};

async function perform(request) {
  let { method, input, workerId } = request;
  if (method === 'initialize') {
    browser = await browserEngine(input.name).connect(input.endpoint);
    return;
  }
  if (method === 'stop') {
    stopping = true;
    await Promise.allSettled([...queues.values()]);
    let results = await Promise.allSettled([...sessions.values()].map((session) => session.stop()));
    let failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Could not close browser contexts.');
    return;
  }
  if (stopping) throw new Error('The browser pool is stopping.');
  if (method === 'create') {
    if (sessions.has(workerId)) throw new Error('Browser worker already exists.');
    let session = await openWorker(browser, input.plan, input.viewport,
      () => reply({ kind: 'disconnected', workerId }),
      (message) => reply({ kind: 'diagnostic', workerId, message: message.slice(0, 4000) }));
    sessions.set(workerId, session);
    return session.identity;
  }
  let session = sessions.get(workerId);
  if (!session) throw new Error('Unknown browser worker.');
  if (method === 'open') await session.open(input.url);
  else if (method === 'activate') await session.activate();
  else if (method === 'retire') await session.retire(input.url);
  else if (method === 'resize') await session.resize(input);
  else if (method === 'capture') return (await session.capture(input)).toString('base64');
  else if (method === 'native') return session.native(input);
  else if (method === 'resetNative') await session.resetNative(input);
  else if (method === 'dispose') await session.stop();
  else throw new Error('Unknown browser operation.');
}

process.on('message', (request) => {
  if (request.kind === 'cancel-operation') {
    let pending = requests.get(request.id);
    if (!pending) return;
    pending.cancelled = true;
    if (request.method === 'native') sessions.get(request.workerId)?.cancelNative(request.input);
    return;
  }
  let pending = { cancelled: false };
  requests.set(request.id, pending);
  let work = async () => {
    try {
      if (pending.cancelled) throw new Error('Browser operation cancelled before dispatch.');
      let value = await perform(request);
      reply({ id: request.id, value });
    } catch (error) {
      reply({ id: request.id, error: error.message });
    } finally {
      requests.delete(request.id);
    }
  };
  // Each context preserves native/capture ordering without blocking its peers.
  if (request.workerId) {
    let queued = (queues.get(request.workerId) ?? Promise.resolve()).then(work);
    queues.set(request.workerId, queued);
    let clear = () => { if (queues.get(request.workerId) === queued) queues.delete(request.workerId); };
    queued.then(clear, clear);
  } else void work();
});
