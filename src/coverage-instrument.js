/**
 * @guide coverage Code coverage
 * Run `dyno run --coverage` to collect JavaScript coverage from your app. Dyno saves coverage beside the run report and prints a terminal summary. Collection runs in the browser, so managed and manually connected browsers use the same path.
 *
 * ## Instrument your app
 *
 * Your app's build adds Istanbul counters to the code it serves. Existing Istanbul build plugins work with Dyno's collector. Enable them when `process.env.DYNO_COVERAGE === '1'`; Dyno sets that variable on app servers it starts for coverage runs. A reused server must already serve an instrumented build.
 *
 * Dyno's optional Node helper instruments one compiled JavaScript module. Call it after your language or framework compiler, before bundling, and pass the compiler's source map. Keep instrumentation off in ordinary development and production builds.
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
 * The helper accepts JavaScript, not raw TypeScript, JSX, or framework templates. Compile those first. It uses `globalThis` directly and does not require `unsafe-eval` in your app's CSP.
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
 * Paths are relative to the config directory. Include and exclude rules apply to original source paths after source-map remapping. Without a baseline, Dyno labels the report **loaded files**: modules that never ran cannot contribute to that percentage. Thresholds apply to the reported scope. Coverage is disabled by default. `enabled: true` collects on every run; otherwise use `--coverage`. Pass `--no-coverage` to disable collection for a configured run.
 *
 * The helper preserves Istanbul's runtime hash in its baseline entry. That hash describes counters and embedded source-map data. Without `sourcesContent`, same-length source edits can keep the same hash; use complete compiler maps and rebuild the baseline together with the app.
 *
 * `examples/coverage` includes a small app build that compiles TypeScript, instruments each module, writes a baseline, and serves the result. From the repository, run `node bin/dyno.js --config examples/coverage/dyno.config.js --coverage`.
 *
 * ## Saved coverage
 *
 * Coverage artifacts live under the saved run's `coverage/` folder. Choose `text`, `html`, `lcov`, `json`, or `json-summary` reporters. HTML shows original source when source maps contain `sourcesContent`. JSON preserves Istanbul data for other tools. Configured thresholds fail the command when a metric falls short.
 *
 * Dyno collects the app's top-level window across test navigation and cleanup. Workers, service workers, embedded frames, and server-side rendering need their own instrumentation and collection; their globals are outside this collector. Browser crashes and forceful shutdown can prevent a final snapshot. Incomplete collection stays explicit in the saved report.
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
