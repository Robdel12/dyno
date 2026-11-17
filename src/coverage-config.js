import { resolve } from 'node:path';

/**
 * Coverage build inputs, original-source filters, report formats, and optional minimum percentages. Set enabled or pass --coverage to collect application coverage. A baseline includes unvisited files from the same instrumented app build.
 *
 * @api CoverageConfig
 */
export function normalizeCoverage(input, root, enabled) {
  if (input === undefined || typeof input === 'boolean') input = { enabled: input ?? false };
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('coverage must be a boolean or an object.');
  for (let key of Object.keys(input))
    if (!['enabled', 'include', 'exclude', 'baseline', 'reporters', 'thresholds'].includes(key))
      throw new Error(`Unknown coverage option: ${key}.`);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new Error('coverage.enabled must be a boolean.');
  let patterns = (name, fallback) => {
    let values = input[name] ?? fallback;
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim()) ||
      (name === 'include' && !values.length))
      throw new Error(`coverage.${name} must be an array of non-empty glob patterns.`);
    return Object.freeze([...values]);
  };
  let reporters = input.reporters ?? ['text', 'html', 'lcov', 'json', 'json-summary'];
  if (!Array.isArray(reporters) || reporters.some(name => !['text', 'html', 'lcov', 'json', 'json-summary'].includes(name)))
    throw new Error('coverage.reporters supports text, html, lcov, json, and json-summary.');
  if (input.baseline !== undefined && (typeof input.baseline !== 'string' || !input.baseline.trim()))
    throw new Error('coverage.baseline must be a non-empty path.');
  let thresholds = input.thresholds ?? {};
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds))
    throw new Error('coverage.thresholds must be an object.');
  for (let [name, value] of Object.entries(thresholds))
    if (!['lines', 'statements', 'functions', 'branches'].includes(name) || !Number.isFinite(value) || value < 0 || value > 100)
      throw new Error('coverage.thresholds accepts lines, statements, functions, and branches percentages from 0 to 100.');
  return Object.freeze({
    enabled: enabled ?? input.enabled ?? false,
    include: patterns('include', ['**/*']),
    exclude: patterns('exclude', ['**/node_modules/**', '**/*.test.*', '**/*.spec.*']),
    baseline: input.baseline ? resolve(root, input.baseline) : null,
    reporters: Object.freeze([...new Set(reporters)]),
    thresholds: Object.freeze({ ...thresholds }),
  });
}
