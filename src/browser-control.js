import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { validViewport } from './browser/viewport.js';

let problem = (status, message) => Object.assign(new Error(message), { status });
let sameContext = (left, right) =>
  left &&
  right &&
  ['executionId', 'documentId', 'revision', 'width', 'height'].every((key) => left[key] === right[key]);
let commands = ['pause', 'continue', 'inspect', 'show-app', 'stop', 'rerun', 'pause-on-failure', 'viewport'];

function appImage(bytes, metrics) {
  if (bytes.length > 50_000_000 || bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a')
    throw problem(502, 'The browser did not return a supported PNG image.');
  let width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width * height > 64_000_000)
    throw problem(422, 'Screenshot exceeds 64 million pixels. Use a smaller viewport or pixel ratio.');
  let pixelRatio = metrics.pixelRatio;
  if (
    Math.abs(width - Math.round(metrics.hostWidth * pixelRatio)) > 1 ||
    Math.abs(height - Math.round(metrics.hostHeight * pixelRatio)) > 1
  )
    throw problem(409, 'Screenshot dimensions do not match the browser viewport and pixel ratio.');
  let target = { width: Math.round(metrics.width * pixelRatio), height: Math.round(metrics.height * pixelRatio) };
  if (target.width < 1 || target.height < 1 || target.width > width || target.height > height)
    throw problem(409, 'The app viewport does not fit in the captured browser.');
  if (target.width === width && target.height === height) return { bytes, ...target, pixelRatio };
  let source = PNG.sync.read(bytes);
  let image = new PNG(target);
  PNG.bitblt(source, image, 0, 0, target.width, target.height, 0, 0);
  return { bytes: PNG.sync.write(image), ...target, pixelRatio };
}

