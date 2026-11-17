import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

let maximum = (target, source) => {
  for (let [path, fields] of Object.entries(source)) {
    target[path] ??= { s: {}, f: {}, b: {} };
    for (let field of ['s', 'f', 'b']) {
      for (let [key, value] of Object.entries(fields[field] ?? {})) {
        if (field === 'b') {
          target[path].b[key] ??= {};
          for (let [index, hit] of Object.entries(value)) target[path].b[key][index] = Math.max(target[path].b[key][index] ?? 0, hit);
        } else target[path][field][key] = Math.max(target[path][field][key] ?? 0, value);
      }
    }
  }
};
let complete = (baseline, counters) => Object.fromEntries(Object.entries(counters).map(([path, fields]) => {
  let file = structuredClone(baseline[path]);
  if (!file) throw new Error(`Framework coverage source changed: ${path}`);
  for (let field of ['s', 'f', 'b']) {
    for (let [key, value] of Object.entries(fields[field])) {
      if (field === 'b') for (let [index, hit] of Object.entries(value)) file.b[key][index] = hit;
      else file[field][key] = value;
    }
  }
  return [path, file];
}));

export function frameworkCoverageTarget({ summaries, scope, errors, testExitCode }) {
  let measured = scope === 'all-suites' && testExitCode === 0 && !errors.length;
  let scopes = Object.fromEntries(Object.entries(summaries).map(([name, summary]) =>
    [name, measured && ['lines', 'statements', 'functions', 'branches'].every(metric => summary[metric].pct >= 90)]));
  return { minimum: 90, met: Object.values(scopes).every(Boolean), scopes };
}

export async function frameworkCoverageReport({ directory, baseline, sources, root, scope }) {
  let buildId = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  let documents = new Map();
  let errors = [];
  for (let name of await readdir(join(directory, 'raw'))) {
    let record = JSON.parse(await readFile(join(directory, 'raw', name), 'utf8'));
    if (name.startsWith('errors-')) { errors.push(...record); continue; }
    if (record.schemaVersion !== 1 || record.buildId !== buildId || !['node', 'browser'].includes(record.kind))
      throw new Error(`Framework coverage record does not match the frozen build: ${name}`);
    let key = `${record.kind}:${record.id}`;
    let counters = documents.get(key) ?? {};
    maximum(counters, record.coverage);
    documents.set(key, counters);
  }
  let map = libCoverage.createCoverageMap(structuredClone(baseline));
  for (let counters of documents.values()) map.merge(complete(baseline, counters));
  let summaries = {};
  for (let [name, include] of [
    ['combined', () => true],
    ['hostAndSharedSource', path => !path.startsWith(join(root, 'src/browser/'))],
    ['browserSource', path => path.startsWith(join(root, 'src/browser/'))],
  ]) {
    let selected = libCoverage.createCoverageMap({});
    for (let path of map.files().filter(include)) selected.addFileCoverage(map.fileCoverageFor(path));
    summaries[name] = { files: selected.files().length, ...selected.getCoverageSummary().toJSON() };
  }
  let context = libReport.createContext({ dir: join(directory, 'report'), coverageMap: map, sourceFinder: path => sources[path] });
  for (let reporter of ['html', 'lcovonly', 'json', 'json-summary']) reports.create(reporter).execute(context);
  return { scope, collection: errors.length ? 'partial' : 'observed',
    limits: 'Counters are published at JavaScript task boundaries and pagehide. Forceful process or browser termination can prevent final delivery.',
    documents: documents.size, errors: [...new Set(errors)], summaries };
}
