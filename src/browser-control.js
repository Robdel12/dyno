import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { validViewport } from './browser/viewport.js';
import { nativeCapabilities, normalizeNative } from './native.js';

let problem = (status, message) => Object.assign(new Error(message), { status });
let sameContext = (left, right) =>
  left &&
  right &&
  ['executionId', 'documentId', 'revision', 'width', 'height'].every(
    (key) => left[key] === right[key],
  );
let commands = [
  'pause',
  'continue',
  'inspect',
  'show-app',
  'stop',
  'rerun',
  'pause-on-failure',
  'viewport',
];

function screenshotOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw problem(400, 'Invalid screenshot options.');
  let {
    fullPage = false,
    animations = 'allow',
    caret = 'initial',
    mask = [],
    clip,
    maskColor = [255, 0, 255, 255],
  } = input;
  if (
    typeof fullPage !== 'boolean' ||
    !Array.isArray(maskColor) ||
    maskColor.length !== 4 ||
    maskColor.some((value) => !Number.isInteger(value) || value < 0 || value > 255) ||
    maskColor[3] !== 255 ||
    !['allow', 'disabled'].includes(animations) ||
    !['hide', 'initial'].includes(caret) ||
    !Array.isArray(mask) ||
    mask.length > 1000 ||
    mask.some(
      (rectangle) =>
        !rectangle ||
        !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rectangle[key])) ||
        rectangle.width < 0 ||
        rectangle.height < 0,
    ) ||
    (clip !== undefined &&
      (!clip ||
        !['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(clip[key])) ||
        clip.x < 0 ||
        clip.y < 0 ||
        clip.width < 1 ||
        clip.height < 1 ||
        !fullPage))
  )
    throw problem(
      400,
      'Screenshot options need a fullPage boolean, valid animations and caret, and mask rectangles.',
    );
  return Object.freeze({
    fullPage,
    animations,
    caret,
    maskColor: Object.freeze([...maskColor]),
    ...(clip
      ? { clip: Object.freeze({ x: clip.x, y: clip.y, width: clip.width, height: clip.height }) }
      : {}),
    mask: Object.freeze(
      mask.map(({ x, y, width, height }) => Object.freeze({ x, y, width, height })),
    ),
  });
}

function appImage(bytes, metrics, options) {
  if (
    bytes.length > 50_000_000 ||
    bytes.length < 24 ||
    bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a'
  )
    throw problem(502, 'The browser did not return a supported PNG image.');
  let width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width * height > 64_000_000)
    throw problem(
      422,
      'Screenshot exceeds 64 million pixels. Use a smaller viewport or pixel ratio.',
    );
  let pixelRatio = metrics.pixelRatio;
  let expected =
    options.clip ??
    (options.fullPage
      ? { width: metrics.fullWidth, height: metrics.fullHeight }
      : { width: metrics.hostWidth, height: metrics.hostHeight });
  if (
    Math.abs(width - Math.round(expected.width * pixelRatio)) > 1 ||
    Math.abs(height - Math.round(expected.height * pixelRatio)) > 1
  )
    throw problem(
      409,
      `Screenshot dimensions do not match the app document, viewport, and pixel ratio: expected ${Math.round(expected.width * pixelRatio)} × ${Math.round(expected.height * pixelRatio)}, received ${width} × ${height}.`,
    );
  let target = {
    width: Math.round(
      (options.clip?.width ?? (options.fullPage ? metrics.fullWidth : metrics.width)) * pixelRatio,
    ),
    height: Math.round(
      (options.clip?.height ?? (options.fullPage ? metrics.fullHeight : metrics.height)) *
        pixelRatio,
    ),
  };
  if (target.width < 1 || target.height < 1 || target.width > width || target.height > height)
    throw problem(409, 'The app viewport does not fit in the captured browser.');
  if (target.width === width && target.height === height && options.mask.length === 0)
    return { bytes, ...target, pixelRatio };
  let source = PNG.sync.read(bytes);
  let image = new PNG(target);
  PNG.bitblt(source, image, 0, 0, target.width, target.height, 0, 0);
  let color = Buffer.from(options.maskColor);
  for (let rectangle of options.mask) {
    if (rectangle.width === 0 || rectangle.height === 0) continue;
    let x = rectangle.x - (options.clip?.x ?? 0),
      y = rectangle.y - (options.clip?.y ?? 0);
    let left = Math.max(0, Math.min(image.width, Math.floor(x * pixelRatio)));
    let top = Math.max(0, Math.min(image.height, Math.floor(y * pixelRatio)));
    let right = Math.max(0, Math.min(image.width, Math.ceil((x + rectangle.width) * pixelRatio)));
    let bottom = Math.max(
      0,
      Math.min(image.height, Math.ceil((y + rectangle.height) * pixelRatio)),
    );
    if (right <= left || bottom <= top) continue;
    for (let y = top; y < bottom; y++)
      image.data.fill(color, (y * image.width + left) * 4, (y * image.width + right) * 4);
  }
  return { bytes: PNG.sync.write(image), ...target, pixelRatio };
}