export function createBrowserControl({ artifactsDir, onReplaced = () => {} }) {
  let session, launchKey, ownedRun;
  let connections = new Map(),
    contexts = new Map(),
    views = new Map(),
    streams = new Map(),
    records = new Map(),
    requests = new Set();
  let pending = new Set();
  let closed = false;
  let track = async (work) => {
    pending.add(work);
    try {
      return await work;
    } finally {
      pending.delete(work);
    }
  };
  let broadcast = (runId, type, value) => {
    let event = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
    for (let { response, role } of streams.get(runId) ?? []) {
      if ((type === 'snapshot' && role === 'host') || (type === 'command' && role !== 'host')) continue;
      if (response.writableLength > 8_000_000) response.end();
      else response.write(event);
    }
  };
  let authorize = (input) => {
    if (closed) throw problem(409, 'This browser session is closed.');
    let connection = connections.get(input.runId);
    if (!connection || connection.key !== input.connectionKey)
      throw problem(403, 'This connection does not own that browser run.');
    if (connection.owned && ownedRun !== input.runId)
      throw problem(409, 'This managed browser has moved to another run.');
    return connection;
  };
  let discard = async (record, includeCommitted = false) => {
    if (record.status === 'accepted') return;
    record.controller.abort(problem(409, 'Screenshot context ended.'));
    if (record.status !== 'committed' || includeCommitted) {
      records.delete(record.id);
      await rm(record.partial, { force: true });
      await rm(record.file, { force: true });
    }
  };
  let invalidate = (runId, endingRun = false) => {
    contexts.delete(runId);
    for (let record of records.values()) {
      if (record.runId !== runId || record.status === 'accepted') continue;
      if (record.status === 'committed' && !endingRun) continue;
      void track(discard(record, endingRun)).catch(() => {});
    }
  };
  let active = (record) =>
    !closed && !record.controller.signal.aborted && sameContext(contexts.get(record.runId), record.context);
  return Object.freeze({
    attach(browser, key) {
      session = browser;
      launchKey = key;
    },
    join(runId, key, previous) {
      let owned = Boolean(launchKey && key === launchKey);
      let prior = previous && connections.get(previous.runId);
      let replaced = null;
      if (owned) replaced = ownedRun;
      else if (prior && prior.key === previous.connectionKey) replaced = previous.runId;
      if (replaced) {
        invalidate(replaced, true);
        broadcast(replaced, 'replacement', { runId });
        onReplaced(replaced);
      }
      if (owned) ownedRun = runId;
      let connection = Object.freeze({ key: randomUUID(), owned });
      connections.set(runId, connection);
      return {
        connectionKey: connection.key,
        owned,
        identity: owned ? session.identity : null,
        capabilities: owned ? session.capabilities : { screenshot: false, hostViewport: false }
      };
    },
    authorize,
    finish: (runId) => invalidate(runId, true),
    attachments(runId, executionId) {
      return [...records.values()]
        .filter(
          (record) =>
            record.runId === runId && record.context.executionId === executionId && record.status === 'committed'
        )
        .map((record) => record.metadata);
    },
    acceptAttachments(runId, executionId) {
      for (let record of records.values()) {
        if (record.runId === runId && record.context.executionId === executionId && record.status === 'committed')
          records.set(record.id, Object.freeze({ ...record, status: 'accepted' }));
      }
    },
    drop(runId) {
      invalidate(runId, true);
      connections.delete(runId);
      views.delete(runId);
      for (let record of records.values())
        if (record.runId === runId && record.status === 'accepted') records.delete(record.id);
      for (let key of requests) if (key.startsWith(`${runId}:`)) requests.delete(key);
      for (let { response } of streams.get(runId) ?? []) response.end();
      streams.delete(runId);
    },
    async handle(route, url, request, response, input) {
      let send = (value, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (route === 'stream' && request.method === 'GET') {
        let runId = url.searchParams.get('run');
        if (!connections.has(runId)) throw problem(404, 'Unknown browser run.');
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        });
        response.write(': connected\n\n');
        let role = url.searchParams.get('role') === 'host' ? 'host' : 'observer';
        if (role === 'observer' && views.has(runId))
          response.write(`event: snapshot\ndata: ${JSON.stringify(views.get(runId))}\n\n`);
        let listener = { response, role };
        let listeners = streams.get(runId) ?? new Set();
        listeners.add(listener);
        streams.set(runId, listeners);
        response.on('close', () => listeners.delete(listener));
        return true;
      }
      if (route.startsWith('artifacts/') && request.method === 'GET') {
        let record = records.get(route.slice('artifacts/'.length));
        if (!record || !['committed', 'accepted'].includes(record.status) || record.metadata.status === 'skipped')
          throw problem(404, 'Screenshot not found.');
        response.writeHead(200, { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' });
        response.end(await readFile(record.file));
        return true;
      }
      if (
        !['view', 'control', 'context', 'operations', 'attachments/commit', 'attachments/discard'].includes(route) ||
        request.method !== 'POST'
      )
        return false;
      if (route === 'control') {
        if (!connections.has(input.runId) || !commands.includes(input.command))
          throw problem(400, 'Unknown reporter command or run.');
        if (
          ![...(streams.get(input.runId) ?? [])].some(
            (listener) => listener.role === 'host' && !listener.response.destroyed && !listener.response.writableEnded
          )
        )
          throw problem(409, 'The test browser is disconnected. Reopen its execution URL before sending commands.');
        if (input.command === 'pause-on-failure' && typeof input.value !== 'boolean')
          throw problem(400, 'Pause on failure must be a boolean.');
        if (input.command === 'viewport' && !validViewport(input.viewport)) throw problem(400, 'Invalid app viewport.');
        if (
          input.command === 'rerun' &&
          (!Array.isArray(input.names) || input.names.some((name) => typeof name !== 'string'))
        )
          throw problem(400, 'Invalid test selection.');
        broadcast(input.runId, 'command', { ...input, id: randomUUID() });
        send({ accepted: true });
        return true;
      }
      let connection = authorize(input);
      if (route === 'view') {
        if (!input.view || typeof input.view !== 'object' || !Array.isArray(input.view.tests))
          throw problem(400, 'Invalid execution snapshot.');
        views.set(input.runId, Object.freeze(input.view));
        broadcast(input.runId, 'snapshot', input.view);
        send({});
        return true;
      }
      if (route === 'context') {
        let previous = contexts.get(input.runId);
        if (!sameContext(previous, input.context)) invalidate(input.runId);
        if (input.context) {
          if (
            !validViewport(input.context, Number.MAX_SAFE_INTEGER) ||
            typeof input.context.executionId !== 'string' ||
            (input.context.documentId !== null && typeof input.context.documentId !== 'string') ||
            !Number.isInteger(input.context.revision)
          )
            throw problem(400, 'Invalid execution context.');
          contexts.set(input.runId, Object.freeze({ ...input.context }));
        } else contexts.delete(input.runId);
        send({});
        return true;
      }
      if (route === 'attachments/discard') {
        let record = records.get(input.id);
        if (record?.runId === input.runId) {
          await track(discard(record, true));
        }
        send({});
        return true;
      }
      if (route === 'attachments/commit') {
        let record = records.get(input.id);
        if (!record || record.runId !== input.runId || record.status !== 'staged' || !active(record))
          throw problem(409, 'Screenshot is stale or already acknowledged.');
        await track(
          (async () => {
            try {
              await rename(record.partial, record.file);
              if (!active(record)) throw problem(409, 'App changed before screenshot acknowledgement.');
              record = Object.freeze({ ...record, status: 'committed' });
              records.set(record.id, record);
              send(record.metadata);
            } catch (error) {
              await discard(record);
              throw error;
            }
          })()
        );
        return true;
      }
      if (input.operation === 'resize') {
        if (!validViewport(input.viewport)) throw problem(400, 'Invalid app viewport.');
        if (connection.owned && session.capabilities.hostViewport)
          await session.resize({ ...input.viewport, current: input.current });
        send({});
        return true;
      }
      if (input.operation !== 'screenshot') throw problem(400, 'Unknown browser operation.');
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 200 ||
        (input.optional !== undefined && typeof input.optional !== 'boolean')
      )
        throw problem(400, 'Screenshot needs a name of 1–200 characters and an optional boolean.');
      if (
        typeof input.requestId !== 'string' ||
        !sameContext(contexts.get(input.runId), input.context) ||
        !input.context.documentId
      )
        throw problem(409, 'Screenshot document or viewport is stale.');
      let key = `${input.runId}:${input.requestId}`;
      if (requests.has(key)) throw problem(409, 'Duplicate screenshot request.');
      requests.add(key);
      let id = randomUUID();
      let record = Object.freeze({
        id,
        runId: input.runId,
        context: Object.freeze({ ...input.context }),
        controller: new AbortController(),
        status: 'capturing',
        partial: join(artifactsDir, `${id}.partial`),
        file: join(artifactsDir, `${id}.png`)
      });
      if (!connection.owned || !session?.capabilities.screenshot) {
        if (!input.optional)
          throw problem(
            422,
            `Screenshot "${input.name}" is unavailable. This browser has no capture provider. Use a managed browser or explicitly optional capture.`
          );
        record = Object.freeze({
          ...record,
          status: 'committed',
          metadata: Object.freeze({
            id,
            name: input.name,
            status: 'skipped',
            reason: 'This browser has no capture provider.'
          })
        });
        records.set(id, record);
        send(record.metadata);
        return true;
      }
      if (
        [...records.values()].some(
          (item) => item.runId === input.runId && ['capturing', 'staged'].includes(item.status)
        )
      )
        throw problem(409, 'A screenshot is already pending. Await it before another capture.');
      let metrics = input.metrics;
      if (
        !metrics ||
        metrics.width !== input.context.width ||
        metrics.height !== input.context.height ||
        !validViewport({ width: metrics.hostWidth, height: metrics.hostHeight }, Number.MAX_SAFE_INTEGER) ||
        !Number.isFinite(metrics.pixelRatio) ||
        metrics.pixelRatio <= 0 ||
        metrics.hostWidth < metrics.width ||
        metrics.hostHeight < metrics.height
      )
        throw problem(
          409,
          `App viewport ${input.context.width} × ${input.context.height} does not fit browser viewport ${metrics?.hostWidth} × ${metrics?.hostHeight}.`
        );
      if (metrics.hostWidth * metrics.hostHeight * metrics.pixelRatio ** 2 > 64_000_000)
        throw problem(422, 'Screenshot exceeds 64 million pixels. Use a smaller viewport or pixel ratio.');
      records.set(id, record);
      let work = (async () => {
        try {
          let image = appImage(await session.capture(record.controller.signal), metrics);
          if (!active(record)) throw problem(409, 'App navigated or the test stopped before screenshot completed.');
          await mkdir(artifactsDir, { recursive: true });
          await writeFile(record.partial, image.bytes, { flag: 'wx' });
          if (!active(record)) throw problem(409, 'App changed while saving the screenshot.');
          let metadata = Object.freeze({
            id,
            name: input.name,
            status: 'captured',
            path: record.file,
            url: `/__dyno__/artifacts/${id}`,
            width: image.width,
            height: image.height,
            pixelRatio: image.pixelRatio,
            viewport: Object.freeze({ width: metrics.width, height: metrics.height }),
            browser: session.identity,
            policy: Object.freeze({ animations: 'allow', caret: 'initial', scale: 'device' })
          });
          record = Object.freeze({ ...record, metadata, status: 'staged' });
          records.set(id, record);
          send({ id, status: 'staged' });
        } catch (error) {
          await discard(record);
          throw error;
        }
      })();
      await track(work);
      return true;
    },
    async close() {
      closed = true;
      for (let runId of connections.keys()) invalidate(runId, true);
      for (let listeners of streams.values()) for (let { response } of listeners) response.end();
      await Promise.allSettled([...pending]);
    }
  });
}
