import { createSuite, addSuite, addTest, addHook, compileSuite } from '../suite.js';

// Module evaluation is the registration boundary; all definition changes are pure.
let definitions = createSuite();
let scopes = [];
let change = (update) => {
  if (!scopes.length)
    throw new Error('Register tests and hooks inside describe blocks while a test file is being evaluated.');
  scopes = [...scopes.slice(0, -1), update(scopes.at(-1))];
};
export async function registerFile(file, load) {
  if (scopes.length) throw new Error('Test files must register sequentially.');
  scopes = [createSuite(file, { file })];
  try {
    await load();
    definitions = addSuite(definitions, scopes[0]);
  } finally {
    scopes = [];
  }
}
let declareTest = (mode) => (name, run, options) =>
  change((suite) => addTest(suite, name, run, options, new Error('Test declared here').stack, mode));
export let test = Object.assign(declareTest('run'), { skip: declareTest('skip'), only: declareTest('only') });
let declareSuite = (mode) => (name, define) => {
  if (typeof name !== 'string' || !name.trim() || typeof define !== 'function')
    throw new Error('describe requires a name and a synchronous function.');
  if (define.constructor.name === 'AsyncFunction' || define.constructor.name === 'GeneratorFunction')
    throw new Error('describe must be synchronous. Put asynchronous work in hooks or tests.');
  if (!scopes.length) throw new Error('describe must be registered inside a test file.');
  scopes = [...scopes, createSuite(name, { mode })];
  let child;
  try {
    let result = define();
    if (result?.then) {
      Promise.resolve(result).catch(() => {});
      throw new Error('describe must be synchronous. Put asynchronous work in hooks or tests.');
    }
    child = scopes.at(-1);
  } finally {
    scopes = scopes.slice(0, -1);
  }
  change((parent) => addSuite(parent, child));
};
export let describe = Object.assign(declareSuite('run'), { skip: declareSuite('skip'), only: declareSuite('only') });
export function beforeEach(run) {
  change((suite) => addHook(suite, 'beforeEach', run, new Error('Hook declared here').stack));
}
export function afterEach(run) {
  change((suite) => addHook(suite, 'afterEach', run, new Error('Hook declared here').stack));
}
export function getSuite(options) {
  return compileSuite(definitions, options);
}
