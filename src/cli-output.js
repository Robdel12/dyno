import { styleText, stripVTControlCharacters } from 'node:util';
import metadata from '../package.json' with { type: 'json' };
import { initialTerminal, terminalStep } from './output/terminal.js';
import { initialLLM, llmStep } from './output/llm.js';

let reporters = {
  terminal: { initial: initialTerminal, step: terminalStep },
  llm: { initial: initialLLM, step: llmStep },
};

// Color only reaches a stream that supports it. NO_COLOR and FORCE_COLOR apply.
let painter = (stream, enabled) => enabled
  ? (format, text) => styleText(format, String(text), { stream })
  : (format, text) => String(text);

function commandLines(event, paint) {
  switch (event.type) {
    case 'help': return [event.text];
    case 'version': return [event.version];
    case 'initialized': return [event.message];
    case 'browsers':
      return event.browsers.map(browser => `${browser.name.padEnd(10)} ${browser.installed ? browser.path : paint('dim', 'not installed')}`);
    case 'diagnosis':
      return event.checks.map(check => {
        let [mark, color] = { passed: ['✓', 'green'], failed: ['✗', 'red'], info: ['−', 'dim'] }[check.status];
        return `${paint(color, mark)} ${check.name}: ${check.message}`;
      });
  }
}

// Only this boundary writes CLI output. Project console output uses stderr.
// `format` is 'terminal' (people), 'llm' (agents), or 'json' (machines).
export function createCLIOutput({ format = 'terminal', stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() }) {
  let json = format === 'json';
  let closed = new Set();
  // Agents read --llm output as text, so color codes and terminal hyperlinks
  // from project output and errors never reach it.
  let plain = format === 'llm' ? stripVTControlCharacters : text => text;
  let write = (stream, text) => { if (!closed.has(stream)) stream.write(plain(text)); };
  let line = (text) => write(stdout, text + '\n');
  let log = (text) => write(stderr, text + '\n');
  let reporter = reporters[format];
  let state = reporter?.initial;
  let paint = painter(stdout, format === 'terminal');
  let paintErr = painter(stderr, format === 'terminal');
  return Object.freeze({
    diagnostic: (text) => write(stderr, text),
    close: (stream) => closed.add(stream),
    // `view` describes the run: { persistent, options, showCoverage }.
    event(event, { persistent = false, options, showCoverage = true } = {}) {
      if (event.type === 'error') {
        if (json) line(JSON.stringify(event));
        log(paintErr('red', `${event.phase ? `${event.phase}: ` : 'dyno: '}${event.message}`));
        return;
      }
      if (json) { line(JSON.stringify(event)); return; }
      let lines = commandLines(event, paint);
      if (lines) { for (let text of lines) line(text); return; }
      let result = reporter.step(state, event, {
        paint, paintErr, cwd, persistent, options, showCoverage, version: metadata.version,
      });
      state = result.state;
      for (let [stream, text] of result.writes) (stream === 'err' ? log : line)(text);
    }
  });
}
