#!/usr/bin/env node
import { Console } from 'node:console';
import { runCLI } from '../src/commands.js';
import { createCLIOutput } from '../src/cli-output.js';

let args = process.argv.slice(2);
let output = createCLIOutput({ json: args.includes('--json') });
let controller = new AbortController();
let interruption;
let stop = (name, code) => {
  interruption ??= { name, code };
  if (process.exitCode !== 1) process.exitCode = interruption.code;
  controller.abort(new Error(`Stopped by ${name}`));
};
let interrupt = () => stop('SIGINT', 130);
let terminate = () => stop('SIGTERM', 143);
let streamError = (stream) => (error) => {
  output.close(stream);
  if (error.code === 'EPIPE') stop('SIGTERM', 143);
  else controller.abort(error);
};
let stdoutError = streamError(process.stdout);
let stderrError = streamError(process.stderr);
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
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
  // Stream writes can finish after command cleanup. Keep their error handlers
  // through process exit so a late broken pipe cannot become uncaught.
}
