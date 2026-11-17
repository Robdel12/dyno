import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

let inside = (root, path) => {
  let name = relative(root, path);
  return name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
};

async function writtenFiles(directory, parent = directory) {
  let files = [];
  for (let entry of await readdir(parent, { withFileTypes: true })) {
    let path = join(parent, entry.name);
    if (entry.isDirectory()) files.push(...await writtenFiles(directory, path));
    else files.push({ path: relative(directory, path).split(sep).join('/'), bytes: (await stat(path)).size });
  }
  return files;
}

export async function writeCoverageReport(result, directory, options, { root }) {
  await mkdir(directory, { recursive: true });
  let realRoot = realpathSync(root);
  let context = libReport.createContext({
    dir: directory,
    coverageMap: libCoverage.createCoverageMap(structuredClone(result.data)),
    sourceFinder(path) {
      let name = resolve(root, path);
      if (!inside(root, name)) throw new Error('Coverage source is outside the project root.');
      if (Object.hasOwn(result.sources ?? {}, name)) return result.sources[name];
      let real = realpathSync(name);
      if (!inside(realRoot, real)) throw new Error('Coverage source resolves outside the project root.');
      return readFileSync(real, 'utf8');
    },
  });
  for (let reporter of new Set(options.reporters ?? ['html', 'lcov', 'json', 'json-summary', 'text'])) {
    if (reporter === 'text') continue;
    if (!['html', 'lcov', 'json', 'json-summary'].includes(reporter)) throw new Error(`Unknown coverage reporter: ${reporter}.`);
    reports.create(reporter === 'lcov' ? 'lcovonly' : reporter).execute(context);
  }
  let files = await writtenFiles(directory);
  return { bytes: files.reduce((total, file) => total + file.bytes, 0), files: files.map(file => file.path) };
}

export function publicCoverage(result) {
  let { status, scope, summary, failures, failed } = result;
  return { status, scope, summary, failures, failed };
}
