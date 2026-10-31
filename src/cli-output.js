import { testTitle } from './suite.js';
import { timingDuration, slowWorkLabel } from './browser/timing-format.js';

// Only this boundary writes CLI output. Project console output uses stderr.
export function createCLIOutput({ json, stdout = process.stdout, stderr = process.stderr }) {
  let closed = new Set();
  let write = (stream, text) => { if (!closed.has(stream)) stream.write(text); };
  let line = (text) => write(stdout, text + '\n');
  let log = (text) => write(stderr, text + '\n');
  return Object.freeze({
    json, line, log,
    diagnostic: (text) => write(stderr, text),
    close: (stream) => closed.add(stream),
    event(event, { persistent = false, savedRuns = 0 } = {}) {
      if (event.type === 'error') {
        if (json) line(JSON.stringify(event));
        log(`${event.phase ? `${event.phase}: ` : 'dyno: '}${event.message}`);
        return;
      }
      if (json) { line(JSON.stringify(event)); return; }
      switch (event.type) {
        case 'help': line(event.text); break;
        case 'version': line(event.version); break;
        case 'initialized': line(event.message); break;
        case 'browsers':
          for (let browser of event.browsers)
            line(`${browser.name.padEnd(10)} ${browser.installed ? browser.path : 'not installed'}`);
          break;
        case 'diagnosis':
          for (let check of event.checks) {
            let mark = { passed: '✓', failed: '✗', info: '−' }[check.status];
            line(`${mark} ${check.name}: ${check.message}`);
          }
          break;
        case 'ready': line(`\nDyno: ${event.url}\nApp: ${event.appURL}\n${event.files.length} test file(s) bundled`); break;
        case 'capture': if (persistent) line(`Reporter: ${event.reporterURL}`); break;
        case 'start':
          line(`\nRunning ${event.tests.length} browser tests`);
          if (event.seed !== null && event.seed !== undefined) line(`Seed: ${event.seed}`);
          break;
        case 'test': {
          let mark = { passed: '✓', skipped: '−', failed: '✗' }[event.status];
          line(`${mark} ${testTitle(event)}${event.duration === undefined ? '' : ` (${Math.round(event.duration)} ms)`}`);
          for (let error of [event.error, ...(event.additionalErrors ?? [])].filter(Boolean))
            log(`[${error.phase ?? 'test'}] ${error.stack ?? error.message}`);
          break;
        }
        case 'attachment':
          line(event.attachment.status === 'captured'
            ? `Screenshot: ${event.attachment.path}`
            : `Image skipped: ${event.attachment.name} (${event.attachment.reason})`);
          break;
        case 'complete':
          line(`\n${event.passed} passed, ${event.failed} failed, ${event.skipped} skipped (${Math.round(event.duration)} ms)`);
          for (let test of event.performance?.slowestTests.slice(0, 3) ?? []) {
            let work = slowWorkLabel({ entries: test.slowestWork });
            line(`Slow: ${testTitle(test)} · ${timingDuration(test.duration)}${work ? ` · ${work}` : ''}`);
          }
          break;
        case 'fatal': log(`Browser run failed: ${event.error?.message ?? 'Unknown error'}`); break;
        case 'watch': log(`Watch: ${event.message ?? event.status}`); break;
        case 'report-saved': line(`Report: ${event.html}`); break;
        case 'browser-stopped':
          if (!event.graceful) log('Browser required forced cleanup. See session.json for timings.');
          break;
        case 'session-timing':
          line(`Session: ${timingDuration(event.timings.duration)} through cleanup.${savedRuns ? ' Details: session.json beside the saved report.' : ''}`);
          break;
      }
    }
  });
}
