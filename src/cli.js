/**
 * @guide cli Commands and flags
 * Run `dyno` for headless tests, `dyno --ui` to inspect the app, or `dyno --manual` to open the test URL yourself. Add `--watch` to rerun edits.
 *
 * The help below comes from the CLI itself. Use `dyno <command> --help` in your terminal to see the same options.
 */

/**
 * @guide running Run and inspect
 * Run the whole suite headlessly, or keep the browser open while you work:
 *
 * ```sh
 * dyno                    # run and exit
 * dyno --ui               # inspect the app and results
 * dyno --ui --watch        # rerun when tests or helpers change
 * ```
 *
 * Dyno starts the app and stops the processes it owns when you finish. `--ui` keeps the session open for reruns; press Ctrl-C to stop it.
 *
 * ## Open the reporter
 *
 * Press **Ctrl+Shift+D** in the app. Dyno finishes the current test, then opens the reporter over it. The app keeps its full viewport underneath.
 *
 * Start with the file/suite overview, then open a test's **Output**, **Timings** or **Application** view. You can rerun a test, suite, file or failed selection. Search and filters stay in the URL.
 *
 * Turn on **Pause on failure** in Run options to inspect a failing app. Continue hides the reporter before the next test. Stop cancels the run and starts cleanup. Pausing leaves app timers and requests running.
 *
 * The CLI also prints a separate reporter URL. Open it in another tab if you'd rather keep the app uncovered. A completed interactive run keeps each worker's last app available; rerun an earlier test to inspect it again.
 *
 * ## Repeat while developing
 *
 * Exercise a workflow repeatedly, or vary the order of a whole selection:
 *
 * ```sh
 * dyno --test 'checkout' --repeat 100
 * dyno --suite Checkout --repeat 100 --random
 * dyno --suite Checkout --repeat 100 --seed checkout-race
 * dyno --repeat 100 --replay .dyno/reports/<run-id>/schedule.json
 * ```
 *
 * `--repeat N` runs the complete selection N times, including the first run. It supports managed headless runs; combining it with `--ui`, `--manual`, or `--watch` fails before startup. Tests keep their normal hooks and per-execution fixture preparation. Setup runs once, and browser storage, servers, and project worker resources survive between rounds. Keep scenario reset and backend cleanup in your project.
 *
 * Each automatic execution removes its test runtime and parks the app before project draining, including the final test. A round must finish cleanup and save its results before the next starts. Each round gets its own `runTimeout`. A failed test stays in the batch result while later rounds continue; cleanup, browser, preparation, persistence, or deadline failures stop repetition. Ctrl-C saves accepted partial results and stops further rounds.
 *
 * Without a seed, rounds use declared priority. With `--seed`, round one uses that literal seed and later rounds derive repeatable seeds from it. `--random` generates and prints a root seed; pass it to `--seed` to reproduce the series. The count does not affect seed derivation, so rerunning through the first failing round preserves the prefix. Repeated `--replay` keeps the recorded worker queues fixed.
 *
 * The summary prints commands to replay the first failing round and rerun the original selection through it. A focused rerun can remove the predecessor that caused a failure. A round-only replay also omits state accumulated in earlier rounds. Seeds reproduce priority, and schedules reproduce queues; neither controls app randomness, backend data, or asynchronous timing. Keep app code and data stable while collecting results. Dyno pins the test bundle, not the running application.
 *
 * See [saved reports](guide.md#saved-reports) for batch counts, schedules, images, and evidence limits. Passing many times is evidence under those conditions; it does not prove a test can never fail.
 *
 * ## Bring your own browser
 *
 * ```sh
 * dyno --manual --host 0.0.0.0
 * ```
 *
 * Open the printed URL and click **Start tests** if the popup was blocked. Keep both the app and companion windows open. Closing or reloading the companion interrupts the run; start a new one afterward.
 *
 * See [browser setup](browsers.md) for manual-mode limits. Use [editing and debugging](guide.md#editing-and-debugging) for watch mode and in-test pauses, or `dyno --help` for selection and other options.
 *
 * ## Use the output in CI
 *
 * `dyno --json` writes one JSON event per stdout line. Config, setup, teardown and app logs go to stderr. Use the process exit code as the outcome: `0` passes, `1` fails, `130` means SIGINT, and `143` means SIGTERM. Cleanup failure exits `1`, including after interruption.
 *
 * [Saved reports](guide.md#saved-reports) give you portable HTML, JSON, JUnit and images after the session stops.
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
function repeat(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new InvalidArgumentError('must be a positive safe integer');
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
    .addOption(new Option('--repeat <number>', 'Repeat the complete selection; seeded rounds vary reproducibly (headless only)')
      .argParser(repeat).conflicts(['ui', 'manual', 'watch']))
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
