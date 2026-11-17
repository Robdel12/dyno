/**
 * @guide coverage Code coverage
 * Run `dyno --coverage` to see which app code your tests exercise. Dyno prints a summary and saves coverage beside the run report. It works in managed and manually connected browsers.
 *
 * ## Instrument your app
 *
 * Your app's build adds Istanbul counters to the code it serves. Existing Istanbul build plugins work with Dyno's collector. Enable them when `process.env.DYNO_COVERAGE === '1'`; Dyno sets that variable on app servers it starts for coverage runs. A reused server must already serve an instrumented build.
 *
 * You can also use Dyno's Node helper to instrument compiled JavaScript. Call it after your compiler and before bundling, with the compiler's source map. Keep instrumentation off in normal development and production builds.
 *
 * ```js
 * import { instrumentCoverage } from 'dyno/coverage';
 *
 * let result = instrumentCoverage({
 *   code: compiled.code,
 *   filename: absoluteModulePath,
 *   inputSourceMap: compiled.map,
 * });
 * // Serve result.code, preserve result.map, and save result.coverage in your baseline.
 * ```
 *
 * Compile TypeScript, JSX, and framework templates to JavaScript first. The helper uses `globalThis` directly, so your app's CSP doesn't need `unsafe-eval`.
 *
 * ## Include files you never visit
 *
 * Instrument every included source module during the app build, including lazy routes that tests may never load. Save each helper result's `coverage` under its `path` in a JSON object before the server reports ready. These zero-hit entries form an Istanbul baseline. The baseline must come from the same build as the served code. Include `sourcesContent` in compiler maps so source changes can be checked even when their counter locations stay the same.
 *
 * ```js
 * coverage: {
 *   baseline: '.dyno/coverage-baseline.json',
 *   include: ['src/**'],
 *   exclude: ['src/**\/*.test.*'],
 *   reporters: ['text', 'html', 'lcov', 'json'],
 *   thresholds: { lines: 80, branches: 70 },
 * }
 * ```
 *
 * Paths are relative to the config directory. Include and exclude rules match original source paths after mapping. Without a baseline, the report says **loaded files** and leaves unvisited modules out of the percentage. Thresholds apply to that reported set.
 *
 * Coverage is off by default. Set `enabled: true` to collect on every run, or use `--coverage` when you need it. `--no-coverage` turns it off for one run.
 *
 * The helper keeps Istanbul's hash of the counters and source-map data. Without `sourcesContent`, same-length edits can keep that hash. Include source content and rebuild the baseline with the app.
 *
 * `examples/coverage` includes a small app build that compiles TypeScript, instruments each module, writes a baseline, and serves the result. From the repository, run `node bin/dyno.js --config examples/coverage/dyno.config.js --coverage`.
 *
 * ## Saved coverage
 *
 * Coverage artifacts live under the saved run's `coverage/` folder. Choose `text`, `html`, `lcov`, `json`, or `json-summary` reporters. HTML shows original source when source maps contain `sourcesContent`. JSON preserves Istanbul data for other tools. Configured thresholds fail the command when a metric falls short.
 *
 * Dyno collects from the app's main window across navigation and cleanup. Workers, service workers, embedded frames, and server-side rendering need separate collectors. Crashes and forced shutdown can lose final counters; the saved report marks incomplete collection. Collection failures fail the command while preserving completed test results.
 */

import { isAbsolute } from 'node:path';
import { createInstrumenter, readInitialCoverage } from 'istanbul-lib-instrument';

/**
 * A version 3 source map from the app's compiler. Include source content to keep the HTML report portable and identify source changes.
 *
 * @api CoverageSourceMap
 */
/**
 * Istanbul counters and source locations for one JavaScript module. A fresh helper result has zero hits and can be saved in an all-files baseline.
 *
 * @api CoverageFile
 */
/**
 * JavaScript source, its absolute module filename, and an optional compiler source map.
 *
 * @api CoverageInstrumentOptions
 */
/**
 * Instrumented JavaScript, its composed source map, and the module's zero-hit Istanbul coverage entry.
 *
 * @api CoverageInstrumentResult
 */
/**
 * Instrument one compiled JavaScript module for a Dyno coverage run. This Node-only helper does not read files, change environment variables, or write the baseline. The app's build owns those steps.
 *
 * Pass a source map when the JavaScript came from TypeScript, JSX, or another compiler. Instrument modules before bundling so generated bundle helpers do not inflate the reported source coverage.
 *
 * @api instrumentCoverage
 */
export function instrumentCoverage({ code, filename, inputSourceMap } = {}) {
  if (typeof code !== 'string') throw new TypeError('Coverage instrumentation needs JavaScript code.');
  if (typeof filename !== 'string' || !isAbsolute(filename) || filename.includes('\0'))
    throw new TypeError('Coverage instrumentation needs an absolute module filename.');
  if (inputSourceMap !== undefined && inputSourceMap !== null) {
    if (
      typeof inputSourceMap !== 'object' ||
      inputSourceMap.version !== 3 ||
      typeof inputSourceMap.mappings !== 'string' ||
      !Array.isArray(inputSourceMap.sources) ||
      !inputSourceMap.sources.every((source) => typeof source === 'string') ||
      !Array.isArray(inputSourceMap.names) ||
      !inputSourceMap.names.every((name) => typeof name === 'string') ||
      (inputSourceMap.sourcesContent !== undefined &&
        (!Array.isArray(inputSourceMap.sourcesContent) ||
          inputSourceMap.sourcesContent.length !== inputSourceMap.sources.length ||
          !inputSourceMap.sourcesContent.every((source) => source === null || typeof source === 'string')))
    )
      throw new TypeError('Coverage instrumentation needs a version 3 compiler source map.');
  }
  let instrumenter = createInstrumenter({
    esModules: true,
    produceSourceMap: true,
    coverageGlobalScope: 'globalThis',
    coverageGlobalScopeFunc: false,
  });
  let result = instrumenter.instrumentSync(code, filename, inputSourceMap ? structuredClone(inputSourceMap) : undefined);
  return {
    code: result,
    map: instrumenter.lastSourceMap(),
    coverage: { ...structuredClone(instrumenter.lastFileCoverage()), hash: readInitialCoverage(result).hash },
  };
}
