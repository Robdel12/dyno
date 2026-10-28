(() => {
  let parameters = new URLSearchParams(location.search);
  let runId = parameters.get('run');
  let executionId = parameters.get('execution');
  let fail = error => parent.postMessage({ channel: 'dyno', kind: 'fatal', runId, executionId, error: { message: error?.message ?? String(error), stack: error?.stack } }, location.origin);
  window.addEventListener('error', event => fail(event.error ?? new Error(event.message || `Test script failed: ${event.target?.src}`)), true);
  window.addEventListener('unhandledrejection', event => fail(event.reason));
})();
