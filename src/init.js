import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

let scaffold = Object.freeze([
  Object.freeze({ path: 'dyno.config.js', contents: `export default {
  testDir: 'tests/browser',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI
  }
};
` }),
  Object.freeze({ path: 'tests/browser/home.test.js', contents: `import { test } from 'dyno';

test('opens the application', async ({ app, I }) => {
  await app.goto('/');
  await I.find('Welcome').visible();
});
` })
]);

export async function initializeProject(root) {
  let files = scaffold.map(file => ({ ...file, absolutePath: resolve(root, file.path) }));
  for (let file of files) {
    try {
      await access(file.absolutePath);
      throw new Error(`Refusing to overwrite ${file.path}.`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let created = [];
  try {
    for (let file of files) {
      await mkdir(dirname(file.absolutePath), { recursive: true });
      await writeFile(file.absolutePath, file.contents, { flag: 'wx' });
      created = [...created, file.absolutePath];
    }
  } catch (error) {
    await Promise.all(created.map(path => unlink(path)));
    throw error;
  }
}
