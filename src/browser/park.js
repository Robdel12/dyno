import { readAppBinding, connectController } from './companion.js';

let binding = readAppBinding(window.name);
let requestId = new URLSearchParams(location.search).get('request');
if (binding && requestId)
  connectController(window, binding).then((controller) =>
    controller.postMessage({ channel: 'dyno-park', runId: binding.runId,
      executionId: binding.executionId, requestId }, location.origin));
