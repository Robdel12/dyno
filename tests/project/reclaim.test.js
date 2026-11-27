import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../helpers/project.js';

let browser = process.env.DYNO_TEST_BROWSER ?? 'chromium';
let interactive = { browser: { name: browser, args: [browser === 'chromium' ? '--headless=new' : '--headless'] } };
// Setup leaves a marker per session, like a container named after it. Teardown
// removes it; reclaim removes it for a session that never got to tear down.
let setup = `import { mkdir, rm, writeFile } from 'node:fs/promises';
export default async ({ session, onCleanup }) => {
  await mkdir('resources', { recursive: true });
  await writeFile('resources/' + session.id, 'running');
  onCleanup(() => rm('resources/' + session.id, { force: true }));
  return {};
};
export async function reclaim({ session }) {
  await rm('resources/' + session.id, { force: true });
  await mkdir('reclaimed', { recursive: true });
  await writeFile('reclaimed/' + session.id, session.startedAt);
}`;
let exists = path => access(path).then(() => true, () => false);
let sessionIds = async directory => (await readdir(join(directory, '.dyno/sessions')).catch(() => [])).map(name => name.replace('.json', ''));

test('a session killed before its cleanup is reclaimed by the next run', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: { ...interactive, setup: './setup.js' }, files: { 'setup.js': setup } });
  let killed = fixture.run(['--ui']);
  await killed.waitForEvent('complete');
  let [id] = await sessionIds(fixture.directory);
  assert.ok(id, 'A live session with setup is recorded.');
  assert.equal(await exists(join(fixture.directory, 'resources', id)), true);
  // kill -9 skips every handler, like a crash. Clear the leftover browser and app too.
  process.kill(killed.child.pid, 'SIGKILL');
  await once(killed.child, 'close');
  try { process.kill(-killed.child.pid, 'SIGKILL'); } catch {}
  assert.equal(await exists(join(fixture.directory, 'resources', id)), true, 'Cleanup never ran.');
  let next = await fixture.run().completion;
  assert.equal(next.code, 0, next.stdout + next.stderr);
  assert.equal(await exists(join(fixture.directory, 'resources', id)), false);
  assert.ok(await readFile(join(fixture.directory, 'reclaimed', id), 'utf8'));
  assert.match(next.stderr, /Cleaned up after an interrupted Dyno session/);
  assert.deepEqual(await sessionIds(fixture.directory), [], 'Finished and reclaimed sessions are forgotten.');
});

test('closing the terminal runs project cleanup and exits 129', { timeout: 90000 }, async t => {
  let fixture = await project(t, { config: { ...interactive, setup: './setup.js' }, files: { 'setup.js': setup } });
  let session = fixture.run(['--ui']);
  await session.waitForEvent('complete');
  let [id] = await sessionIds(fixture.directory);
  session.child.kill('SIGHUP');
  let result = await session.completion;
  assert.equal(result.code, 129, result.stdout + result.stderr);
  assert.equal(await exists(join(fixture.directory, 'resources', id)), false, 'Teardown ran on SIGHUP.');
  assert.deepEqual(await sessionIds(fixture.directory), []);
});

test('a second Ctrl+C from npm run or npx does not cut cleanup short', { timeout: 90000 }, async t => {
  // npm run and npx forward the terminal's SIGINT, so Dyno can get it again mid-cleanup.
  let forwarded = setup.replace(`onCleanup(() => rm('resources/' + session.id, { force: true }));`,
    `onCleanup(async () => {
    process.kill(process.pid, 'SIGINT');
    await writeFile('resources/cleaning', 'yes');
    await rm('resources/' + session.id, { force: true });
  });`);
  let fixture = await project(t, { config: { ...interactive, setup: './setup.js' }, files: { 'setup.js': forwarded } });
  let session = fixture.run(['--ui']);
  await session.waitForEvent('complete');
  let [id] = await sessionIds(fixture.directory);
  session.child.kill('SIGINT');
  let result = await session.completion;
  assert.equal(result.code, 130, result.stdout + result.stderr);
  assert.equal(await exists(join(fixture.directory, 'resources', id)), false, 'Teardown finished.');
  assert.deepEqual(await sessionIds(fixture.directory), []);
});
