export function readAppBinding(value) {
  try {
    let binding = JSON.parse(value);
    if (
      binding?.dyno !== 1 ||
      !['controller', 'runId', 'executionId', 'appName'].every(
        (key) => typeof binding[key] === 'string' && binding[key].length
      )
    )
      return null;
    return Object.freeze({
      dyno: 1,
      controller: binding.controller,
      runId: binding.runId,
      executionId: binding.executionId,
      appName: binding.appName
    });
  } catch {
    return null;
  }
}

// App documents and their controller find each other over a BroadcastChannel.
// Looking the controller up with window.open('', name) would also focus it,
// which makes the browser take focus from whatever the person is doing.
export let channelFor = (name) => new BroadcastChannel(`dyno-controller:${name}`);

function ownsApp(appWindow, binding, controller) {
  try {
    return Boolean(controller) &&
      !controller.closed &&
      controller.location.origin === appWindow.location.origin &&
      controller.opener === appWindow &&
      controller.__dynoController?.runId === binding.runId;
  } catch {
    return false;
  }
}

// Resolves with this run's controller once it answers. The controller already
// holds this window, so it hands its own window back through __dynoConnect.
export function connectController(appWindow, binding) {
  return new Promise((resolve) => {
    let channel = channelFor(binding.controller);
    appWindow.__dynoConnect = (controller) => {
      if (!ownsApp(appWindow, binding, controller)) return;
      delete appWindow.__dynoConnect;
      channel.close();
      resolve(controller);
    };
    channel.postMessage({ kind: 'connect' });
  });
}

// The controller side: answer every app document that asks for this controller.
export function acceptAppConnections(name, appWindow) {
  channelFor(name).onmessage = (event) => {
    if (event.data?.kind !== 'connect') return;
    try { appWindow.__dynoConnect?.(window); } catch { /* The app document already changed. */ }
  };
}

// A park page only reports that the app document has stopped. It needs no
// window from the controller, so it announces itself on the channel directly.
export function announceParked(binding, requestId) {
  let channel = channelFor(binding.controller);
  channel.postMessage({ kind: 'parked', runId: binding.runId, executionId: binding.executionId, requestId });
  channel.close();
}

export function appRuntime(controller, binding) {
  try {
    let runtime = controller?.__dynoAppRuntime;
    let owner = runtime?.__dynoRuntimeBinding;
    return runtime &&
      !runtime.closed &&
      runtime.parent === controller &&
      owner?.runId === binding.runId &&
      owner.executionId === binding.executionId
      ? runtime
      : null;
  } catch {
    return null;
  }
}
