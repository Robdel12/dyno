import { readAppBinding, announceParked } from './companion.js';

let binding = readAppBinding(window.name);
let requestId = new URLSearchParams(location.search).get('request');
if (binding && requestId) announceParked(binding, requestId);
