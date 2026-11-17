import { createHash } from 'node:crypto';
import babel from '@babel/core';
import { createInstrumenter, readInitialCoverage } from 'istanbul-lib-instrument';

// Playwright serializes these callback bodies into another JavaScript realm.
// Their counters need a local copy of the same canonical Istanbul definition.
function portableCallbacks({ types }) {
  let helper;
  return {
    visitor: {
      Program(path) {
        helper = path.node.body.find(node => types.isFunctionDeclaration(node) && node.id?.name.startsWith('cov_'));
      },
      CallExpression(path) {
        let callee = path.node.callee;
        let callback = path.node.arguments[0];
        if (!helper || !types.isMemberExpression(callee) ||
          !['evaluate', 'evaluateHandle', 'addInitScript', 'waitForFunction'].includes(callee.property.name ?? callee.property.value) ||
          !types.isFunction(callback) || !types.isBlockStatement(callback.body)) return;
        callback.body.body.unshift(types.cloneNode(helper, true));
        path.skip();
      },
    },
  };
}

export function instrumentFrameworkSource(source, filename) {
  let instrumenter = createInstrumenter({ esModules: true, produceSourceMap: true,
    coverageVariable: '__dynoSelfCoverage', coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
  let code = instrumenter.instrumentSync(source, filename);
  let transformed = babel.transformSync(code, { filename, inputSourceMap: instrumenter.lastSourceMap(),
    sourceMaps: true, compact: true, babelrc: false, configFile: false, plugins: [portableCallbacks] });
  return {
    code: transformed.code,
    map: transformed.map,
    coverage: { ...instrumenter.lastFileCoverage(), hash: readInitialCoverage(code).hash,
      sourceHash: createHash('sha256').update(source).digest('hex') },
  };
}
