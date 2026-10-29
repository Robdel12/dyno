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

export function appController(appWindow, binding) {
  if (!binding) return null;
  let controller;
  try {
    controller = appWindow.open('', binding.controller);
    if (
      !controller ||
      controller.closed ||
      controller.location.origin !== appWindow.location.origin ||
      controller.opener !== appWindow ||
      controller.__dynoController?.runId !== binding.runId
    ) {
      if (controller?.opener === appWindow && controller.location.href === 'about:blank') controller.close();
      return null;
    }
    return controller;
  } catch {
    return null;
  }
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
