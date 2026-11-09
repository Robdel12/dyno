// Callback promises remain owned after their waiting deadline. Cancellation
// cannot prove that an app stopped writing; teardown joins actual settlement.
export function projectOperation(work, context, { timeout, message }) {
  let controller = new AbortController();
  let startedAt = performance.now();
  let deadline = startedAt + timeout;
  let span;
  let expired = AbortSignal.timeout(Math.max(1, Math.ceil(timeout)));
  let abort = () => controller.abort(new Error(message));
  let stopped = Promise.withResolvers();
  let cancelled = () => stopped.reject(controller.signal.reason);
  controller.signal.addEventListener('abort', cancelled, { once: true });
  expired.addEventListener('abort', abort, { once: true });
  let actual = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return work({ ...context, signal: controller.signal });
  });
  let result = Promise.race([actual, stopped.promise]).then(value => {
    controller.signal.throwIfAborted();
    if (performance.now() >= deadline) throw new Error(message);
    span = Object.freeze({ startedAt, finishedAt: performance.now(), status: 'passed' });
    return value;
  }).catch(error => {
    span = Object.freeze({ startedAt, finishedAt: performance.now(), status: 'failed' });
    throw error;
  }).finally(() => {
    expired.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancelled);
  });
  void result.catch(() => {});
  return Object.freeze({
    result,
    settled: actual.then(() => {}, () => {}),
    deadline,
    span: () => span,
    abort: reason => controller.abort(reason),
  });
}
