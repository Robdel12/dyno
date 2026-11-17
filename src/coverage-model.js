import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceMap } from '@jridgewell/trace-mapping';
import libCoverage from 'istanbul-lib-coverage';
import libSourceMaps from 'istanbul-lib-source-maps';

export let coveragePacketLimit = 8 * 1024 * 1024;
export let coverageRunLimit = 32 * 1024 * 1024;
let metrics = ['lines', 'statements', 'functions', 'branches'];
let record = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
let text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
let count = value => Number.isSafeInteger(value) && value >= 0;
let fail = message => { throw new Error(`Coverage: ${message}`); };
let freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (let child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
let digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
let inside = (root, path) => {
  let name = relative(root, path);
  return name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
};
let filePath = (root, path) => resolve(root, path.startsWith('file:') ? fileURLToPath(path) : path);
let identity = file => digest({ statementMap: file.statementMap, fnMap: file.fnMap,
  branchMap: file.branchMap, inputSourceMap: file.inputSourceMap });

function location(value) {
  let position = point => record(point) && Number.isSafeInteger(point.line) && point.line >= 1 && count(point.column);
  return record(value) && position(value.start) && position(value.end) &&
    (value.end.line > value.start.line || (value.end.line === value.start.line && value.end.column >= value.start.column));
}

let unknownPosition = value => record(value) && Object.keys(value).every(key =>
  ['line', 'column'].includes(key) && value[key] === undefined);
let branchLocation = value => location(value) || (record(value) && unknownPosition(value.start) && unknownPosition(value.end));

function sourceMap(value) {
  if (!record(value) || value.version !== 3 || !Array.isArray(value.sources) ||
    value.sources.some(source => typeof source !== 'string') || !Array.isArray(value.names) ||
    value.names.some(name => typeof name !== 'string') || typeof value.mappings !== 'string' ||
    (value.sourceRoot !== undefined && typeof value.sourceRoot !== 'string') ||
    (value.sourcesContent !== undefined && (!Array.isArray(value.sourcesContent) ||
      value.sourcesContent.length !== value.sources.length ||
      value.sourcesContent.some(content => content !== null && typeof content !== 'string'))))
    fail('inputSourceMap must be a flat version 3 source map.');
  return JSON.parse(JSON.stringify(value));
}

function fileCoverage(path, input, zero) {
  if (!text(path) || !record(input) || input.path !== path) fail('each file needs a matching path.');
  let validMap = (map, hits, validate, arrays = false) => {
    if (!record(map) || !record(hits) || Object.keys(map).length !== Object.keys(hits).length)
      return false;
    return Object.entries(map).every(([key, value]) => /^\d+$/.test(key) && Object.hasOwn(hits, key) && validate(value) &&
      (arrays ? Array.isArray(hits[key]) && hits[key].length === value.locations.length && hits[key].every(count) : count(hits[key])));
  };
  if (!validMap(input.statementMap, input.s, location) ||
    !validMap(input.fnMap, input.f, value => record(value) && typeof value.name === 'string' &&
      location(value.loc) && (value.decl === undefined || location(value.decl))) ||
    !validMap(input.branchMap, input.b, value => record(value) && typeof value.type === 'string' &&
      Array.isArray(value.locations) && value.locations.every(branchLocation) &&
      (value.loc === undefined || location(value.loc)), true))
    fail(`invalid statements, functions, branches, or counters for ${path}.`);
  if (input.bT !== undefined && !validMap(input.branchMap, input.bT, () => true, true))
    fail(`invalid branch truthiness counters for ${path}.`);
  if (input.hash !== undefined && !text(input.hash)) fail(`invalid source hash for ${path}.`);
  if (zero && ['s', 'f', 'b', 'bT'].some(key => Object.values(input[key] ?? {}).flat().some(value => value !== 0)))
    fail(`baseline counters must be zero for ${path}.`);
  let value = { path, statementMap: input.statementMap, fnMap: input.fnMap, branchMap: input.branchMap,
    s: input.s, f: input.f, b: input.b,
    ...(input.bT ? { bT: input.bT } : {}), ...(input.hash ? { hash: input.hash } : {}),
    ...(input.inputSourceMap ? { inputSourceMap: sourceMap(input.inputSourceMap) } : {}) };
  return JSON.parse(JSON.stringify(value));
}

function coverageData(input, { zero = false } = {}) {
  if (!record(input)) fail('counters must be an Istanbul coverage object.');
  return Object.fromEntries(Object.entries(input).map(([path, value]) => [path, fileCoverage(path, value, zero)]));
}

function agree(previous, next) {
  if (identity(previous) !== identity(next) || (previous.hash && next.hash && previous.hash !== next.hash))
    fail(`the instrumented source changed for ${next.path}. Restart the run with one app build.`);
}

function increasing(previous, next) {
  for (let [path, file] of Object.entries(previous)) {
    let current = next[path];
    if (!current) fail(`a cumulative snapshot lost ${path}.`);
    agree(file, current);
    for (let field of ['s', 'f', 'b', 'bT'])
      for (let [key, value] of Object.entries(file[field] ?? {})) {
        let old = Array.isArray(value) ? value : [value];
        let now = Array.isArray(current[field]?.[key]) ? current[field][key] : [current[field]?.[key]];
        if (old.some((hit, index) => !count(now[index]) || now[index] < hit))
          fail(`cumulative counters decreased for ${path}.`);
      }
  }
}

export function createCoverageState() {
  return freeze({ documents: [], data: {}, errors: [], bytes: 4 });
}

export function acceptCoverage(state, input, { workerId }) {
  if (!record(input) || !text(workerId) || !text(input.executionId) || !text(input.documentId) ||
    !Number.isSafeInteger(input.sequence) || input.sequence < 1)
    fail('a snapshot needs worker, execution, document, and positive sequence identifiers.');
  let error = typeof input.error === 'string' ? input.error : input.error?.message;
  if (input.error !== undefined && !text(error)) fail('a collection error must be a non-empty message.');
  let key = JSON.stringify([workerId, input.executionId, input.documentId]);
  let previous = state.documents.find(document => document.key === key);
  let data = coverageData(input.coverage ?? {});
  if (error && previous && !Object.keys(data).length) data = previous.data;
  let serialized = JSON.stringify({ coverage: data, error });
  let bytes = Buffer.byteLength(serialized);
  if (bytes > coveragePacketLimit) fail('a snapshot exceeds the 8 MiB limit.');
  let hash = digest({ coverage: data, error });
  if (previous && input.sequence < previous.sequence) return state;
  if (previous && input.sequence === previous.sequence) {
    if (hash !== previous.digest) fail('a replay changed an accepted snapshot.');
    return state;
  }
  if (previous) increasing(previous.data, data);
  for (let [path, file] of Object.entries(data))
    if (state.data[path]) agree(state.data[path], file);
  for (let document of state.documents)
    for (let [path, file] of Object.entries(data))
      if (document.data[path]) agree(document.data[path], file);
  let total = state.bytes - (previous?.bytes ?? 0) + bytes;
  if (total > coverageRunLimit || (!previous && state.documents.length >= 10000))
    fail('the run exceeds the 32 MiB coverage collection limit.');
  let document = freeze({ key, workerId, executionId: input.executionId, documentId: input.documentId,
    sequence: input.sequence, digest: hash, bytes, data, ...(error ? { error } : {}) });
  return freeze({ ...state, documents: [...state.documents.filter(item => item.key !== key), document], bytes: total });
}

function mergeData(inputs, root) {
  let map = libCoverage.createCoverageMap({});
  let known = new Map();
  for (let input of inputs)
    for (let [path, original] of Object.entries(input)) {
      let name = root ? filePath(root, path) : path;
      let value = { ...structuredClone(original), path: name };
      if (known.has(name)) agree(known.get(name), value);
      else known.set(name, value);
      map.merge({ [name]: value });
    }
  return map;
}

export function releaseCoverage(state, { workerId, executionId }) {
  let released = state.documents.filter(document => document.workerId === workerId && document.executionId === executionId);
  if (!released.length) return state;
  let map = mergeData([state.data, ...released.map(document => document.data)]);
  let data = JSON.parse(JSON.stringify(map.toJSON()));
  let documents = state.documents.filter(document => !released.includes(document));
  let errors = [...new Set([...state.errors, ...released.flatMap(document => document.error ? [document.error] : [])])];
  let bytes = Buffer.byteLength(JSON.stringify(data)) + Buffer.byteLength(JSON.stringify(errors)) +
    documents.reduce((total, document) => total + document.bytes, 0);
  if (bytes > coverageRunLimit) fail('the run exceeds the 32 MiB coverage collection limit.');
  return freeze({ documents, data, errors, bytes });
}

function selected(path, options, root) {
  if (!inside(root, path)) return false;
  let name = relative(root, path).split(sep).join('/');
  return (!options.include?.length || options.include.some(pattern => matchesGlob(name, pattern))) &&
    !options.exclude?.some(pattern => matchesGlob(name, pattern));
}

function result(map, { scope, complete, failures, observed, sources = {}, identities = {}, options, evaluate }) {
  let totals = map.getCoverageSummary();
  let summary = Object.fromEntries(metrics.map(metric => [metric, totals[metric]]));
  let status = 'partial';
  if (!observed || !map.files().length) status = 'unavailable';
  else if (complete && !failures.length) status = 'complete';
  let reasons = [...new Set(failures)];
  if (status === 'unavailable') reasons.push('No application coverage was collected for the selected files. Enable Istanbul instrumentation in the app test build.');
  else if (!complete) reasons.push('Coverage collection ended before every worker completed.');
  if (status === 'complete' && evaluate)
    for (let [metric, threshold] of Object.entries(options.thresholds ?? {})) {
      let value = summary[metric];
      if (!value || !Number.isFinite(threshold) || threshold < 0 || threshold > 100)
        fail('thresholds must be percentages for lines, statements, functions, or branches.');
      let percentage = value.total ? value.covered / value.total * 100 : 100;
      if (percentage < threshold)
        reasons.push(`${metric} coverage is ${value.pct}%, below the ${threshold}% threshold.`);
    }
  return freeze({ status, scope, summary, failures: reasons, failed: status !== 'complete' || reasons.length > 0,
    data: JSON.parse(JSON.stringify(map.toJSON())), sources, identities });
}

export function unavailableCoverage(message) {
  return result(libCoverage.createCoverageMap({}), { scope: 'loaded-files', complete: false,
    failures: [message], observed: false, options: {}, evaluate: false });
}

export async function finalizeCoverage(state, options, { root, complete = true, evaluate = true }) {
  let baseline = {};
  if (options.baseline) {
    let info = await stat(options.baseline);
    if (info.size > coverageRunLimit) fail('the baseline exceeds the 32 MiB limit.');
    let contents = await readFile(options.baseline, 'utf8');
    if (Buffer.byteLength(contents) > coverageRunLimit) fail('the baseline exceeds the 32 MiB limit.');
    baseline = coverageData(JSON.parse(contents), { zero: true });
  }
  let map = mergeData([baseline, state.data, ...state.documents.map(document => document.data)], root);
  let identities = Object.fromEntries(map.files().map(path => {
    let file = map.fileCoverageFor(path).data;
    return [path, { schema: identity(file), ...(file.hash ? { hash: file.hash } : {}) }];
  }));
  let sources = {};
  for (let path of map.files()) {
    let input = map.fileCoverageFor(path).data.inputSourceMap;
    if (!input?.sourcesContent) continue;
    let traced = new TraceMap(input);
    for (let [index, source] of traced.resolvedSources.entries()) {
      let name = filePath(dirname(path), source);
      if (inside(root, name) && typeof input.sourcesContent[index] === 'string')
        sources[name] = input.sourcesContent[index];
    }
  }
  let store = libSourceMaps.createSourceMapStore({ baseDir: root });
  try { map = await store.transformCoverage(map); }
  finally { store.dispose(); }
  map.filter(path => selected(path, options, root));
  return result(map, { scope: options.baseline ? 'all-files' : 'loaded-files', complete, options, evaluate, sources, identities,
    failures: [...state.errors, ...state.documents.flatMap(document => document.error ? [document.error] : [])],
    observed: Object.keys(state.data).length || state.documents.some(document => Object.keys(document.data).length) });
}

export function mergeCoverageResults(results, options, { root, complete = true, evaluate = true }) {
  let identities = {};
  let sources = {};
  for (let value of results) {
    for (let [path, next] of Object.entries(value.identities ?? {})) {
      let previous = identities[path];
      if (previous && (previous.schema !== next.schema || (previous.hash && next.hash && previous.hash !== next.hash)))
        fail(`the instrumented source changed for ${path}. Restart the batch with one app build.`);
      identities[path] = next;
    }
    for (let [path, content] of Object.entries(value.sources ?? {})) {
      if (Object.hasOwn(sources, path) && sources[path] !== content)
        fail(`the original source changed for ${path}. Restart the batch with one app build.`);
      sources[path] = content;
    }
  }
  let map = mergeData(results.map(value => value.data), root);
  map.filter(path => selected(path, options, root));
  return result(map, { scope: results.length && results.every(value => value.scope === 'all-files') ? 'all-files' : 'loaded-files',
    complete: complete && results.every(value => value.status === 'complete'),
    options, evaluate, sources, identities,
    failures: results.flatMap(value => value.status === 'complete' ? [] : value.failures),
    observed: results.some(value => value.status !== 'unavailable') });
}
