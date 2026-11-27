#!/usr/bin/env node
import { Console } from 'node:console';
import { runCLI } from '../src/commands.js';
import { createCLIOutput } from '../src/cli-output.js';

let args = process.argv.slice(2);
let format = args.includes('--json') ? 'json' : args.includes('--llm') ? 'llm' : 'terminal';
let output = createCLIOutput({ format });
let controller = new AbortController();
let interruption;
let stop = (name, code) => {
  interruption ??= { name, code, at: performance.now() };
  if (process.exitCode !== 1) process.exitCode = interruption.code;
  controller.abort(new Error(`Stopped by ${name}`));
};
// npm run and npx forward Ctrl+C to Dyno, which also gets it from the terminal, so one press can
// arrive twice. A signal a second or more after the first means quit now, and the next run cleans
// up whatever this one left behind.
let signalled = (name, code) => () => {
  if (interruption && performance.now() - interruption.at >= 1000) {
    output.event({ type: 'stopped', signal: name });
    process.exit(interruption.code);
  }
  if (!interruption && name === 'SIGINT' && format !== 'json')
    process.stderr.write('\nStopping. Dyno is cleaning up; press Ctrl+C again to quit without waiting.\n');
  stop(name, code);
};
let interrupt = signalled('SIGINT', 130);
let terminate = signalled('SIGTERM', 143);
// Closing the terminal sends SIGHUP. Without a handler Node exits at once and
// skips cleanup, which strands project resources such as test databases.
let hangup = signalled('SIGHUP', 129);
let streamError = (stream) => (error) => {
  output.close(stream);
  if (error.code === 'EPIPE') stop('SIGTERM', 143);
  else controller.abort(error);
};
let stdoutError = streamError(process.stdout);
let stderrError = streamError(process.stderr);
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
process.on('SIGHUP', hangup);
process.stdout.on('error', stdoutError);
process.stderr.on('error', stderrError);
// Project config, setup, and teardown console messages are diagnostics too.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
try {
  let exitCode = await runCLI(args, { signal: controller.signal, output });
  process.exitCode = exitCode || interruption?.code || (controller.signal.aborted ? 1 : 0);
} catch (error) {
  if (!interruption) output.event({ type: 'error', message: error.message, ...(error.code ? { code: error.code } : {}) });
  process.exitCode = interruption?.code ?? 1;
} finally {
  if (interruption) output.event({ type: 'stopped', signal: interruption.name });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  process.removeListener('SIGHUP', hangup);
  // Stream writes can finish after command cleanup. Keep their error handlers
  // through process exit so a late broken pipe cannot become uncaught.
}
