let phases = ['runtime', 'beforeEach', 'test', 'afterEach', 'app', 'timeout', 'cleanup'];
export function failureRecord(error, phase = 'runtime', declaration) {
  return Object.freeze({
    phase,
    message: error?.message || String(error),
    ...(typeof error?.stack === 'string' ? { stack: error.stack } : {}),
    ...(declaration ? { declaration } : {})
  });
}
export function failureOutcome(errors) {
  return Object.freeze(
    errors.length
      ? { status: 'failed', error: errors[0], additionalErrors: Object.freeze(errors.slice(1)) }
      : { status: 'passed', additionalErrors: Object.freeze([]) }
  );
}
export function validFailure(error) {
  return Boolean(
    error &&
    typeof error.message === 'string' &&
    (error.stack === undefined || typeof error.stack === 'string') &&
    (error.declaration === undefined || typeof error.declaration === 'string') &&
    (error.phase === undefined || phases.includes(error.phase))
  );
}
export function snapshotFailure(error, fallback = 'runtime') {
  return Object.freeze({
    message: error.message,
    phase: error.phase ?? fallback,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.declaration === undefined ? {} : { declaration: error.declaration }),
    ...(error.source ? { source: Object.freeze({ ...error.source }) } : {})
  });
}
