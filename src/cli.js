import { parseArgs } from 'node:util';
import { browserNames } from './browsers.js';

export let usage = `dyno [run] [options]
dyno init
dyno doctor [--config path] [--manual]
dyno browsers
dyno install --browser chromium|firefox|webkit

  --config, -c path   Configuration file (dyno.config.js)
  --browser name     chrome, chromium, edge, firefox, safari, or webkit
  --provider name    native (URL only), playwright, or webdriver
  --browser-path     Explicit browser executable (Safari: .app directory)
  --ui               Open a visible browser and keep the runner available
  --watch            Rerun after test or imported helper changes
  --manual           Print a URL for your own browser; Ctrl-C to stop
  --test name        Exact test name or suite-qualified title
  --id value         Stable test ID (repeatable)
  --file path        Test file or filename (repeatable)
  --suite name       Suite path, including descendants (repeatable)
  --host address     Gateway bind address (127.0.0.1)
  --port number      Gateway port (7357; 0 chooses an available port)
  --report-dir path  Saved JSON, JUnit, and HTML reports (.dyno/reports)
  --json             Newline-delimited JSON on stdout; logs go to stderr
  --version, -v      Print the installed version
  --help, -h         Show this help

Tests, actions, and assertions execute in the browser. Safari requires --ui.
`;

export function parseCLI(args) {
  let { values, positionals } = parseArgs({
    args,
    options: {
      config: { type: 'string', short: 'c' },
      browser: { type: 'string' },
      'browser-path': { type: 'string' },
      provider: { type: 'string' },
      'report-dir': { type: 'string' },
      watch: { type: 'boolean' },
      ui: { type: 'boolean' },
      manual: { type: 'boolean' },
      port: { type: 'string' },
      host: { type: 'string' },
      test: { type: 'string' },
      id: { type: 'string', multiple: true },
      file: { type: 'string', multiple: true },
      suite: { type: 'string', multiple: true },
      json: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });
  let command = positionals[0] ?? 'run';
  if (positionals.length > 1 || !['run', 'init', 'browsers', 'install', 'doctor'].includes(command))
    throw new Error(`Unknown command: ${positionals.join(' ')}. Run dyno --help.`);
  if (values.ui && values.manual) throw new Error('Choose --ui or --manual.');
  for (let name of ['config', 'browser-path', 'host', 'test', 'report-dir'])
    if (values[name] !== undefined && !values[name].trim()) throw new Error(`--${name} requires a non-empty value.`);
  for (let key of ['id', 'file', 'suite'])
    if (values[key]?.some((value) => !value.trim())) throw new Error(`--${key} requires a non-empty value.`);
  if (values.port !== undefined && (!/^\d+$/.test(values.port) || Number(values.port) > 65535))
    throw new Error('--port must be between 0 and 65535.');
  if (values.browser && !browserNames.includes(values.browser))
    throw new Error(`Unknown browser "${values.browser}". Choose ${browserNames.join(', ')}.`);
  if (values.provider && !['native', 'playwright', 'webdriver'].includes(values.provider))
    throw new Error('--provider must be native, playwright, or webdriver.');
  if (command !== 'run') {
    let invalid = Object.keys(values).find(
      (key) =>
        !(
          command === 'doctor'
            ? ['json', 'help', 'version', 'config', 'manual', 'browser', 'browser-path', 'provider']
            : command === 'install'
              ? ['json', 'help', 'version', 'browser', 'provider']
              : ['json', 'help', 'version']
        ).includes(key)
    );
    if (invalid) throw new Error(`--${invalid} is only available for dyno run.`);
  }
  if (values.manual && (values.browser || values['browser-path'] || values.provider))
    throw new Error('--manual does not launch a browser. Remove --browser, --browser-path, and --provider.');
  return Object.freeze({ ...values, command });
}
