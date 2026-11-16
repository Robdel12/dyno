import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { transform } from 'esbuild';
import coverage from 'istanbul-lib-coverage';
import sourceMaps from 'istanbul-lib-source-maps';
import { instrumentCoverage } from '../../src/coverage-instrument.js';

test('instrumented app code runs under strict CSP and preserves its zero-hit baseline', () => {
  let result = instrumentCoverage({
    code: 'function choose(flag) { return flag ? "yes" : "no"; }',
    filename: '/app/choose.js',
  });
  let context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(result.code, context);
  assert.equal(vm.runInContext('choose(true)', context), 'yes');
  let actual = JSON.parse(JSON.stringify(context.__coverage__['/app/choose.js']));
  assert.equal(actual.hash, result.coverage.hash);
  assert.deepEqual(actual.f, { 0: 1 });
  assert.deepEqual(actual.b, { 0: [1, 0] });
  assert.deepEqual(result.coverage.f, { 0: 0 });
  assert.deepEqual(result.coverage.b, { 0: [0, 0] });
});

test('compiler source maps report original TypeScript lines and source content', async () => {
  let source = `function choose(flag: boolean): string {
  if (flag) {
    return 'yes';
  }
  return 'no';
}`;
  let compiled = await transform(source, {
    loader: 'ts', sourcefile: '/app/src/choose.ts', sourcemap: 'external', target: 'es2022',
  });
  let inputSourceMap = JSON.parse(compiled.map);
  let before = structuredClone(inputSourceMap);
  let result = instrumentCoverage({
    code: compiled.code, filename: '/app/build/choose.js', inputSourceMap,
  });
  let context = vm.createContext({});
  vm.runInContext(result.code, context);
  assert.equal(vm.runInContext('choose(true)', context), 'yes');
  let store = sourceMaps.createSourceMapStore();
  let mapped = await store.transformCoverage(coverage.createCoverageMap(JSON.parse(JSON.stringify(context.__coverage__))));
  assert.deepEqual(mapped.files(), ['/app/src/choose.ts']);
  assert.deepEqual({ ...mapped.fileCoverageFor('/app/src/choose.ts').getLineCoverage() }, { 2: 1, 3: 1, 5: 0 });
  assert.equal(store.sourceFinder('/app/src/choose.ts'), source);
  assert.deepEqual(inputSourceMap, before);
});

test('instrumentation rejects ambiguous filenames and malformed compiler maps', () => {
  assert.throws(() => instrumentCoverage({ code: '', filename: 'choose.js' }), /absolute module filename/);
  assert.throws(() => instrumentCoverage({ code: null, filename: '/app/choose.js' }), /JavaScript code/);
  assert.throws(() => instrumentCoverage({
    code: '', filename: '/app/choose.js',
    inputSourceMap: { version: 3, mappings: '', names: [], sources: ['choose.ts'], sourcesContent: [] },
  }), /version 3 compiler source map/);
});