export function createBrowserControl({ artifactsDir, onReplaced = () => {} }) {
  let session, launchKey, ownedRun;
  let connections = new Map(),
    contexts = new Map(),
    views = new Map(),
    streams = new Map(),
    records = new Map(),
    nativeExecutions = new Map(),
    nativeRequests = new Map(),
    requests = new Set(),
    canceled = new Set();
  let pending = new Set();
  let joins = Promise.resolve();
  let closed = false;
  let track = async (work) => {
    pending.add(work);
    try {
      return await work;
    } finally {
      pending.delete(work);
    }
  };
  let resetNative = async (runId, executionId = nativeExecutions.get(runId)?.executionId) => {
    let owner = nativeExecutions.get(runId);
    if (!owner || owner.executionId !== executionId) return;
    try {
      await track(session.resetNative({ runId, executionId }));
    } finally {
      // The session ends when native reset fails; do not retry its dead worker.
      if (nativeExecutions.get(runId) === owner) nativeExecutions.delete(runId);
    }
  };
  let broadcast = (runId, type, value) => {
    let event;
    for (let { response, role } of streams.get(runId) ?? []) {
      if (
        (type === 'snapshot' && role === 'host') ||
        (type === 'command' && role !== 'host') ||
        response.destroyed ||
        response.writableEnded
      )
        continue;
      if (response.writableLength > 8_000_000) {
        response.end();
        continue;
      }
      event ??= `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
      response.write(event);
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
    for (let request of nativeRequests.values())
      if (request.runId === runId && (endingRun || request.kind !== 'key'))
        request.controller.abort(problem(409, 'The native input context ended.'));
    for (let record of records.values()) {
      if (record.runId !== runId || record.status === 'accepted') continue;
      if (record.status === 'committed' && !endingRun) continue;
      void track(discard(record, endingRun)).catch(() => {});
    }
  };
  let active = (record) =>
    !closed &&
    !record.controller.signal.aborted &&
    sameContext(contexts.get(record.runId), record.context);
  return Object.freeze({
    attach(browser, key) {
      session = browser;
      launchKey = key;
    },
    join(runId, key, previous) {
      let joined = joins.then(async () => {
        if (closed) throw problem(409, 'This browser session is closed.');
        let owned = Boolean(launchKey && key === launchKey);
        let prior = previous && connections.get(previous.runId);
        let replaced = null;
        if (owned) replaced = ownedRun;
        else if (prior && prior.key === previous.connectionKey) replaced = previous.runId;
        if (owned) ownedRun = runId;
        if (replaced) {
          invalidate(replaced, true);
          await resetNative(replaced);
          broadcast(replaced, 'replacement', { runId });
          onReplaced(replaced);
        }
        if (closed) throw problem(409, 'This browser session is closed.');
        if (owned && ownedRun !== runId)
          throw problem(409, 'A newer managed browser run replaced this join.');
        let connection = Object.freeze({ key: randomUUID(), owned });
        connections.set(runId, connection);
        return {
          connectionKey: connection.key,
          owned,
          identity: owned ? session.identity : null,
          previousRunId: replaced,
          capabilities: owned
            ? session.capabilities
            : {
                screenshot: false,
                fullPage: false,
                hostViewport: false,
                native: nativeCapabilities(),
              },
        };
      });
      joins = joined.catch(() => {});
      return joined;
    },
    authorize,
    notify(runId, kind, value) {
      broadcast(runId, kind, value);
    },
    reload(runId) {
      if (
        ![...(streams.get(runId) ?? [])].some(
          (listener) => listener.role === 'host' && !listener.response.destroyed,
        )
      )
        throw problem(409, 'Open the test browser URL to run updated tests.');
      broadcast(runId, 'command', { command: 'reload' });
    },
    async finish(runId) {
      invalidate(runId, true);
      await resetNative(runId);
    },
    attachments(runId, executionId) {
      return [...records.values()]
        .filter(
          (record) =>
            record.runId === runId &&
            record.context.executionId === executionId &&
            record.status === 'committed',
        )
        .map((record) => record.metadata);
    },
    acceptAttachments(runId, executionId) {
      for (let record of records.values()) {
        if (
          record.runId === runId &&
          record.context.executionId === executionId &&
          record.status === 'committed'
        )
          records.set(record.id, Object.freeze({ ...record, status: 'accepted' }));
      }
    },
    drop(runId) {
      invalidate(runId, true);
      connections.delete(runId);
      views.delete(runId);
      for (let record of records.values())
        if (record.runId === runId && record.status === 'accepted') records.delete(record.id);
      for (let key of canceled) if (key.startsWith(`${runId}:`)) canceled.delete(key);
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
          Connection: 'keep-alive',
        });
        response.write(': connected\n\n');
        let role = url.searchParams.get('role') === 'host' ? 'host' : 'observer';
        if (role === 'observer' && views.has(runId))
          response.write(`event: snapshot\ndata: ${JSON.stringify(views.get(runId))}\n\n`);
        let listener = { response, role };
        let listeners = streams.get(runId) ?? new Set();
        listeners.add(listener);
        streams.set(runId, listeners);
        let hostConnected = () =>
          [...listeners].some(
            (item) =>
              item.role === 'host' && !item.response.destroyed && !item.response.writableEnded,
          );
        response.write(
          `event: host-status\ndata: ${JSON.stringify({ connected: hostConnected() })}\n\n`,
        );
        if (role === 'host') broadcast(runId, 'host-status', { connected: true });
        response.on('close', () => {
          listeners.delete(listener);
          if (role === 'host') broadcast(runId, 'host-status', { connected: hostConnected() });
        });
        return true;
      }
      if (route.startsWith('artifacts/') && request.method === 'GET') {
        let record = records.get(route.slice('artifacts/'.length));
        if (
          !record ||
          !['committed', 'accepted'].includes(record.status) ||
          record.metadata.status === 'skipped'
        )
          throw problem(404, 'Screenshot not found.');
        response.writeHead(200, {
          'Content-Type': 'image/png',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(await readFile(record.file));
        return true;
      }
      if (
        ![
          'view',
          'control',
          'command-result',
          'context',
          'operations',
          'operations/cancel',
          'attachments/commit',
          'attachments/discard',
        ].includes(route) ||
        request.method !== 'POST'
      )
        return false;
      if (route === 'control') {
        if (!connections.has(input.runId) || !commands.includes(input.command))
          throw problem(400, 'Unknown reporter command or run.');
        if (
          ![...(streams.get(input.runId) ?? [])].some(
            (listener) =>
              listener.role === 'host' &&
              !listener.response.destroyed &&
              !listener.response.writableEnded,
          )
        )
          throw problem(
            409,
            'The test browser is disconnected. Reopen its execution URL before sending commands.',
          );
        if (input.command === 'pause-on-failure' && typeof input.value !== 'boolean')
          throw problem(400, 'Pause on failure must be a boolean.');
        if (input.command === 'viewport' && !validViewport(input.viewport))
          throw problem(400, 'Invalid app viewport.');
        if (
          input.command === 'rerun' &&
          (!Array.isArray(input.ids) || input.ids.some((name) => typeof name !== 'string'))
        )
          throw problem(400, 'Invalid test selection.');
        broadcast(input.runId, 'command', { ...input, requestId: input.requestId ?? randomUUID() });
        send({ accepted: true });
        return true;
      }
      let connection = authorize(input);
      if (route === 'command-result') {
        broadcast(input.runId, 'command-result', {
          requestId: input.requestId,
          error: input.error,
        });
        send({});
        return true;
      }
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
      if (route === 'operations/cancel') {
        if (typeof input.executionId !== 'string' || typeof input.requestId !== 'string')
          throw problem(400, 'Invalid operation cancellation.');
        canceled.add(`${input.runId}:${input.executionId}:${input.requestId}`);
        nativeRequests
          .get(`${input.runId}:${input.executionId}:${input.requestId}`)
          ?.controller.abort(problem(409, 'Native input was cancelled.'));
        await Promise.all(
          [...records.values()]
            .filter(
              (record) =>
                record.runId === input.runId &&
                record.context.executionId === input.executionId &&
                record.requestId === input.requestId,
            )
            .map((record) => track(discard(record, true))),
        );
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
        if (
          !record ||
          record.runId !== input.runId ||
          record.status !== 'staged' ||
          !active(record)
        )
          throw problem(409, 'Screenshot is stale or already acknowledged.');
        await track(
          (async () => {
            try {
              await rename(record.partial, record.file);
              if (!active(record))
                throw problem(409, 'App changed before screenshot acknowledgement.');
              record = Object.freeze({ ...record, status: 'committed' });
              records.set(record.id, record);
              send(record.metadata);
            } catch (error) {
              await discard(record);
              throw error;
            }
          })(),
        );
        return true;
      }
      if (input.operation === 'activate') {
        if (!connection.owned || !session?.capabilities.screenshot)
          throw problem(422, 'Screenshots require an owned browser provider.');
        if (!sameContext(contexts.get(input.runId), input.context) || !input.context.documentId)
          throw problem(409, 'The screenshot document has changed.');
        await session.activate();
        send({});
        return true;
      }
      if (input.operation === 'resize') {
        if (!validViewport(input.viewport)) throw problem(400, 'Invalid app viewport.');
        if (connection.owned && session.capabilities.hostViewport)
          await session.resize({ ...input.viewport, current: input.current });
        send({});
        return true;
      }
      if (input.operation === 'reset-native') {
        if (typeof input.executionId !== 'string' || !input.executionId)
          throw problem(400, 'Native cleanup needs a test execution.');
        if (connection.owned) await resetNative(input.runId, input.executionId);
        send({});
        return true;
      }
      if (input.operation === 'native') {
        let native = normalizeNative(
          input.input,
          connection.owned ? session.capabilities.native : nativeCapabilities(),
        );
        if (!sameContext(contexts.get(input.runId), input.context) || !input.context?.documentId)
          throw problem(409, 'The native input document or viewport is stale.');
        if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 200)
          throw problem(400, 'Native input needs a unique request ID.');
        let key = `${input.runId}:${input.requestId}`;
        let canceledKey = `${input.runId}:${input.context.executionId}:${input.requestId}`;
        if (requests.has(key) || canceled.has(canceledKey))
          throw problem(409, 'Native input was already requested or cancelled.');
        requests.add(key);
        nativeExecutions.set(
          input.runId,
          Object.freeze({ executionId: input.context.executionId }),
        );
        let request = { runId: input.runId, kind: native.kind, controller: new AbortController() };
        nativeRequests.set(canceledKey, request);
        let result;
        try {
          result = await track(
            session.native(
              {
                runId: input.runId,
                requestId: input.requestId,
                context: input.context,
                input: native,
              },
              request.controller.signal,
            ),
          );
        } finally {
          nativeRequests.delete(canceledKey);
        }
        authorize(input);
        let current = contexts.get(input.runId);
        if (
          canceled.has(canceledKey) ||
          current?.executionId !== input.context.executionId ||
          (native.kind !== 'key' && !sameContext(current, input.context))
        )
          throw problem(409, 'Native input finished after its test document ended.');
        send(result);
        return true;
      }
      if (input.operation !== 'screenshot') throw problem(400, 'Unknown browser operation.');
      let options = screenshotOptions(input.options);
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
      if (canceled.has(`${input.runId}:${input.context.executionId}:${input.requestId}`))
        throw problem(409, 'Screenshot request was cancelled.');
      let key = `${input.runId}:${input.requestId}`;
      if (requests.has(key)) throw problem(409, 'Duplicate screenshot request.');
      requests.add(key);
      let id = randomUUID();
      let record = Object.freeze({
        id,
        runId: input.runId,
        requestId: input.requestId,
        context: Object.freeze({ ...input.context }),
        controller: new AbortController(),
        status: 'capturing',
        partial: join(artifactsDir, `${id}.partial`),
        file: join(artifactsDir, `${id}.png`),
      });
      if (!connection.owned || !session?.capabilities.screenshot) {
        if (!input.optional)
          throw problem(
            422,
            `Screenshot "${input.name}" is unavailable. This browser has no capture provider. Use a managed browser or explicitly optional capture.`,
          );
        record = Object.freeze({
          ...record,
          status: 'committed',
          metadata: Object.freeze({
            id,
            name: input.name,
            status: 'skipped',
            reason: 'This browser has no capture provider.',
          }),
        });
        records.set(id, record);
        send(record.metadata);
        return true;
      }
      if (options.fullPage && !session.capabilities.fullPage)
        throw problem(
          422,
          'Full-page screenshots are unavailable in this browser. Use a viewport screenshot.',
        );
      if (
        [...records.values()].some(
          (item) => item.runId === input.runId && ['capturing', 'staged'].includes(item.status),
        )
      )
        throw problem(409, 'A screenshot is already pending. Await it before another capture.');
      let metrics = input.metrics;
      if (
        !metrics ||
        metrics.width !== input.context.width ||
        metrics.height !== input.context.height ||
        !validViewport(
          { width: metrics.hostWidth, height: metrics.hostHeight },
          Number.MAX_SAFE_INTEGER,
        ) ||
        !Number.isFinite(metrics.pixelRatio) ||
        metrics.pixelRatio <= 0 ||
        metrics.hostWidth < metrics.width ||
        metrics.hostHeight < metrics.height ||
        (options.fullPage &&
          (!validViewport(
            { width: metrics.fullWidth, height: metrics.fullHeight },
            Number.MAX_SAFE_INTEGER,
          ) ||
            metrics.fullWidth < metrics.width ||
            metrics.fullHeight < metrics.height))
      )
        throw problem(
          409,
          `App viewport ${input.context.width} × ${input.context.height} does not fit browser viewport ${metrics?.hostWidth} × ${metrics?.hostHeight}.`,
        );
      let imageWidth =
        options.clip?.width ?? (options.fullPage ? metrics.fullWidth : metrics.hostWidth);
      let imageHeight =
        options.clip?.height ?? (options.fullPage ? metrics.fullHeight : metrics.hostHeight);
      if (
        options.clip &&
        (options.clip.x + options.clip.width > metrics.fullWidth ||
          options.clip.y + options.clip.height > metrics.fullHeight)
      )
        throw problem(409, 'The screenshot element no longer fits in the app document.');
      if (imageWidth * imageHeight * metrics.pixelRatio ** 2 > 64_000_000)
        throw problem(
          422,
          'Screenshot exceeds 64 million pixels. Use a smaller viewport or pixel ratio.',
        );
      records.set(id, record);
      let work = (async () => {
        try {
          let image = appImage(
            await session.capture(options, record.controller.signal),
            metrics,
            options,
          );
          if (!active(record))
            throw problem(409, 'App navigated or the test stopped before screenshot completed.');
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
            policy: Object.freeze({
              fullPage: options.clip ? false : options.fullPage,
              ...(options.clip ? { element: true } : {}),
              animations: options.animations,
              caret: options.caret,
              scale: 'device',
            }),
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
      await Promise.all([...nativeExecutions.keys()].map((runId) => resetNative(runId)));
    },
  });
}
