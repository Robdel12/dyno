export let defaultFixturePath = '/__dyno_fixtures__';
export let fixtureRequestLimit = 65_536;
export let fixtureResultLimit = 1_048_576;
export let fixtureDepthLimit = 64;

let errors = Object.freeze({
  invalid_request: [400, 'Invalid fixture request.'],
  forbidden: [403, 'Fixture access denied.'],
  unknown_operation: [404, 'Unknown fixture operation.'],
  unknown_route: [404, 'Unknown fixture route.'],
  method_not_allowed: [405, 'Fixture requests require POST.'],
  execution_conflict: [409, 'This fixture execution does not own an available worker.'],
  input_too_large: [413, 'Fixture input exceeds 64 KiB.'],
  unsupported_media_type: [415, 'Fixture requests require application/json.'],
  operation_failed: [500, 'Fixture operation failed.'],
  reset_failed: [500, 'Fixture reset failed.'],
  drain_failed: [500, 'Fixture drain failed.'],
  invalid_result: [500, 'Fixture result must be bounded JSON.']
});

export function fixtureError(code, { cause } = {}) {
  let known = typeof code === 'string' && Object.hasOwn(errors, code);
  let [status, message] = known ? errors[code] : errors.operation_failed;
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: known ? code : 'operation_failed', status
  });
}

export function fixtureErrorResponse(error) {
  let code = typeof error?.code === 'string' && Object.hasOwn(errors, error.code) ? error.code : 'operation_failed';
  return Object.freeze({ error: Object.freeze({ code, message: errors[code][1] }) });
}

let record = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Clone and freeze JSON without invoking getters, custom serializers or coercion. */
export function snapshotJson(value, { maxBytes = fixtureResultLimit, maxDepth = fixtureDepthLimit } = {}) {
  if (!(maxBytes === Infinity || Number.isSafeInteger(maxBytes) && maxBytes > 0) ||
    !Number.isSafeInteger(maxDepth) || maxDepth < 0)
    throw new TypeError('JSON limits must be positive byte and nonnegative depth limits.');
  let ancestors = new Set();
  let clone = (item, depth) => {
    if (depth > maxDepth) throw new TypeError('JSON exceeds its depth limit.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || !Array.isArray(item) && !record(item) || ancestors.has(item))
      throw new TypeError('Expected plain JSON values.');
    ancestors.add(item);
    let keys = Reflect.ownKeys(item);
    let descriptors = Object.getOwnPropertyDescriptors(item);
    let array = Array.isArray(item);
    if (array && Object.getPrototypeOf(item) !== Array.prototype)
      throw new TypeError('JSON arrays must be ordinary arrays.');
    if (array && keys.length !== item.length + 1)
      throw new TypeError('JSON arrays must be dense and contain only indexed values.');
    let entries = (array ? Array.from({ length: item.length }, (_, index) => String(index)) : keys)
      .map(key => {
        let descriptor = descriptors[key];
        if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
          throw new TypeError('JSON properties must be enumerable data values.');
        return [key, clone(descriptor.value, depth + 1)];
      });
    ancestors.delete(item);
    return Object.freeze(array ? entries.map(([, entry]) => entry) : Object.fromEntries(entries));
  };
  let result = clone(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes)
    throw new RangeError('JSON exceeds its byte limit.');
  return result;
}

export function fixtureIdentity(value) {
  let result;
  try { result = snapshotJson(value, { maxBytes: fixtureRequestLimit }); }
  catch (cause) { throw fixtureError('invalid_request', { cause }); }
  if (!record(result) || Object.keys(result).length !== 3 ||
    ['runId', 'workerId', 'executionId'].some(key => typeof result[key] !== 'string' ||
      !result[key] || result[key].length > 256)) throw fixtureError('invalid_request');
  return result;
}

export function fixtureScope(value) {
  let result;
  try { result = snapshotJson(value, { maxBytes: fixtureRequestLimit }); }
  catch (cause) { throw fixtureError('invalid_request', { cause }); }
  if (!record(result) || Object.keys(result).length !== 4 ||
    typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(result.token))
    throw fixtureError('invalid_request');
  fixtureIdentity(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'token')));
  return result;
}

export function fixtureOperationName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(value))
    throw fixtureError('invalid_request');
  return value;
}

export function fixtureBasePath(value = defaultFixturePath) {
  if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(value) ||
    value === '/__dyno__' || value.startsWith('/__dyno__/'))
    throw fixtureError('invalid_request');
  return value;
}

export function snapshotFixtureTransport(value, identity) {
  let result;
  try { result = snapshotJson(value, { maxBytes: fixtureRequestLimit }); }
  catch (cause) { throw fixtureError('invalid_request', { cause }); }
  if (!record(result) || Object.keys(result).length !== 2 || typeof result.path !== 'string' ||
    !result.path.endsWith('/call')) throw fixtureError('invalid_request');
  fixtureBasePath(result.path.slice(0, -5));
  let scope = fixtureScope(result.scope);
  if (identity && ['runId', 'workerId', 'executionId'].some(key => scope[key] !== identity[key]))
    throw fixtureError('execution_conflict');
  return result;
}

/** Read a bounded fixture envelope without exposing remote error details. */
export async function readFixtureResponse(response) {
  if (response.status === 204) return;
  let reader = response.body?.getReader();
  let decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', size = 0, value;
  try {
    if (reader) for (;;) {
      let { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > fixtureResultLimit) {
        await reader.cancel().catch(() => {});
        throw fixtureError('invalid_result');
      }
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    value = snapshotJson(JSON.parse(text));
  } catch (cause) { throw fixtureError('invalid_result', { cause }); }
  finally { reader?.releaseLock(); }
  if (!response.ok) throw fixtureError(value?.error?.code);
  return value;
}
