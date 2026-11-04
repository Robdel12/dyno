import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLinks } from '../scripts/links.js';

test('built pages resolve local routes and fragments and reject broken or escaped links', async t => {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-docs-links-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'guide'));
  await writeFile(join(directory, 'guide/index.html'), '<h1 id="setup">Setup</h1>');
  let homepage = join(directory, 'index.html');
  for (let href of ['guide/#setup', '/dyno/next/guide/#setup', 'https://example.test/missing', '/dyno/']) {
    await writeFile(homepage, `<a href="${href}">Read</a>`);
    await checkLinks(directory, '/dyno/next/');
  }
  for (let [href, error] of [['guide/#missing', /Missing docs anchor/], ['missing/', /Broken docs link/], ['../missing/', /Docs link leaves version/]]) {
    await writeFile(homepage, `<a href="${href}">Read</a>`);
    await assert.rejects(checkLinks(directory, '/dyno/next/'), error);
  }
});
