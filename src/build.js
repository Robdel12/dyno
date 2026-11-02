import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

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
      metafile: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      absWorkingDir: config.root,
      sourcemap: 'external',
      outfile: join(config.root, 'bridge.js'),
      logLevel: 'silent'
    })
  ]);
  let map = JSON.parse(result.outputFiles.find(file => file.path.endsWith('.map')).text);
  let bridgeMap = JSON.parse(bridge.outputFiles.find(file => file.path.endsWith('.map')).text);
  let contents = [map, bridgeMap].flatMap(map => map.sourcesContent.filter((content, index) => map.sources[index] !== 'dyno-entry.js'));
  let hashes = contents.map(content => createHash('sha256').update(content).digest('hex')).sort();
  let fingerprint = Object.freeze({ algorithm: 'sha256-source-content-v1', hash: createHash('sha256').update(JSON.stringify(hashes)).digest('hex') });
  return {
    fingerprint,
    inputs: Object.keys(result.metafile.inputs)
      .filter((file) => file !== 'dyno-entry.js')
      .map((file) => resolve(config.root, file)),
    bridge: bridge.outputFiles.find(file => file.path.endsWith('.js')).text,
    code: result.outputFiles.find((file) => file.path.endsWith('suite.js')).text,
    map,
    files: files.map((file) => relative(config.root, file))
  };
}
