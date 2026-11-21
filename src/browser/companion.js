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
export let controllerChannel = (name) => `dyno-controller:${name}`;

function ownedController(appWindow, binding, controller) {
  try {
    return controller &&
      !controller.closed &&
      controller.location.origin === appWindow.location.origin &&
      controller.opener === appWindow &&
      controller.__dynoController?.runId === binding.runId
      ? controller
      : null;
  } catch {
    return null;
  }
}

// Resolves with the controller once it answers. The controller already holds
// this window, so it hands its own window back through __dynoConnect.
export function connectController(appWindow, binding) {
  if (!binding) return Promise.resolve(null);
  return new Promise((resolve) => {
    let channel = new BroadcastChannel(controllerChannel(binding.controller));
    appWindow.__dynoConnect = (controller) => {
      let owned = ownedController(appWindow, binding, controller);
      if (!owned) return;
      delete appWindow.__dynoConnect;
      channel.close();
      resolve(owned);
    };
    channel.postMessage({ kind: 'connect', runId: binding.runId });
  });
}

// The controller side: answer every app document that asks for this controller.
export function acceptAppConnections(name, appWindow) {
  let channel = new BroadcastChannel(controllerChannel(name));
  channel.onmessage = () => {
    try { appWindow.__dynoConnect?.(window); } catch { /* The app document already changed. */ }
  };
  return channel;
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
