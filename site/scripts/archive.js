import { createHash } from 'node:crypto';
import { access, cp, glob, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { settings } from './settings.js';

async function metadata(directory) {
  let value = JSON.parse(await readFile(join(directory, 'version.json'), 'utf8'));
  if (typeof value.version !== 'string' || typeof value.path !== 'string' || typeof value.packageVersion !== 'string' || typeof value.dirty !== 'boolean')
    throw new Error(`Incomplete docs build metadata in ${directory}.`);
  let expected = settings({ DYNO_DOCS_VERSION: value.version, DYNO_DOCS_PATH: value.path });
  if (value.schemaVersion !== 1 || expected.base !== value.base || !/^[a-f0-9]{40}$/.test(value.commit))
    throw new Error(`Invalid docs build metadata in ${directory}.`);
  return value;
}
export async function fingerprint(directory) {
  directory = resolve(directory);
  let files = [];
  for (let path of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (path.isSymbolicLink()) throw new Error('Docs archives cannot contain symlinks.');
    if (path.isFile()) files.push(join(path.parentPath, path.name));
  }
  let hash = createHash('sha256');
  for (let path of files.sort()) {
    let bytes = await readFile(path);
    hash.update(JSON.stringify([path.slice(directory.length + 1), bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}
export async function pack(directory, output) {
  await fingerprint(directory);
  let value = await metadata(directory);
  if (value.version === 'next' || value.dirty !== false || value.version !== `v${value.packageVersion}`)
    throw new Error('Only clean, matching release builds can become release archives.');
  await mkdir(dirname(output), { recursive: true });
  await tar.c({ cwd: directory, file: output, gzip: true, portable: true, noMtime: true }, ['.']);
}
export async function unpack(archive, directory) {
  await mkdir(directory, { recursive: true });
  await tar.x({ file: archive, cwd: directory, strict: true, filter: (path, entry) => {
    if (path.startsWith('/') || path.split('/').includes('..') || !['File', 'Directory'].includes(entry.type))
      throw new Error(`Unsafe docs archive entry: ${path}`);
    return true;
  } });
  let value = await metadata(directory);
  if (value.version === 'next' || value.dirty !== false || value.version !== `v${value.packageVersion}`)
    throw new Error('Downloaded docs archive is not a clean release.');
}
export async function assemble({ next, archives, output }) {
  let current = await metadata(next);
  if (current.version !== 'next') throw new Error('The current build must be Next.');
  let staging = await mkdtemp(join(tmpdir(), 'dyno-docs-publish-'));
  try {
    await mkdir(output, { recursive: true });
    let versions = [];
    async function add(directory, value) {
      if (value.path !== current.path) throw new Error(`Cannot mix docs URL bases: ${value.path} and ${current.path}.`);
      let destination = join(output, value.version);
      let exists = await access(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (exists && value.version !== 'next') {
        if (await fingerprint(destination) !== await fingerprint(directory)) throw new Error(`Refusing to replace immutable docs ${value.version}.`);
      } else {
        await rm(destination, { recursive: true, force: true });
        await cp(directory, destination, { recursive: true });
      }
      versions.push({ version: value.version, path: value.base, commit: value.commit });
    }
    await add(next, current);
    for await (let file of glob('dyno-docs-v*.tar.gz', { cwd: archives })) {
      let directory = join(staging, file);
      await unpack(join(archives, file), directory);
      let value = await metadata(directory);
      if (file !== `dyno-docs-${value.version}.tar.gz`) throw new Error(`Archive filename does not match ${value.version}.`);
      if (versions.some(entry => entry.version === value.version)) throw new Error(`Duplicate docs version ${value.version}.`);
      await add(directory, value);
    }
    // Include existing frozen versions when assembling into a retained directory.
    for await (let path of glob('v*/version.json', { cwd: output })) {
      let value = await metadata(dirname(join(output, path)));
      if (value.path !== current.path) throw new Error('Existing docs use a different URL base.');
      if (!versions.some(entry => entry.version === value.version)) versions.push({ version: value.version, path: value.base, commit: value.commit });
    }
    let releases = versions.filter(entry => entry.version !== 'next').sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
    let latest = releases.find(entry => !entry.version.includes('-')) ?? versions[0];
    await writeFile(join(output, 'versions.json'), JSON.stringify({ schemaVersion: 1, latest: latest.version, versions: [versions[0], ...releases] }, null, 2) + '\n');
    let links = [versions[0], ...releases].map(entry => `<li><a href="${entry.path}">${entry.version === 'next' ? 'Next (unreleased)' : entry.version}</a></li>`).join('\n');
    await writeFile(join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dyno documentation</title><meta http-equiv="refresh" content="0;url=${latest.path}"><h1>Dyno documentation</h1><p><a href="${latest.path}">Read the ${latest.version} docs</a></p><ul>${links}</ul></html>\n`);
    await writeFile(join(output, '.nojekyll'), '');
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let [command, ...args] = process.argv.slice(2);
  if (command === 'pack' && args.length === 2) await pack(...args.map(path => resolve(path)));
  else if (command === 'assemble' && args.length === 3) await assemble({ next: resolve(args[0]), archives: resolve(args[1]), output: resolve(args[2]) });
  else throw new Error('Usage: archive.js pack <build> <archive> | assemble <next-build> <archives-dir> <output>');
}
