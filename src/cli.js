import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import metadata from '../package.json' with { type: 'json' };
import { browserNames } from './browsers.js';

function nonEmpty(value) {
  if (!value.trim()) throw new InvalidArgumentError('must be a non-empty value');
  return value;
}
let valueOption = (flags, description) => new Option(flags, description).argParser(nonEmpty);
let collect = (value, previous = []) => [...previous, nonEmpty(value)];
function port(value) {
  if (!/^\d+$/.test(value) || Number(value) > 65535)
    throw new InvalidArgumentError('must be a whole number between 0 and 65535; use 0 to choose an available port');
  return Number(value);
}
function appOptions(command) {
  return command
    .addOption(valueOption('-c, --config <path>', 'Configuration file (dyno.config.js)'))
    .addOption(new Option('--browser <name>', 'Browser for the test run').choices(browserNames))
    .addOption(valueOption('--browser-path <path>', 'Explicit browser executable; Passed to Playwright as executablePath'))
    .option('--ui', 'Visible-browser mode')
    .addOption(new Option('--manual', 'URL-only mode without a browser launcher').conflicts(['ui', 'browser', 'browserPath']));
}

// Commander owns parsing/help. Only immutable options leave this boundary.
export function parseCLI(args) {
  let text = '';
  let diagnostic = '';
  let result;
  let program = new Command('dyno')
    .description('Run acceptance tests in the browser, from a URL.')
    .version(metadata.version, '-v, --version', 'Print the installed version')
    .option('--json', 'Write JSON events to stdout and diagnostics to stderr')
    .exitOverride()
    .configureOutput({ writeOut: value => { text += value; }, writeErr: value => { diagnostic += value; } })
    .configureHelp({ showGlobalOptions: true })
    .showHelpAfterError("\nRun 'dyno --help' for usage.")
    .addHelpText('after', `
Examples:
  dyno                         Run tests headlessly
  dyno --ui --watch            Inspect the app and rerun edits
  dyno doctor                  Check configuration and browser setup
  dyno run --help              See test filters and run options

Tests, actions, and assertions execute in the browser. Use --manual for Safari and other browsers.`);
  let command = (name, description, options) => program.command(name, options)
    .description(description)
    .showHelpAfterError(`\nRun 'dyno ${name} --help' for usage.`)
    .action((values, selected) => {
      result = Object.freeze(Object.fromEntries(Object.entries({ ...selected.optsWithGlobals(), command: selected.name() })
        .map(([key, value]) => [key, Array.isArray(value) ? Object.freeze([...value]) : value])));
    });
  appOptions(command('run', 'Run tests (the default command)', { isDefault: true }))
    .option('--watch', 'Rerun when tests or imported helpers change')
    .addOption(valueOption('--test <name>', 'Exact test name or suite-qualified title'))
    .addOption(new Option('--id <id>', 'Stable test ID; repeat to select several').argParser(collect))
    .addOption(new Option('--file <path>', 'Test file or filename; repeat to select several').argParser(collect))
    .addOption(new Option('--suite <name>', 'Suite and descendants; repeat to select several').argParser(collect))
    .addOption(valueOption('--host <address>', 'Gateway address (127.0.0.1); use 0.0.0.0 for other devices'))
    .addOption(new Option('--port <number>', 'Gateway port (7357); 0 chooses an available port').argParser(port))
    .addOption(valueOption('--report-dir <path>', 'Saved JSON, JUnit, and HTML reports (.dyno/reports)'))
    .addHelpText('after', `
Examples:
  dyno --test 'saves a contact'
  dyno run --suite Authentication --file login.test.js
  dyno --manual --host 0.0.0.0
  dyno --browser webkit

--ui, --manual, and --watch keep the runner open. Press Ctrl-C to stop.`);
  command('init', 'Create a config and example test without overwriting existing files');
  appOptions(command('doctor', 'Check tests, app configuration, and browser prerequisites without launching'))
    .addHelpText('after', '\nUse --ui to check a visible-browser setup, or --manual for URL-only execution.');
  command('browsers', 'List installed Playwright browser builds');
  command('install', 'Download a Playwright browser build')
    .option('--with-deps', 'Also install browser system dependencies through Playwright')
    .addOption(new Option('--browser <name>', 'Engine build to download').choices(['chromium', 'firefox', 'webkit']).default('chromium'))
    .addHelpText('after', '\nPlaywright Core is included. Download Chromium, Firefox, or WebKit once with this command.\nExample: dyno install --browser webkit');
  try {
    program.parse(args, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.exitCode === 0) return Object.freeze(error.code === 'commander.version' ? { version: text.trim() } : { help: text });
    error.message = diagnostic.trim().replace(/^error:\s*/, '');
    throw error;
  }
  return result;
}

export function configOverrides(options) {
  return {
    port: options.port, host: options.host, browser: options.browser,
    browserPath: options.browserPath, reportDir: options.reportDir
  };
}
