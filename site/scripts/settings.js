export function settings(environment = process.env) {
  let version = environment.DYNO_DOCS_VERSION ?? 'next';
  if (version !== 'next' && !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version))
    throw new Error('DYNO_DOCS_VERSION must be next or a release tag such as v0.1.0.');
  let path = environment.DYNO_DOCS_PATH ?? '/dyno/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(path)) throw new Error('DYNO_DOCS_PATH must be an absolute directory path, such as /dyno/.');
  return { version, path, base: `${path}${version}/` };
}
