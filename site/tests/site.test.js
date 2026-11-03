import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { root } from '../scripts/generate.js';
import { fingerprint } from '../scripts/archive.js';

let exec = promisify(execFile);
let ignored = new Set(['node_modules', '.git', '.astro', '.generated', 'dist', 'published']);
let mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

test('builds exact-tag docs, preserves them through source edits, and reads both versions in Dyno', { timeout: 150000 }, async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-docs-site-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let checkout = join(directory, 'checkout');
  await mkdir(checkout);
  for (let path of ['src', 'types', 'bin', 'examples', 'docs', 'site', 'README.md', 'vision.md', 'package.json', 'package-lock.json', '.gitignore'])
    await cp(join(root, path), join(checkout, path), { recursive: true, filter: path => !ignored.has(basename(path)) && !path.endsWith(`${sep}src${sep}content${sep}docs`) && !basename(path).startsWith('tmp-') });
  await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
  await cp(join(root, 'site/node_modules'), join(checkout, 'site/node_modules'), { recursive: true, mode: constants.COPYFILE_FICLONE, filter: path => basename(path) !== '.vite' });
  let run = (file, args, options = {}) => exec(file, args, { cwd: checkout, maxBuffer: 10 * 1024 * 1024, ...options });
  await run('git', ['init', '--quiet']);
  await run('git', ['add', '.']);
  await run('git', ['-c', 'user.name=Docs test', '-c', 'user.email=docs@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Docs fixture']);
  let packageVersion = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')).version;
  let tag = `v${packageVersion}`;
  await run('git', ['tag', tag]);
  let environment = { ...process.env, DYNO_DOCS_VERSION: tag };
  await run(process.execPath, ['site/scripts/build.js'], { env: environment });
  let release = JSON.parse(await readFile(join(checkout, 'site/dist/version.json'), 'utf8'));
  assert.equal(release.version, tag);
  assert.equal(release.dirty, false);
  assert.equal(release.commit, (await run('git', ['rev-parse', tag])).stdout.trim());
  let archives = join(directory, 'archives');
  await run(process.execPath, ['site/scripts/archive.js', 'pack', 'site/dist', join(archives, `dyno-docs-${tag}.tar.gz`)]);
  let source = join(checkout, 'src/browser/index.js');
  await writeFile(source, (await readFile(source, 'utf8')).replace('The app gets its full viewport.', 'Next-only documentation marker. The app gets its full viewport.'));
  await assert.rejects(run(process.execPath, ['site/scripts/build.js'], { env: environment }), /Release docs require a clean checkout/);
  await run(process.execPath, ['site/scripts/build.js'], { env: { ...process.env, DYNO_DOCS_VERSION: 'next' } });
  let published = join(directory, 'published');
  await run(process.execPath, ['site/scripts/archive.js', 'assemble', 'site/dist', archives, published]);
  let frozen = await fingerprint(join(published, tag));
  await run(process.execPath, ['site/scripts/archive.js', 'assemble', 'site/dist', archives, published]);
  assert.equal(await fingerprint(join(published, tag)), frozen);
  assert.match(await readFile(join(published, 'next/cli/index.html'), 'utf8'), /--workers/);
  assert.match(await readFile(join(published, 'next/example/index.html'), 'utf8'), /saves a contact name/);
  assert.match(await readFile(join(published, 'next/api/dyno/interfaces/application/index.html'), 'utf8'), /Navigate to a same-origin app path/);
  let declaration = await readFile(join(published, 'next/api/dyno/interfaces/testfunction/index.html'), 'utf8');
  assert.equal(declaration.split('Declare, focus or skip a test.').length, 2);

  let server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://docs.test').pathname);
      if (!pathname.startsWith('/dyno/')) { response.writeHead(404).end(); return; }
      let path = resolve(published, pathname.slice('/dyno/'.length));
      if (!path.startsWith(published + sep) && path !== published) { response.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      let extension = path.slice(path.lastIndexOf('.'));
      response.writeHead(200, { 'Content-Type': mime[extension] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let config = join(directory, 'dyno.config.js');
  await writeFile(config, `export default ${JSON.stringify({
    testDir: join(root, 'site/tests/browser'), port: 0, timeout: 15000, runTimeout: 60000,
    artifactsDir: join(directory, 'images'), reportDir: join(directory, 'reports'),
    webServer: { url: `http://127.0.0.1:${server.address().port}`, reuseExistingServer: true },
  })};`);
  let result = await run(process.execPath, [join(root, 'bin/dyno.js'), '--config', config, '--json']).catch(error => error);
  let events = result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  let failures = events.filter(event => event.type === 'test' && event.status === 'failed').map(event => ({ name: event.name, error: event.error?.message, source: event.error?.source }));
  let complete = events.find(event => event.type === 'complete');
  assert.ok(complete?.passed > 0, 'Expected browser workflows to run');
  assert.equal(complete.failed, 0, JSON.stringify(failures) + result.stderr);
  assert.equal(complete.passed, events.filter(event => event.type === 'test').length);
  assert.equal(result.code ?? 0, 0, result.stderr);
  if (process.env.DYNO_DOCS_SCREENSHOTS) {
    await mkdir(process.env.DYNO_DOCS_SCREENSHOTS, { recursive: true });
    await cp(join(directory, 'images'), process.env.DYNO_DOCS_SCREENSHOTS, { recursive: true });
  }
});
