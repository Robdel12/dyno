let list = (values) => Object.freeze([...values]);
let validName = (name) => typeof name === 'string' && name.trim().length > 0;
let modeOf = (mode) => {
  if (!['run', 'skip', 'only'].includes(mode)) throw new Error('Unknown test mode.');
  return mode;
};
export let testId = (file, suites, name) => JSON.stringify([file, ...suites, name]);
export let testTitle = (test) => [...test.suites, test.name].join(' › ');

export function createSuite(name = '', { file = null, mode = 'run' } = {}) {
  return Object.freeze({
    kind: 'suite',
    name,
    file,
    mode: modeOf(mode),
    children: list([]),
    beforeEach: list([]),
    afterEach: list([])
  });
}
export function addSuite(parent, child) {
  if (parent.children.some((item) => item.kind === 'suite' && item.name === child.name))
    throw new Error(`Duplicate describe block: ${child.name}`);
  return Object.freeze({ ...parent, children: list([...parent.children, child]) });
}
export function addTest(suite, name, run, options = {}, declaration, mode = 'run') {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Test options must be an object.');
  for (let key of Object.keys(options))
    if (!['timeout', 'reason', 'resources'].includes(key)) throw new Error(`Unknown test option: ${key}.`);
  let { timeout, reason, resources = [] } = options;
  if (suite.file) throw new Error('test() must be inside a describe block. Wrap the test in describe("Suite name", () => { ... }).');
  if (!validName(name) || (typeof run !== 'function' && !(mode === 'skip' && run === undefined)))
    throw new Error('test requires a name and a function.');
  if (suite.children.some((item) => item.kind === 'test' && item.name === name))
    throw new Error(`Duplicate test name in this suite: ${name}`);
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647))
    throw new Error(`Invalid timeout for ${name}.`);
  if (reason !== undefined && !validName(reason)) throw new Error('A skip reason must be a non-empty string.');
  if (!Array.isArray(resources) || resources.length > 32 ||
    resources.some((name) => typeof name !== 'string' || !name.trim() || name.length > 128) ||
    new Set(resources).size !== resources.length)
    throw new Error(`Invalid resources for ${name}. Use unique, non-empty names.`);
  let test = Object.freeze({ resources: list([...resources].sort()), kind: 'test', name, run, timeout, reason, declaration, mode: modeOf(mode) });
  return Object.freeze({ ...suite, children: list([...suite.children, test]) });
}
export function addHook(suite, phase, run, declaration) {
  if (suite.file) throw new Error(`${phase}() must be inside a describe block. Move the hook into the suite it belongs to.`);
  if (!['beforeEach', 'afterEach'].includes(phase) || typeof run !== 'function')
    throw new Error('A hook requires a function and a supported phase.');
  return Object.freeze({ ...suite, [phase]: list([...suite[phase], Object.freeze({ run, declaration, phase })]) });
}

export function compileSuite(definitions, { forbidOnly = false } = {}) {
  let tests = [];
  let hasOnly = false;
  let visit = (suite, file = null, path = [], scopes = [], skipped = false, focused = false) => {
    file = suite.file ?? file;
    if (suite.file) { path = []; scopes = []; }
    else if (suite.name) path = [...path, suite.name];
    hasOnly ||= suite.mode === 'only';
    skipped ||= suite.mode === 'skip';
    focused ||= suite.mode === 'only';
    if (file && !suite.file)
      scopes = [
        ...scopes,
        Object.freeze({
          id: JSON.stringify(['suite', file, ...path]),
          beforeEach: suite.beforeEach,
          afterEach: suite.afterEach
        })
      ];
    for (let child of suite.children) {
      if (child.kind === 'suite') visit(child, file, path, scopes, skipped, focused);
      else {
        if (!file) throw new Error('Tests must be registered inside a test file.');
        if (!path.length) throw new Error('Tests must be inside a named describe block.');
        hasOnly ||= child.mode === 'only';
        tests.push(
          Object.freeze({
            id: testId(file, path, child.name),
            file,
            suites: list(path),
            name: child.name,
            index: tests.length,
            timeout: child.timeout,
            resources: child.resources,
            run: child.run,
            declaration: child.declaration,
            scopes: list(scopes),
            focused: focused || child.mode === 'only',
            skipReason: skipped || child.mode === 'skip' ? (child.reason ?? 'Skipped') : null
          })
        );
      }
    }
  };
  visit(definitions);
  if (forbidOnly && hasOnly)
    throw new Error('Focused tests are not allowed in CI. Remove test.only and describe.only.');
  let focused = hasOnly;
  return list(
    tests.map((test) =>
      Object.freeze({
        ...test,
        skipReason: test.skipReason ?? (focused && !test.focused ? 'Not selected by .only' : null)
      })
    )
  );
}
export function testDescriptor({ id, file, suites, name, index, timeout, skipReason, resources = [] }) {
  return Object.freeze({ id, file, suites, name, index, resources: list(resources), ...(timeout === undefined ? {} : { timeout }), skipReason });
}
export function selectTests(tests, { ids = [], names = [], files = [], suites = [] } = {}) {
  for (let id of ids) if (!tests.some(test => test.id === id)) throw new Error(`No test with ID ${id}. Rebuild and select it again.`);
  let selected = tests.filter(
    (test) =>
      (!ids.length || ids.includes(test.id)) &&
      (!names.length || names.includes(test.name) || names.includes(testTitle(test))) &&
      (!files.length || files.some((file) => test.file === file || test.file.endsWith('/' + file))) &&
      (!suites.length ||
        suites.some((suite) => test.suites.join(' › ') === suite || test.suites.join(' › ').startsWith(suite + ' › ')))
  );
  if (!selected.length)
    throw new Error(
      names.length
        ? `No test named "${names.join('", "')}". --test uses an exact name.`
        : 'No tests match this selection.'
    );
  if (names.length && !ids.length) {
    for (let name of names)
      if (selected.filter((test) => test.name === name || testTitle(test) === name).length > 1)
        throw new Error(`Test name "${name}" is ambiguous. Select its --id, --file, or --suite.`);
  }
  return list(selected);
}
