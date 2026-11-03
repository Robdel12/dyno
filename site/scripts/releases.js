import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, unpack } from './archive.js';

let exec = promisify(execFile);
let gh = async (...args) => (await exec('gh', args, { maxBuffer: 10 * 1024 * 1024 })).stdout;
let [command, directory, tag] = process.argv.slice(2);
if (!directory || !['download', 'upload'].includes(command) || command === 'upload' && !tag)
  throw new Error('Usage: releases.js download <directory> | upload <directory> <tag>');
directory = resolve(directory);
await mkdir(directory, { recursive: true });
if (command === 'download') {
  let pages = JSON.parse(await gh('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases?per_page=100'));
  for (let release of pages.flat().filter(release => !release.draft)) {
    let name = `dyno-docs-${release.tag_name}.tar.gz`;
    if (!release.assets.some(asset => asset.name === name)) continue;
    await gh('release', 'download', release.tag_name, '--pattern', name, '--dir', directory);
  }
} else {
  let release = JSON.parse(await gh('release', 'view', tag, '--json', 'assets'));
  for (let name of [`dyno-${tag.slice(1)}.tgz`, `dyno-docs-${tag}.tar.gz`]) {
    if (!release.assets.some(asset => asset.name === name)) {
      await gh('release', 'upload', tag, join(directory, name));
      continue;
    }
    // A workflow rerun may find already uploaded assets. Verify and reuse them;
    // never clobber a release, even when only the final deployment failed.
    let temporary = await mkdtemp(join(tmpdir(), 'dyno-release-verify-'));
    try {
      await gh('release', 'download', tag, '--pattern', name, '--dir', temporary);
      if (name.endsWith('.tgz')) {
        if (!(await readFile(join(directory, name))).equals(await readFile(join(temporary, name))))
          throw new Error(`Release asset ${name} already exists with different bytes.`);
      } else {
        await unpack(join(directory, name), join(temporary, 'local'));
        await unpack(join(temporary, name), join(temporary, 'remote'));
        if (await fingerprint(join(temporary, 'local')) !== await fingerprint(join(temporary, 'remote')))
          throw new Error(`Release docs ${tag} already exist with different content.`);
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
