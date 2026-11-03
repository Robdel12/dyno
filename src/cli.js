/**
 * These commands and flags come from the installed CLI’s help. Put command-specific options after its name.
 *
 * @guide cli Commands and flags
 */

/**
 * ```sh
 * dyno                              # headless run
 * dyno --ui                         # visible browser and repeated runs
 * dyno --watch                      # rerun when tests or imported helpers change
 * dyno --manual --host 0.0.0.0      # open the URL yourself or on another device
 * dyno --test 'saves a contact'      # exact test name
 * dyno --config path/to/config.js
 * dyno --json                       # one JSON event per stdout line
 * ```
 *
 * `dyno` runs tests by default; `dyno run` is the explicit form. Use `dyno --help` for commands and `dyno run --help`, `dyno doctor --help`, or `dyno install --help` for their options and examples. Put command-specific options after the command name. Usage errors suggest likely flag corrections and point to the relevant help. JSON errors also include Commander's error code.
 *
 * Exit codes are 0 for passing tests, 1 for failures, 130 for SIGINT, and 143 for SIGTERM. Cleanup failures exit 1 even when interrupted. `--ui` and `--manual` keep the gateway available for reruns; Ctrl-C stops it. Browser installation uses the same interruption and process cleanup.
 *
 * With `--json`, stdout contains one JSON event per line. Project `console` messages from config, setup, and teardown go to stderr, as does app-server output. Project code that writes directly to a stream should use `process.stderr`. Errors remain available as JSON events and stderr diagnostics. Use the process exit code for the final CLI outcome; a failure can emit an error after `session-timing`.
 *
 * Connection diagnostics appear as `browser-connection` and `browser-diagnostic` events, separately from test outcomes. Idle streams send keepalive comments so inspection can stay open.
 *
 * Open the start URL at `/__dyno__/`. Dyno opens a companion window for test execution, then loads the app in the original window. If the popup is blocked, click **Start tests**. Keep both windows open: tests stay in the companion while the app navigates normally.
 *
 * Press **Ctrl+Shift+D** in the app to request inspection. Dyno finishes the current test before opening the reporter iframe over the app. The app keeps its full viewport underneath.
 *
 * The overview groups files and suites, with search and status filters saved in its URL. Run one test, a suite, a file, or failed tests. Stable test links still point to the same test after definitions are reordered. Connection and command states stay visible; failed commands offer Try again. Open a test's Output route for failures, source excerpts, console messages, and screenshots. Its Application route lets you return to the actual app and choose a viewport. Reporter navigation never moves or scales the app.
 *
 * **Run options** includes Pause on failure. Continue closes the overlay before starting the next test. A completed interactive run keeps each worker's last app available; rerun an earlier test to inspect it again. Stop cancels execution and begins cleanup. Managed runs retire their documents before draining project work, so use Pause when you want to inspect the current app. Pausing doesn't freeze the app's timers or requests. Closing or reloading the companion interrupts execution; start a fresh run rather than trying to resume it.
 *
 * The CLI also prints a separate reporter URL. Open it in another tab to observe and control the run without covering the app. Reruns rebuild tests; separate reporters follow the new run. Back/forward navigation only changes reporter routes.
 *
 * Console capture keeps the first 100 messages per test, up to 2,000 characters each, without evaluating object getters. It supports `log`, `info`, `warn`, `error`, and `debug`. Logging an error doesn't fail the test. Capture ends with the test; use the browser console for later inspection.
 *
 * @guide running Run and inspect
 */

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
function workers(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 32)
    throw new InvalidArgumentError('must be a whole number between 1 and 32');
  return Number(value);
}
function appOptions(command) {
  return command
    .addOption(valueOption('-c, --config <path>', 'Configuration file (dyno.config.js)'))
    .addOption(new Option('--browser <name>', 'Browser for the test run').choices(browserNames))
    .addOption(valueOption('--browser-path <path>', 'Path to a compatible browser executable'))
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
    .addOption(new Option('--workers <number>', 'Isolated browser workers (1); concurrent runs require project worker setup').argParser(workers))
    .addOption(valueOption('--replay <path>', 'Replay recorded worker queues from schedule.json').conflicts(['seed', 'random', 'test', 'id', 'file', 'suite', 'watch']))
    .addOption(valueOption('--seed <value>', 'Run in a repeatable randomized order'))
    .addOption(new Option('--random', 'Generate and print a seed for this run').conflicts('seed'))
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
    workers: options.workers, port: options.port, host: options.host, browser: options.browser,
    browserPath: options.browserPath, reportDir: options.reportDir, seed: options.seed, random: options.random
  };
}
