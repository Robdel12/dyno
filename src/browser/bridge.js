import { captureConsole } from './console.js';
import { readAppBinding, appController, appRuntime } from './companion.js';

// Diagnostics and the reporter live here; the test bundle stays in its own runtime.
(() => {
  let binding = readAppBinding(window.name);
  let controller = appController(window, binding);
  if (!controller || !appRuntime(controller, binding)) return;
  let id = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  let send = (kind, extra = {}) =>
    appRuntime(controller, binding)?.postMessage(
      {
        channel: 'dyno',
        kind,
        id,
        name: binding.appName,
        runId: binding.runId,
        executionId: binding.executionId,
        ...extra
      },
      location.origin
    );
  let relay = (message) => controller.postMessage(message, location.origin);
  let inspect = () => {
    if (!disconnected)
      relay({ channel: 'dyno-reporter', kind: 'command', command: 'inspect', runId: binding.runId });
  };
  let stopOutput = captureConsole(console, (entries) => send('app-output', { entries }));
  window.__browserTestBridge = Object.freeze({
    id,
    name: binding.appName,
    runId: binding.runId,
    executionId: binding.executionId,
    stopOutput
  });
  let serialize = (error) => ({ message: error?.message ?? String(error), stack: error?.stack });
  window.addEventListener(
    'error',
    (event) => {
      if (event.error || event.message)
        send('app-error', { error: serialize(event.error ?? new Error(event.message)) });
      else if (event.target?.localName === 'script')
        send('app-error', { error: { message: `App script failed to load: ${event.target.src}` } });
    },
    true
  );
  window.addEventListener('unhandledrejection', (event) =>
    send('app-error', { error: serialize(event.reason) })
  );
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
      event.preventDefault();
      inspect();
    }
  });
  window.addEventListener('pagehide', () => send('app-unloading'));
  window.addEventListener('resize', () =>
    relay({
      channel: 'dyno-app',
      kind: 'resize',
      runId: binding.runId,
      executionId: binding.executionId,
      width: innerWidth,
      height: innerHeight,
      pixelRatio: devicePixelRatio
    })
  );
  let reporter;
  let inspectButton;
  let presentation = { visible: false, interactive: false, active: true };
  let disconnected;
  let lastSnapshot;
  let hiddenBodies = new Map();
  let previousFocus;
  let present = () => {
    if (!reporter) return;
    let visible = Boolean(presentation.visible);
    if (visible && reporter.hidden) previousFocus = document.activeElement;
    reporter.hidden = !visible;
    reporter.style.setProperty('display', visible ? 'block' : 'none', 'important');
    inspectButton.hidden = !disconnected && (visible || presentation.active || !presentation.interactive);
    inspectButton.style.setProperty('display', inspectButton.hidden ? 'none' : 'block', 'important');
    if (visible && document.body) {
      if (!hiddenBodies.has(document.body)) hiddenBodies.set(document.body, document.body.inert);
      document.body.inert = true;
    } else {
      for (let [body, inert] of hiddenBodies) body.inert = inert;
      hiddenBodies.clear();
      if (previousFocus?.isConnected) {
        previousFocus.focus?.();
        previousFocus = undefined;
      }
    }
  };
  window.addEventListener('message', (event) => {
    let message = event.data;
    if (event.origin !== location.origin || !message || message.runId !== binding.runId) return;
    if (message.channel === 'dyno-overlay' && event.source === controller) {
      if (message.kind === 'disconnected') {
        disconnected = message.message ?? 'The test controller closed. Start a new run to reconnect.';
        presentation = { visible: false, interactive: true, active: false };
        if (inspectButton) {
          inspectButton.textContent = 'Restart Dyno — controller closed';
          inspectButton.title = disconnected;
        }
        present();
      } else if (!disconnected && message.kind === 'presentation') {
        presentation = {
          visible: Boolean(message.visible),
          interactive: Boolean(message.interactive),
          active: Boolean(message.active)
        };
        present();
      } else if (!disconnected && ['snapshot', 'focus', 'command-result'].includes(message.kind)) {
        if (message.kind === 'snapshot') lastSnapshot = message;
        reporter?.contentWindow?.postMessage({ ...message, channel: 'dyno-reporter' }, location.origin);
      }
    } else if (message.channel === 'dyno-reporter' && event.source === reporter?.contentWindow) {
      if (!disconnected && message.kind === 'ready' && lastSnapshot)
        reporter.contentWindow.postMessage({ ...lastSnapshot, channel: 'dyno-reporter' }, location.origin);
      if (!disconnected && ['ready', 'command'].includes(message.kind)) relay(message);
    }
  });
  let ready = () => {
    reporter = document.createElement('iframe');
    reporter.id = '__dynoReporter';
    reporter.title = 'Dyno test results';
    reporter.hidden = true;
    Object.assign(reporter.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      border: '0',
      zIndex: '2147483647',
      background: '#151719',
      display: 'none'
    });
    // Inline app styles may target iframe broadly; this rule only controls Dyno's own tools.
    let style = document.createElement('style');
    let nonce = document.querySelector('style[nonce],script[nonce]')?.nonce;
    if (nonce) style.nonce = nonce;
    style.textContent =
      '#__dynoReporter[hidden],#__dynoInspect[hidden]{display:none!important}#__dynoReporter:not([hidden]){display:block!important}#__dynoInspect:not([hidden]){display:block!important}';
    reporter.src = `/__dyno__/reporter?run=${encodeURIComponent(binding.runId)}&embedded=1`;
    inspectButton = document.createElement('button');
    inspectButton.id = '__dynoInspect';
    inspectButton.type = 'button';
    inspectButton.textContent = disconnected ? 'Restart Dyno — controller closed' : 'Show test results';
    if (disconnected) inspectButton.title = disconnected;
    inspectButton.hidden = true;
    Object.assign(inspectButton.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      font: '500 13px system-ui',
      background: '#24272a',
      color: '#f4f0e9',
      border: '1px solid #59534b',
      borderRadius: '5px',
      padding: '10px 14px',
      cursor: 'pointer'
    });
    inspectButton.addEventListener('click', () => {
      if (disconnected) location.assign('/__dyno__/');
      else inspect();
    });
    document.documentElement.append(style, reporter, inspectButton);
    new MutationObserver(() => {
      if (presentation.visible) present();
    }).observe(document.documentElement, { childList: true });
    present();
    send('app-ready');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  send('app-init');
})();
