import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

let revision = 'd22e523485359a924cedfbc32ee3912c80319dbb';
let root = fileURLToPath(new URL('../', import.meta.url));
let directory = await mkdtemp(join(tmpdir(), 'dyno-interactor-'));
let exec = promisify(execFile);
try {
  let response = await fetch(`https://codeload.github.com/wwilsman/interactor.js/tar.gz/${revision}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Could not download Interactor: HTTP ${response.status}`);
  let archive = join(directory, 'source.tar.gz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await exec('tar', ['-xzf', archive, '--directory', directory]);
  let source = join(directory, `interactor.js-${revision}`);
  let snapshot = join(directory, 'snapshot');
  await mkdir(snapshot);
  await cp(join(source, 'lib'), join(snapshot, 'lib'), { recursive: true });
  await cp(join(source, 'LICENSE'), join(snapshot, 'LICENSE'));
  await exec(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--project', join(source, 'tsconfig.json'), '--outDir', join(snapshot, 'types'),
    '--declarationMap', 'false', '--tsBuildInfoFile', join(directory, 'types.tsbuildinfo')]);
  let { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  await writeFile(join(snapshot, 'README.md'), `# Interactor.js\n\nUnmodified source from [Interactor.js ${version}](https://github.com/wwilsman/interactor.js/tree/${revision}), commit \`${revision}\`. Its MIT license is in [LICENSE](LICENSE).\n\nDyno ships this snapshot so apps don't need Git subdependencies or an Interactor build step. Types are generated from the same source with Dyno's pinned TypeScript version.\n\nTo update it, change the revision in \`scripts/vendor-interactor.js\` and run \`npm run vendor:interactor\`. Review the source and declaration diff, then run the package and browser tests. Don't edit the snapshot by hand.\n`);
  let destination = join(root, 'vendor/interactor');
  await mkdir(join(root, 'vendor'), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(snapshot, destination, { recursive: true });
  console.log(`Updated Interactor ${version} at ${revision}.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
