import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';

let browserEntry = fileURLToPath(new URL('./browser/index.js', import.meta.url));
let registry = fileURLToPath(new URL('./browser/registry.js', import.meta.url));
let runtime = fileURLToPath(new URL('./browser/runtime.js', import.meta.url));

export async function buildSuite(config) {
  let files = [];
  for await (let file of glob(config.testMatch, { cwd: config.testDir })) files.push(join(config.testDir, file));
  files.sort();
  if (!files.length) throw new Error(`No browser tests found in ${config.testDir} matching ${config.testMatch}.`);
  // Sequential imports keep file-local registration correct, including top-level await.
  let source = `import { registerFile } from ${JSON.stringify(registry)};\n`;
  source += files
    .map(
      (file) =>
        `await registerFile(${JSON.stringify(relative(config.root, file).split('\\').join('/'))}, () => import(${JSON.stringify(file)}));`
    )
    .join('\n');
  source += `\nimport { boot } from ${JSON.stringify(runtime)};\nboot();\n`;
  let [result, bridge] = await Promise.all([
    build({
      stdin: { contents: source, resolveDir: config.root, sourcefile: 'dyno-entry.js' },
      metafile: true,
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      absWorkingDir: config.root,
      sourcemap: 'external',
      outfile: join(config.root, 'suite.js'),
      logLevel: 'silent',
      alias: { dyno: browserEntry }
    }),
    build({
      entryPoints: [fileURLToPath(new URL('./browser/bridge.js', import.meta.url))],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      logLevel: 'silent'
    })
  ]);
  return {
    inputs: Object.keys(result.metafile.inputs)
      .filter((file) => file !== 'dyno-entry.js')
      .map((file) => resolve(config.root, file)),
    bridge: bridge.outputFiles[0].text,
    code: result.outputFiles.find((file) => file.path.endsWith('suite.js')).text,
    map: JSON.parse(result.outputFiles.find((file) => file.path.endsWith('.map')).text),
    files: files.map((file) => relative(config.root, file))
  };
}
