import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, glob, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrumentFrameworkSource } from './coverage/instrument.js';
import { frameworkCoverageReport, frameworkCoverageTarget } from './coverage/report.js';

let root = fileURLToPath(new URL('../', import.meta.url));
let args = process.argv.slice(2);
let check = false;
let suite = 'all';
while (args.length) {
  let option = args.shift();
  if (option === '--check') check = true;
  else if (option === '--suite') suite = args.shift();
  else throw new Error(`Unknown framework coverage option: ${option}`);
}
let allowed = ['all', 'core', 'browser', 'execution', 'repeat', 'project', 'reporter', 'package', 'capture', 'native'];
if (!allowed.includes(suite) || (check && suite !== 'all'))
  throw new Error('Usage: node scripts/coverage.js [--check] [--suite all|core|browser|execution|repeat|project|reporter|package|capture|native]. --check requires all suites.');
let directory = join(root, '.dyno/coverage');
let stage = join(directory, 'source');
await rm(directory, { recursive: true, force: true });
await mkdir(join(directory, 'raw'), { recursive: true });
await mkdir(stage);
for (let path of ['AGENTS.md', 'vision.md', 'README.md', 'package.json', 'package-lock.json', 'src', 'bin', 'types', 'vendor', 'tests', 'scripts', 'docs', 'examples'])
  await cp(join(root, path), join(stage, path), { recursive: true, filter: path => !path.includes('/.dyno/') && !path.includes('/node_modules/') });
await symlink(join(root, 'node_modules'), join(stage, 'node_modules'));
let baseline = {};
let sources = {};
for await (let path of glob(['bin/**/*.js', 'src/**/*.js'], { cwd: root })) {
  let filename = join(root, path);
  let source = await readFile(filename, 'utf8');
  sources[filename] = source;
  let { code, map, coverage } = instrumentFrameworkSource(source, filename);
  map.sourcesContent = [source];
  baseline[filename] = coverage;
  await writeFile(join(stage, path), code + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(map)).toString('base64') + '\n');
}
let baselinePath = join(directory, 'baseline.json');
await writeFile(baselinePath, JSON.stringify(baseline));
await writeFile(join(directory, 'sources.json'), JSON.stringify(sources));
console.log(`Measuring ${Object.keys(baseline).length} framework modules with real ${suite} tests in Chromium.`);
let bootstrap = join(stage, 'scripts/coverage/bootstrap.js');
let child = spawn(process.execPath, ['scripts/test.js', suite], {
  cwd: stage,
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${JSON.stringify(bootstrap)}`,
    DYNO_SELF_COVERAGE_DIR: join(directory, 'raw'), DYNO_SELF_COVERAGE_BASELINE: baselinePath },
  stdio: 'inherit',
});
let [code, signal] = await once(child, 'exit');
let result = { ...await frameworkCoverageReport({ directory, baseline, sources, root, scope: suite === 'all' ? 'all-suites' : `subset:${suite}` }),
  testExitCode: code ?? 1, testSignal: signal ?? null };
result.target = frameworkCoverageTarget(result);
await writeFile(join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
console.table(Object.fromEntries(Object.entries(result.summaries).map(([name, summary]) => [name,
  Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map(metric => [metric, summary[metric].pct]))])));
console.log(`Framework coverage: ${join(directory, 'report/index.html')}`);
for (let error of result.errors) console.error(`Coverage collection: ${error}`);
let failed = check && !result.target.met;
if (failed) console.error('Framework coverage requires a passing full suite, complete collection, and 90% in every metric.');
process.exitCode = (code ?? 1) || (result.errors.length || failed ? 1 : 0);
