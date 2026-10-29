let freeze = (value) => Object.freeze(value);
let changeTest = (state, index, update) => ({
  ...state,
  tests: freeze(state.tests.map((test) => (test.index === index ? freeze({ ...test, ...update(test) }) : test)))
});
export function createExecution(viewport) {
  return freeze({
    phase: 'connecting',
    tests: freeze([]),
    current: null,
    files: freeze([]),
    appHost: '',
    browser: '',
    duration: null,
    error: null,
    interactive: false,
    pauseOnFailure: false,
    viewport: freeze({ ...viewport }),
    revision: 0,
    presentation: 'app',
    viewportMode: 'fixed'
  });
}
export function transition(state, event) {
  let next;
  switch (event.type) {
    case 'connected':
      next = { ...state, ...event.settings, phase: 'discovering' };
      break;
    case 'started':
      next = {
        ...state,
        phase: 'running',
        tests: freeze(
          event.tests.map((test) => freeze({ ...test, status: 'pending', output: freeze([]), attachments: freeze([]) }))
        )
      };
      break;
    case 'test.started':
      next = changeTest({ ...state, current: event.index }, event.index, () => ({ status: 'running' }));
      break;
    case 'test.output':
      next = changeTest(state, event.index, (test) => ({
        output: freeze([...test.output, ...event.entries].slice(0, 100))
      }));
      break;
    case 'test.location':
      next = changeTest(state, event.index, () => ({ path: event.path }));
      break;
    case 'test.finished':
      next = changeTest(state, event.index, () => event.outcome);
      break;
    case 'pause.requested':
      next = ['running', 'pausing'].includes(state.phase)
        ? { ...state, phase: state.phase === 'pausing' ? 'running' : 'pausing' }
        : state;
      break;
    case 'watch.changed':
      next = { ...state, watch: event.watch };
      break;
    case 'debug.paused':
      next = { ...state, phase: 'debugging', presentation: 'reporter', debugMessage: event.message };
      break;
    case 'debug.continued':
      next = { ...state, phase: 'running', presentation: 'app', debugMessage: null };
      break;
    case 'paused':
      next = { ...state, phase: 'paused', presentation: 'reporter' };
      break;
    case 'continue.requested':
      next = state.phase === 'paused' ? { ...state, phase: 'resuming', presentation: 'app' } : state;
      break;
    case 'continued':
      next = ['paused', 'resuming'].includes(state.phase) ? { ...state, phase: 'running', presentation: 'app' } : state;
      break;
    case 'reporter.requested':
      next = ['connecting', 'discovering', 'resuming'].includes(state.phase)
        ? state
        : ['running', 'pausing'].includes(state.phase)
          ? { ...state, phase: 'pausing' }
          : { ...state, presentation: 'reporter' };
      break;
    case 'app.requested':
      next = { ...state, presentation: 'app' };
      break;
    case 'preferences.changed':
      next = { ...state, pauseOnFailure: event.pauseOnFailure };
      break;
    case 'viewport.changed':
      next = {
        ...state,
        viewport: freeze({ ...event.viewport }),
        viewportMode: event.mode ?? state.viewportMode,
        revision: state.revision + 1
      };
      break;
    case 'browser.resized':
      next = {
        ...state,
        viewport: state.viewportMode === 'browser' ? freeze({ ...event.viewport }) : state.viewport,
        revision: state.revision + 1
      };
      break;
    case 'completed':
      next = {
        ...state,
        phase: 'completed',
        duration: event.duration,
        presentation: state.interactive ? 'reporter' : 'app'
      };
      break;
    case 'failed':
      next = {
        ...state,
        phase: event.stopped ? 'stopped' : 'error',
        presentation: state.interactive ? 'reporter' : 'app',
        error: event.error,
        tests: freeze(
          state.tests.map((test) => (test.status === 'running' ? freeze({ ...test, status: 'stopped' }) : test))
        )
      };
      break;
    default:
      throw new Error(`Unknown execution event: ${event.type}`);
  }
  return freeze(next);
}
