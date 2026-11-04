import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate, root, site } from './generate.js';
import { settings } from './settings.js';
import { checkLinks } from './links.js';

let exec = promisify(execFile);
let { version, path, base } = settings();
let git = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim();
let commit = await git('rev-parse', 'HEAD');
let dirty = Boolean(await git('status', '--porcelain', '--untracked-files=normal'));
let metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (version !== 'next') {
  if (version !== `v${metadata.version}`) throw new Error(`${version} does not match package version ${metadata.version}.`);
  if (dirty) throw new Error('Release docs require a clean checkout.');
  if (await git('rev-parse', `${version}^{commit}`) !== commit) throw new Error('Release tag must point to this exact checkout.');
}
process.env.DYNO_DOCS_BASE = base;
process.env.DYNO_DOCS_COMMIT = commit;
await generate();
let { stdout, stderr } = await exec(process.execPath, [join(site, 'node_modules/astro/bin/astro.mjs'), 'build'], {
  cwd: site, env: process.env, maxBuffer: 10 * 1024 * 1024,
});
process.stdout.write(stdout);
process.stderr.write(stderr);
if (/\[error\]/i.test(stdout + stderr)) throw new Error('Documentation generation reported an error.');
await writeFile(join(site, 'dist/version.json'), JSON.stringify({ schemaVersion: 1, version, packageVersion: metadata.version, commit, dirty, path, base }, null, 2) + '\n');
await checkLinks(join(site, 'dist'), base);
console.log(`Built ${version} from ${commit}${dirty ? ' (working tree)' : ''}.`);
