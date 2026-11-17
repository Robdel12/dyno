import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  defaultFixturePath, fixtureBasePath, fixtureError, fixtureErrorResponse, fixtureIdentity,
  fixtureOperationName, fixtureRequestLimit, fixtureScope,
  readFixtureResponse, snapshotFixtureTransport, snapshotJson
} from './fixture-protocol.js';

let same = (first, second) => {
  let a = Buffer.from(first), b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
};
let ownRecord = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
let exact = (value, keys) => ownRecord(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
let silence = promise => { void promise.catch(() => {}); return promise; };
let safeFailure = (error, fallback) => {
  let code = fixtureErrorResponse(error).error.code;
  return fixtureError(code === 'operation_failed' && error?.code !== 'operation_failed' ? fallback : code, { cause: error });
};
let invoke = (work, code) => {
  try { return silence(Promise.resolve(work()).catch(cause => { throw fixtureError(code, { cause }); })); }
  catch (cause) { return silence(Promise.reject(fixtureError(code, { cause }))); }
};
let waitFor = (promise, signal) => {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let aborted = () => reject(signal.reason);
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
};
let tokenValue = token => {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw new TypeError('Fixture control requires a private token of 32–256 ASCII letters, digits, underscores or hyphens.');
  return token;
};
let combineFailures = results => {
  let errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw fixtureError('drain_failed', {
    cause: errors.length === 1 ? errors[0] : new AggregateError(errors, 'Fixture cleanup failed.')
  });
};

/**
 * Compose named app operations without changing their definitions. Duplicate names fail immediately.
 *
 * @api defineFixtureOperations
 */
export function defineFixtureOperations(...maps) {
  let entries = [], names = new Set();
  for (let map of maps) {
    if (!ownRecord(map)) throw new TypeError('Fixture operations must be plain records.');
    for (let key of Reflect.ownKeys(map)) {
      fixtureOperationName(key);
      let descriptor = Object.getOwnPropertyDescriptor(map, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'function' || names.has(key))
        throw new TypeError('Fixture operation names must be unique and own ordinary functions.');
      names.add(key); entries.push([key, descriptor.value]);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * Control fixture access for one app worker. Operations receive `(context, input, execution)`; reset and drain receive `(context, execution)`. Execution has IDs and an abort signal. For reset support, the controller immediately pauses app requests when created.
 *
 * @api createFixtureController
 */
export function createFixtureController({ workerId, context, operations = {}, pause, reset, drain } = {}) {
  if (typeof workerId !== 'string' || !workerId || workerId.length > 256)
    throw new TypeError('Fixture controllers require a worker ID.');
  for (let callback of [pause, reset, drain])
    if (callback !== undefined && typeof callback !== 'function') throw new TypeError('Fixture lifecycle callbacks must be functions.');
  if (reset && !pause) throw new TypeError('Fixture reset requires pause() to hold app admission.');
  operations = defineFixtureOperations(operations);
  let phase = 'idle', current, closing;
  let pending = new Set(), holds = new Set();
  let acquire = () => {
    if (!pause) return;
    let hold = pause();
    if (!hold || typeof hold.idle !== 'function' || typeof hold.resume !== 'function')
      throw new TypeError('pause() must synchronously return { idle, resume }.');
    holds.add(hold);
  };
  acquire();
  let idle = signal => Promise.allSettled([...holds].map(hold => invoke(() => hold.idle({ signal }), 'drain_failed')))
    .then(combineFailures);
  let identity = input => {
    let value = fixtureIdentity(input);
    if (value.workerId !== workerId) throw fixtureError('execution_conflict');
    return value;
  };
  let owns = value => current && ['runId', 'workerId', 'executionId'].every(key => current.identity[key] === value[key]);
  let execution = (owner, signal = new AbortController().signal) => Object.freeze({ ...owner.identity, signal });
  let startDrain = (owner, signal) => {
    if (!owner.drainWork) owner.drainWork = invoke(() => drain?.(context, execution(owner, signal)), 'drain_failed');
    return owner.drainWork;
  };
  let seal = () => {
    current?.abort.abort(fixtureError('execution_conflict'));
    if (!holds.size) acquire();
  };
  let join = (owner, signal, preparing = false) => {
    // App drain starts first: it may release a stream or operation that idle is waiting for.
    let appWork = owner ? startDrain(owner, signal) : Promise.resolve();
    let tasks = [appWork, idle(signal)];
    if (preparing && owner?.preparation) tasks.push(owner.preparation);
    let operationsDone = Promise.allSettled([...pending]);
    return Promise.all([Promise.allSettled(tasks), operationsDone]).then(([results]) => combineFailures(results));
  };
  return Object.freeze({
    begin(input, { signal } = {}) {
      let value;
      try {
        value = identity(input);
        if (phase !== 'idle') throw fixtureError('execution_conflict');
      } catch (error) { return Promise.reject(error); }
      let owner = { identity: value, scope: Object.freeze({ ...value, token: randomBytes(32).toString('hex') }),
        abort: new AbortController(), preparation: null, drainWork: null, drainAttempt: null };
      current = owner; phase = 'preparing';
      let preparationSignal = signal ? AbortSignal.any([signal, owner.abort.signal]) : owner.abort.signal;
      owner.preparation = silence((async () => {
        await idle(preparationSignal);
        preparationSignal.throwIfAborted();
        if (phase !== 'preparing' || current !== owner) throw fixtureError('execution_conflict');
        let fixtures = await invoke(() => reset?.(context, execution(owner, preparationSignal)), 'reset_failed');
        if (fixtures === undefined) fixtures = {};
        if (!ownRecord(fixtures)) throw fixtureError('invalid_result');
        let result;
        try { result = snapshotJson({ fixtures, scope: owner.scope }); }
        catch (cause) { throw fixtureError('invalid_result', { cause }); }
        preparationSignal.throwIfAborted();
        if (phase !== 'preparing' || current !== owner) throw fixtureError('execution_conflict');
        try {
          for (let hold of holds) {
            let resumed = hold.resume();
            if (resumed && typeof resumed.then === 'function') {
              silence(Promise.resolve(resumed));
              throw new TypeError('Admission holds must resume synchronously.');
            }
            holds.delete(hold);
          }
        } catch (cause) {
          try { acquire(); }
          catch (reclose) { cause = new AggregateError([cause, reclose], 'Could not reclose app admission.'); }
          throw fixtureError('reset_failed', { cause });
        }
        // Admission is committed now; a caller disconnect cannot undo a completed resume.
        phase = 'open';
        owner.committed = true;
        return result;
      })());
      return waitFor(owner.preparation, preparationSignal).catch(error => {
        if (owner.committed) return owner.preparation;
        if (phase !== 'closed') phase = 'failed';
        owner.abort.abort(fixtureError('execution_conflict'));
        throw safeFailure(error, 'reset_failed');
      });
    },
    dispatch(input, { signal } = {}) {
      let request, owner, work;
      try {
        try { request = snapshotJson(input, { maxBytes: fixtureRequestLimit }); }
        catch (cause) { throw fixtureError(cause instanceof RangeError ? 'input_too_large' : 'invalid_request', { cause }); }
        if (!exact(request, ['scope', 'name', 'input'])) throw fixtureError('invalid_request');
        let scope = fixtureScope(request.scope);
        if (phase !== 'open' || !owns(scope) || !same(scope.token, current.scope.token))
          throw fixtureError('execution_conflict');
        let name = fixtureOperationName(request.name);
        if (!Object.hasOwn(operations, name)) throw fixtureError('unknown_operation');
        signal?.throwIfAborted();
        owner = current;
        let operationSignal = signal ? AbortSignal.any([signal, owner.abort.signal]) : owner.abort.signal;
        work = invoke(() => operations[name](context, request.input, execution(owner, operationSignal)), 'operation_failed')
          .then(value => {
            try { return snapshotJson({ value }).value; }
            catch (cause) { throw fixtureError('invalid_result', { cause }); }
          });
        pending.add(work);
        void work.then(() => pending.delete(work), () => pending.delete(work));
      } catch (error) { return Promise.reject(safeFailure(error, 'operation_failed')); }
      return waitFor(work, signal).then(value => {
        if (phase !== 'open' || current !== owner) throw fixtureError('execution_conflict');
        return value;
      }, error => { throw safeFailure(error, 'operation_failed'); });
    },
    drain(input, { signal } = {}) {
      try {
        let value = identity(input);
        if (!owns(value) || phase === 'closed') throw fixtureError('execution_conflict');
        if (current.drainAttempt) return current.drainAttempt;
        if (phase !== 'open') throw fixtureError('execution_conflict');
        phase = 'draining'; seal();
        let owner = current;
        let actual = silence(join(owner, signal));
        owner.drainAttempt = silence(waitFor(actual, signal).then(() => {
          if (phase !== 'draining' || current !== owner) throw fixtureError('execution_conflict');
          phase = 'idle';
        }).catch(error => {
          if (phase !== 'closed') phase = 'failed';
          throw safeFailure(error, 'drain_failed');
        }));
        return owner.drainAttempt;
      } catch (cause) {
        if (phase === 'draining') phase = 'failed';
        return Promise.reject(safeFailure(cause, 'drain_failed'));
      }
    },
    close({ signal } = {}) {
      if (closing) return closing;
      phase = 'closed';
      let problem;
      try { seal(); } catch (cause) { problem = fixtureError('drain_failed', { cause }); }
      let actual = silence(join(current, signal, true).then(() => { if (problem) throw problem; }));
      closing = silence(waitFor(actual, signal).catch(error => {
        throw safeFailure(error, 'drain_failed');
      }));
      return closing;
    }
  });
}

let originAllowed = request => {
  let origin = request.headers.origin;
  return origin === undefined || origin === `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
};
let readInput = async request => {
  let chunks = [], length = 0;
  for await (let chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > fixtureRequestLimit) throw fixtureError('input_too_large');
    chunks.push(chunk);
  }
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return snapshotJson(JSON.parse(text), { maxBytes: fixtureRequestLimit });
  } catch (cause) { throw fixtureError('invalid_request', { cause }); }
};

/**
 * Handle fixed POST begin/call/drain routes in an outer Node listener. Returns false outside its path.
 * Keep this handler reachable while the app is paused; the control token never belongs in browser fixtures.
 *
 * @api createFixtureHttpHandler
 */
export function createFixtureHttpHandler(controller, { token, path = defaultFixturePath } = {}) {
  tokenValue(token); path = fixtureBasePath(path);
  if (!controller || ['begin', 'dispatch', 'drain'].some(key => typeof controller[key] !== 'function'))
    throw new TypeError('Fixture HTTP handlers require a fixture controller.');
  return async (request, response) => {
    let raw = request.url ?? '';
    let pathname = raw.split(/[?#]/, 1)[0];
    if (pathname !== path && !pathname.startsWith(path + '/')) return false;
    let abort = new AbortController();
    let disconnected = () => {
      if (!response.writableFinished) abort.abort(fixtureError('execution_conflict'));
    };
    request.once('aborted', disconnected);
    request.once('error', disconnected);
    response.once('close', disconnected);
    response.setHeader('Cache-Control', 'no-store');
    let consumed = false;
    try {
      let action = pathname.slice(path.length + 1);
      if (!['begin', 'call', 'drain'].includes(action) || raw !== pathname)
        throw fixtureError('unknown_route');
      if (request.method !== 'POST') throw fixtureError('method_not_allowed');
      if (!originAllowed(request)) throw fixtureError('forbidden');
      if (action !== 'call' && !same(request.headers.authorization ?? '', `Bearer ${token}`))
        throw fixtureError('forbidden');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''))
        throw fixtureError('unsupported_media_type');
      if (Number(request.headers['content-length']) > fixtureRequestLimit) throw fixtureError('input_too_large');
      let input = await readInput(request); consumed = true;
      let value = action === 'begin' ? await controller.begin(input, { signal: abort.signal })
        : action === 'drain' ? await controller.drain(input, { signal: abort.signal })
          : { value: await controller.dispatch(input, { signal: abort.signal }) };
      if (response.destroyed) return true;
      if (action === 'drain') response.writeHead(204).end();
      else {
        let body;
        try { body = JSON.stringify(snapshotJson(value)); }
        catch (cause) { throw fixtureError('invalid_result', { cause }); }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(body);
      }
    } catch (error) {
      if (!response.destroyed && !response.headersSent) {
        let result = fixtureErrorResponse(error);
        if (!consumed) response.setHeader('Connection', 'close');
        if (result.error.code === 'method_not_allowed') response.setHeader('Allow', 'POST');
        response.writeHead(fixtureError(result.error.code).status, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result));
      }
    } finally {
      request.removeListener('aborted', disconnected);
      request.removeListener('error', disconnected);
      response.removeListener('close', disconnected);
    }
    return true;
  };
}

/**
 * Connect Node worker callbacks to the app's fixed fixture protocol. Calls never retry or follow redirects.
 * `begin` returns execution fixtures and a same-origin browser binding; `drain` returns no browser data.
 *
 * @api connectFixtureControl
 */
export function connectFixtureControl({ url, workerId, token, path = defaultFixturePath } = {}) {
  tokenValue(token); path = fixtureBasePath(path);
  let target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
    target.search || target.hash || target.pathname !== '/')
    throw new TypeError('Fixture control URL must be an HTTP origin without credentials or a path.');
  fixtureIdentity({ workerId, runId: 'validate', executionId: 'validate' });
  let call = async (action, context) => {
    let identity = fixtureIdentity({ runId: context.runId, workerId: context.workerId, executionId: context.executionId });
    if (identity.workerId !== workerId) throw fixtureError('execution_conflict');
    let response;
    try {
      response = await fetch(new URL(path + '/' + action, target), {
        method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(identity), signal: context.signal, redirect: 'error'
      });
    } catch (cause) { throw fixtureError('operation_failed', { cause }); }
    if (action === 'drain' && response.status === 204) return;
    let result = await readFixtureResponse(response);
    if (action !== 'begin' || response.status !== 200 || !exact(result, ['fixtures', 'scope']) || !ownRecord(result.fixtures))
      throw fixtureError('invalid_result');
    let transport;
    try { transport = snapshotFixtureTransport({ path: path + '/call', scope: result.scope }, identity); }
    catch (cause) { throw fixtureError('invalid_result', { cause }); }
    return Object.freeze({ fixtures: result.fixtures, fixtureTransport: transport });
  };
  return Object.freeze({
    begin: context => call('begin', context),
    drain: context => call('drain', context)
  });
}

/**
 * @guide fixtures Named app fixtures
 * Use `app.fixture` to create committed records through your app's real factories, then test them through the UI. Import the Node helpers from `dyno/fixtures`; your app keeps its factories and database connections.
 *
 * ```js
 * import { defineFixtureOperations, createFixtureController, createFixtureHttpHandler } from 'dyno/fixtures';
 *
 * let controller = createFixtureController({
 *   workerId,
 *   context: { db, factories },
 *   operations: defineFixtureOperations({
 *     'seed.user': ({ factories }, input, { signal }) => factories.createUser(input, { signal }),
 *   }),
 *   pause: () => appRequests.pause(),
 *   reset: ({ db }, { signal }) => resetDatabase(db, { signal }),
 *   drain: (_context, { signal }) => stopAndJoinAppJobs({ signal }),
 * });
 * let handleFixtures = createFixtureHttpHandler(controller, { token: privateControlToken });
 * ```
 *
 * Call `handleFixtures(request, response)` before your normal Node app handler. It returns whether it handled the request. Keep it reachable while app requests are paused. If your framework already parses requests, call `controller.dispatch()` directly.
 *
 * Connect the worker's lifecycle callbacks in Node setup:
 *
 * ```js
 * import { connectFixtureControl } from 'dyno/fixtures';
 *
 * let control = connectFixtureControl({ url: appOrigin, workerId, token: privateControlToken });
 * return {
 *   beforeExecution: control.begin,
 *   drain: control.drain,
 *   teardown: () => stopOwnedAppResources(),
 * };
 * ```
 *
 * Close the controller before releasing its app dependencies. For reset support, `pause()` must immediately return a hold with `idle({ signal })` and `resume()`. Creating the controller takes that hold, blocking new app work.
 *
 * Before each test, `begin` waits for existing work, resets the app, then resumes requests. Once resumed, the worker is prepared even if the reply is lost; you can still drain it by execution ID. Drain blocks new work and starts your drain callback before waiting, so the callback can stop producers or close streams. Requests stay paused until the next successful preparation. Failed or cancelled reset/drain leaves them paused.
 *
 * In a test, call `await app.fixture('seed.user', { email: 'alice@example.test' })`, then use navigation and Interactor to exercise the app. Omitted input means `null`. Operations return JSON. Reset may return an object of fixture values or `undefined`; drain returns no browser data.
 *
 * The default routes are POST `/__dyno_fixtures__/begin`, `/call` and `/drain`. To change them, set the same base `path` on the handler and control client. The private control token stays in Node. Browser calls get a same-origin path and a token for their execution only. Calls never retry or follow redirects. Keep tokens and returned records out of logs.
 *
 * Input is limited to 64 KiB, result envelopes to 1 MiB, and JSON depth to 64. Use plain JSON: no undefined properties, functions, dates, custom serializers, sparse arrays or cycles. Callback errors use fixed public messages; the original cause stays in Node.
 *
 * Cancelling a request can't undo committed writes or queued work. Honor the operation's signal; the controller waits for the operation to finish. Your app still owns jobs, service workers, database reset, shutdown, and ordinary requests that arrive late. Closing the controller is permanent: it uses a separate cleanup signal and never reopens requests.
 */

/**
 * Plain JSON accepted by fixture operations: finite numbers, strings, booleans, null, dense arrays and plain records. Runtime validation rejects custom serializers and values JSON would silently drop.
 * @api JsonValue
 */
/**
 * Run, worker and execution identity supplied by Dyno's coordinator.
 * @api FixtureIdentity
 */
/**
 * Execution identity plus its short-lived browser operation capability. Never reuse it across tests or log its token.
 * @api FixtureScope
 */
/**
 * Explicit operation identity and cancellation signal. App dependencies arrive separately through the controller context.
 * @api FixtureExecution
 */
/**
 * A pause on new app work. `idle` waits for accepted work to finish; `resume` releases this hold after reset. Resuming one hold must leave any other holds in place.
 * @api FixtureHold
 */
/**
 * An app factory or helper with explicit dependencies, JSON input, and execution context. Return browser-safe JSON after committing writes; your app must still drain any background work.
 * @api FixtureOperation
 */
/**
 * Run named fixtures in the app process. Creating the controller can pause app requests; failed or cancelled preparation/drain leaves them paused. Close it before releasing app dependencies.
 * @api FixtureController
 */
