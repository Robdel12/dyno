let frozenList = values => Object.freeze([...values]);

export function createSuite() {
  return Object.freeze({ tests: frozenList([]), beforeEach: frozenList([]), afterEach: frozenList([]) });
}

export function addTest(suite, name, run, { timeout } = {}, declaration) {
  if (typeof name !== 'string' || !name.trim() || typeof run !== 'function') throw new Error('test requires a name and a function.');
  if (suite.tests.some(test => test.name === name)) throw new Error(`Duplicate test name: ${name}`);
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0)) throw new Error(`Invalid timeout for ${name}.`);
  let test = Object.freeze({ name, run, timeout, declaration });
  return Object.freeze({ ...suite, tests: frozenList([...suite.tests, test]) });
}

export function addHook(suite, phase, run) {
  if (!['beforeEach', 'afterEach'].includes(phase) || typeof run !== 'function') throw new Error('A hook requires a function and a supported phase.');
  return Object.freeze({ ...suite, [phase]: frozenList([...suite[phase], run]) });
}
