/**
 * @guide getting-started Write your first test
 * Start with a workflow you care about. We'll use saving a contact here; swap in your app's route, labels and expected result.
 *
 * ## Install Dyno
 *
 * You'll need Node 24+. Install from GitHub for now, then download Chromium once:
 *
 * ```sh
 * npm install --save-dev github:Robdel12/dyno
 * npx dyno init
 * npx dyno install
 * ```
 *
 * `init` adds a config and an example test without overwriting existing files. Commit your lockfile so local runs and CI use the same Dyno revision.
 *
 * Dyno currently pins Interactor fixes that are not yet on the registry. pnpm 11 blocks Git subdependencies and their prepare builds by default. Projects that permit this Git source need the following in `pnpm-workspace.yaml`, alongside their existing build entries:
 *
 * ```yaml
 * blockExoticSubdeps: false
 * allowBuilds:
 *   interactor.js: true
 * ```
 *
 * `blockExoticSubdeps` changes the project's whole dependency-source policy; the build permission above only allows Interactor. See [pnpm's source policy](https://pnpm.io/settings#blockexoticsubdeps) before choosing that setting.
 *
 * ## Point it at your app
 *
 * In `dyno.config.js`, set the command that starts your app and the URL it serves:
 *
 * ```js
 * export default {
 *   testDir: 'tests/browser',
 *   webServer: {
 *     command: 'npm run dev',
 *     url: 'http://127.0.0.1:3000',
 *     reuseExistingServer: !process.env.CI,
 *   },
 * };
 * ```
 *
 * Dyno starts that command for you. Locally, `reuseExistingServer` lets you use an app that's already running; Dyno leaves that server alone when it stops.
 *
 * ## Test the result
 *
 * Replace the example test in `tests/browser`:
 *
 * ```js
 * import { describe, test } from 'dyno';
 *
 * describe('Contacts', () => {
 *   test('saves a contact', async ({ app, I }) => {
 *     await app.goto('/contacts/new');
 *     await I.find('Name').then.fill('Robert');
 *     await I.click('Save');
 *     await I.find('$([role=status])').text('Contact saved');
 *   });
 * });
 * ```
 *
 * Interactor waits for the expected UI. Await each action and assertion, and keep tests inside a named `describe`.
 *
 * ## Run it
 *
 * ```sh
 * npx dyno doctor
 * npx dyno --ui
 * ```
 *
 * `doctor` checks your config, test bundle and browser setup. `--ui` runs the test with the app visible. Use `npx dyno` for a headless run.
 *
 * Next, [learn the interaction basics](guide.md#interact-with-the-app) or [share workflows with custom interactors](guide.md#custom-interactors). JavaScript, JSX, TypeScript and TSX work; run your own type checker for TypeScript.
 */

import { access, mkdir, unlink, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

let scaffold = Object.freeze([
  Object.freeze({
    path: 'dyno.config.js',
    contents: `export default {
  testDir: 'tests/browser',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI
  }
};
`
  }),
  Object.freeze({
    path: 'tests/browser/home.test.js',
    contents: `import { describe, test } from 'dyno';

describe('Application', () => {
  test('opens the application', async ({ app, I }) => {
    await app.goto('/');
    await I.find('Welcome').visible();
  });
});
`
  })
]);

export async function initializeProject(root) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read package.json: ${error.message}`);
  }
  if (metadata?.type === 'commonjs')
    throw new Error(
      'Dyno config uses ES modules. Set package.json type to module or keep Dyno in a separate ES module package before running init.'
    );
  let command = metadata?.scripts?.dev ? 'npm run dev' : metadata?.scripts?.start ? 'npm start' : 'npm run dev';
  let files = scaffold.map((file) => ({
    ...file,
    contents: file.contents.replace('npm run dev', command),
    absolutePath: resolve(root, file.path)
  }));
  for (let file of files) {
    try {
      await access(file.absolutePath);
      throw new Error(`Refusing to overwrite ${file.path}.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let created = [];
  try {
    for (let file of files) {
      await mkdir(dirname(file.absolutePath), { recursive: true });
      await writeFile(file.absolutePath, file.contents, { flag: 'wx' });
      created = [...created, file.absolutePath];
    }
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path)));
    throw error;
  }
}
