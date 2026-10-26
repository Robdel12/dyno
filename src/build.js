import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { build } from 'esbuild';

let browserEntry = fileURLToPath(new URL('./browser/index.js', import.meta.url));
let runtime = fileURLToPath(new URL('./browser/runtime.js', import.meta.url));

export async function buildSuite(config) {
  let files = [];
  for await (let file of glob(config.testMatch, { cwd: config.testDir })) files.push(join(config.testDir, file));
  files.sort();
  if (!files.length) throw new Error(`No browser tests found in ${config.testDir} matching ${config.testMatch}.`);
  let source = files.map(file => `import ${JSON.stringify(file)};`).join('\n');
  source += `\nimport { boot } from ${JSON.stringify(runtime)};\nboot();\n`;
  let result = await build({
    stdin: { contents: source, resolveDir: config.root, sourcefile: 'dyno-entry.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    absWorkingDir: config.root, sourcemap: 'external', outfile: join(config.root, 'suite.js'), logLevel: 'silent',
    alias: { 'dyno': browserEntry }
  });
  return { code: result.outputFiles.find(file => file.path.endsWith('suite.js')).text, map: JSON.parse(result.outputFiles.find(file => file.path.endsWith('.map')).text), files: files.map(file => relative(config.root, file)) };
}
