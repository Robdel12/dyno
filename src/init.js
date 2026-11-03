/**
 * ```sh
 * npm install --save-dev github:Robdel12/dyno
 * npx dyno init
 * npx dyno install
 * npx dyno doctor
 * ```
 *
 * `init` creates `dyno.config.js` and one example test. It checks both paths before writing and leaves existing files alone. Update the command, URL, and assertion for your app.
 *
 * ```js
 * export default {
 *   testDir: 'tests/browser',
 *   webServer: {
 *     command: 'npm run dev',
 *     url: 'http://127.0.0.1:3000',
 *     reuseExistingServer: !process.env.CI
 *   }
 * };
 * ```
 *
 * ```js
 * import { describe, test } from 'dyno';
 *
 * describe('Contacts', () => {
 *   test('saves a contact', async ({ app, I }) => {
 *     await app.goto('/contacts/new');
 *     await I.type('Robert').into('$(input[name=name])');
 *     await I.click('Save');
 *     await I.find('$([role=status])').text('Contact saved');
 *   });
 * });
 * ```
 *
 * Run `npx dyno`, or add `"test:browser": "dyno"` to your package scripts. Tests can use browser APIs and browser-compatible npm packages. JavaScript, JSX, TypeScript, and TSX are supported; TypeScript is transpiled without type checking. Filesystem and database setup belongs in the Node setup hook.
 *
 * Use the [API reference](api.md) to look up methods and the [custom interactor guide](guide.md#custom-interactors) to share component workflows.
 *
 * @guide getting-started Add it to an app
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
