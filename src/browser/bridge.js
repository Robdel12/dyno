import { captureConsole } from './console.js';

// This small diagnostic bridge executes before app scripts. Tests stay in the parent realm.
(() => {
  let id = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  let name = window.name;
  window.__browserTestBridge = { id };
  let send = (kind, extra = {}) => parent.postMessage({ channel: 'dyno', kind, id, name, ...extra }, location.origin);
  window.__browserTestBridge.stopOutput = captureConsole(console, entries => send('app-output', { entries }));
  let serialize = error => ({ message: error?.message ?? String(error), stack: error?.stack });
  window.addEventListener('error', event => {
    if (event.error || event.message) send('app-error', { error: serialize(event.error ?? new Error(event.message)) });
    else if (event.target?.localName === 'script') send('app-error', { error: { message: `App script failed to load: ${event.target.src}` } });
  }, true);
  window.addEventListener('unhandledrejection', event => send('app-error', { error: serialize(event.reason) }));
  window.addEventListener('keydown', event => { if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') { event.preventDefault(); send('inspect'); } });
  window.addEventListener('pagehide', () => send('app-unloading'));
  document.addEventListener('DOMContentLoaded', () => send('app-ready'), { once: true });
  send('app-init');
})();
