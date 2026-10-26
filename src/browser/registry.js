import { createSuite, addTest, addHook } from '../suite.js';

// Test-module evaluation is the registration boundary. Consumers get immutable snapshots.
let definitions = createSuite();
export function test(name, run, options) { definitions = addTest(definitions, name, run, options, new Error('Test declared here').stack); }
export function beforeEach(run) { definitions = addHook(definitions, 'beforeEach', run); }
export function afterEach(run) { definitions = addHook(definitions, 'afterEach', run); }
export function getSuite() { return definitions; }
