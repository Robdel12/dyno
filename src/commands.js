import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parseCLI, configOverrides } from './cli.js';
import { loadConfig } from './config.js';
import { installedBrowsers } from './launcher.js';
import { startProcess } from './process.js';
import { initializeProject } from './init.js';
import { diagnose } from './doctor.js';
import { runTests } from './cli-run.js';

async function installBrowser(options, { signal, output }) {
  let name = options.browser;
  let executable;
  try {
    let packageURL = import.meta.resolve('playwright-core/package.json');
    let provider = JSON.parse(await readFile(new URL(packageURL), 'utf8'));
    executable = fileURLToPath(new URL(provider.bin['playwright-core'], packageURL));
  } catch {
    throw new Error('Install the optional provider first: npm install --save-dev playwright-core');
  }
  signal.throwIfAborted();
  let installation = startProcess(process.execPath, {
    shell: false, signal, args: [executable, 'install', name], output: output.diagnostic
  });
  try {
    await installation.ready;
    let result = await installation.closed;
    signal.throwIfAborted();
    if (result.code !== 0) throw new Error(`Browser installation failed: ${installation.logs}`);
    output.event({ type: 'installed', provider: 'playwright', browser: name });
  } finally {
    await installation.stop();
  }
}

export async function runCLI(args, context) {
  let { signal, output } = context;
  let options = parseCLI(args);
  if (options.help) { output.event({ type: 'help', text: options.help }); return 0; }
  if (options.version) { output.event({ type: 'version', version: options.version }); return 0; }
  signal.throwIfAborted();
  switch (options.command) {
    case 'init':
      await initializeProject(process.cwd());
      output.event({ type: 'initialized', message: 'Created dyno.config.js and tests/browser/home.test.js. Set your app command/URL and update the example assertion, then run dyno.' });
      return 0;
    case 'browsers':
      output.event({ type: 'browsers', browsers: await installedBrowsers() });
      return 0;
    case 'install':
      await installBrowser(options, context);
      return 0;
    case 'doctor': {
      let config = await loadConfig(options.config, configOverrides(options));
      let result = await diagnose(config, { manual: options.manual, ui: options.ui });
      signal.throwIfAborted();
      output.event({ type: 'diagnosis', ...result });
      return result.ok ? 0 : 1;
    }
    case 'run': return runTests(options, context);
  }
}
