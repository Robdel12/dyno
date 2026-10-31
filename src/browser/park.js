import { readAppBinding, appController } from './companion.js';

let binding = readAppBinding(window.name);
let controller = appController(window, binding);
let requestId = new URLSearchParams(location.search).get('request');
if (controller && requestId)
  controller.postMessage({ channel: 'dyno-park', runId: binding.runId,
    executionId: binding.executionId, requestId }, location.origin);
