import { mkdir, writeFile, appendFile, rename, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReport } from './report-model.js';
import { createReportWriter } from './reports.js';
import { escapeMarkup } from './report-format.js';

export let repeatEvidenceLimit = 256 * 1024 * 1024;

async function replaceFile(path, contents) {
  let temporary = path + '.' + randomUUID();
  try { await writeFile(temporary, contents); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function overview(batch) {
  let x = escapeMarkup;
  let rows = batch.tests.map(test => `<tr><td>${x([...test.suites, test.name].join(' › '))}</td><td>${test.passed}</td><td>${test.failed}</td><td>${test.skipped}</td><td>${test.notRun}</td></tr>`).join('');
  let failure = batch.firstFailure;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dyno repeated runs</title>
<style>body{font:16px/1.6 system-ui;max-width:72rem;margin:3rem auto;padding:0 1rem;background:#171719;color:#eee}a{color:#ffad73}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.6rem;border-bottom:1px solid #444}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style>
<h1>Repeated runs: ${x(batch.status)}</h1><p>${batch.completed}/${batch.requested} rounds completed · ${batch.failedRounds} with failures</p>
<p>Browser storage and project worker resources were reused. Seeds reproduce priority; schedules reproduce worker queues, not asynchronous timing. The source fingerprint covers the test bundle, not the running app or backend.</p>
${batch.reason ? `<p>Stopped: ${x(batch.reason)}</p>` : ''}
<p>Root seed: <code>${x(batch.seed ?? 'declared order')}</code></p>
<h2>Observed executions</h2><table><thead><tr><th scope="col">Test</th><th scope="col">Passed</th><th scope="col">Failed</th><th scope="col">Skipped</th><th scope="col">Not run</th></tr></thead><tbody>${rows}</tbody></table>
${failure ? `<h2>First failure: round ${failure.round}</h2><p>${x(failure.error?.message)}</p><p>Run: <code>${x(failure.runId)}</code>. Previous tests on this worker:</p><pre>${x((failure.predecessors ?? []).join('\n') || 'None recorded')}</pre><p>Rerun the original selection through this round to exercise state accumulated across earlier rounds.</p>` : ''}
${batch.firstFailureReplay ? `<p><a href="runs/${x(failure.runId)}/index.html">Open the failed run</a></p><pre>${x(batch.firstFailureReplay)}</pre>` : ''}
${batch.prefixCommand ? `<p>Rerun through the first failure:</p><pre>${x(batch.prefixCommand)}</pre>` : ''}
${batch.status === 'passed' ? `<p><a href="runs/${x(batch.lastRunId)}/index.html">Open the final run</a></p>` : ''}
${batch.evidenceUnavailable ? `<p>${x(batch.evidenceUnavailable)}</p>` : ''}
<h2>Reproduce the batch</h2><pre>${x(batch.command)}</pre><p>Run this from the original project directory with the same app, backend data and environment.</p>
<p><a href="rounds.jsonl">Round outcomes and schedules</a> · <a href="batch.json">Batch metadata</a> · <a href="junit.xml">JUnit results</a></p></html>\n`;
}

let cases = entry => entry.tests.map(test => {
  let x = escapeMarkup;
  let result = test.status === 'failed'
    ? `<failure message="${x(test.error?.message)}">${x(test.error?.stack ?? test.error?.message)}</failure>`
    : ['skipped', 'not-run'].includes(test.status) ? '<skipped/>' : '';
  return `<testcase name="${x(test.name)} (round ${entry.round})" classname="${x([test.file, ...test.suites].join(' › '))}">${result}</testcase>\n`;
}).join('');

export async function createRepeatWriter(directory, { redact = value => value, limit = repeatEvidenceLimit } = {}) {
  await mkdir(directory, { recursive: true });
  let ledger = join(directory, 'rounds.jsonl');
  await writeFile(ledger, '');
  let writer = createReportWriter(join(directory, 'runs'), { redact });
  let used = 0;
  let limited = false;
  let firstFailureReplay;
  return Object.freeze({
    async save(batch, run) {
      let report = createReport(run);
      let entry = { round: batch.rounds, runId: run.runId, seed: run.seed, status: report.status,
        summary: report.summary,
        tests: report.tests.map(({ id, name, file, suites, status, error, workerId }) =>
          ({ id, name, file, suites, status, ...(error ? { error } : {}), workerId })) };
      let retain = report.status === 'interrupted' || report.summary.failed > 0 || batch.rounds === batch.requested;
      if (retain) entry.report = `runs/${run.runId}/index.html`;
      entry.schedule = `schedules/${run.runId}.json`;
      entry.replay = `dyno --replay '${join(directory, entry.schedule).replaceAll("'", "'\\''")}'`;
      let schedule = redact(JSON.stringify(report.schedule) + '\n');
      let line = redact(JSON.stringify(entry) + '\n');
      let lineBytes = Buffer.byteLength(line) + Buffer.byteLength(schedule);
      let saved;
      if (used + lineBytes > limit) limited = true;
      if (retain && !limited) {
        try {
          // Batch session timing lives once at the batch root. Per-run HTML
          // and images keep the ordinary portable report format.
          saved = await writer.save(run, undefined, { maxBytes: limit - used - lineBytes });
          used += saved.bytes;
        } catch (error) {
          if (error.code !== 'DYNO_EVIDENCE_LIMIT') throw error;
          limited = true;
        }
      }
      if (limited) {
        // Always preserve accepted counts in batch.json, even when a report
        // cannot fit. Never claim the missing evidence was saved.
        delete entry.schedule;
        delete entry.report;
        delete entry.replay;
        entry = { ...entry, tests: entry.tests.map(({ error, ...test }) => ({ ...test,
          ...(error ? { error: { message: error.message, phase: error.phase } } : {}) })),
          evidenceUnavailable: 'The batch evidence limit was reached.' };
      }
      line = redact(JSON.stringify(entry) + '\n');
      if (!limited) {
        await mkdir(join(directory, 'schedules'), { recursive: true });
        await writeFile(join(directory, entry.schedule), schedule);
        used += Buffer.byteLength(line) + Buffer.byteLength(schedule);
        if (saved && batch.firstFailure?.runId === run.runId) firstFailureReplay = entry.replay;
      }
      // One final compact outcome record is stop metadata, outside the budget,
      // so accepted failures still have matching JUnit cases at the limit.
      await appendFile(ledger, line);
      await replaceFile(join(directory, 'batch.json'), redact(JSON.stringify({ ...batch, evidenceBytes: used,
        evidenceLimit: limit, ...(limited ? { evidenceUnavailable: entry.evidenceUnavailable } : {}) }, null, 2) + '\n'));
      return { saved, limited, evidenceBytes: used };
    },
    async finish(batch, session, { prefixCommand } = {}) {
      let metadata = { ...batch, evidenceBytes: used, evidenceLimit: limit,
        ...(prefixCommand ? { prefixCommand } : {}), ...(firstFailureReplay ? { firstFailureReplay } : {}),
        ...(limited ? { evidenceUnavailable: 'The batch evidence limit was reached.' } : {}) };
      await replaceFile(join(directory, 'batch.json'), redact(JSON.stringify(metadata, null, 2) + '\n'));
      await replaceFile(join(directory, 'session.json'), redact(JSON.stringify(session, null, 2) + '\n'));
      await replaceFile(join(directory, 'index.html'), redact(overview(metadata)));
      let temporary = join(directory, '.junit-' + randomUUID());
      let input;
      let destination;
      try {
        input = await open(ledger);
        destination = await open(temporary, 'w');
        let total = { tests: 0, failures: 0, skipped: 0 };
        for await (let line of input.readLines()) {
          for (let test of JSON.parse(line).tests) {
            total.tests++;
            if (test.status === 'failed') total.failures++;
            if (['skipped', 'not-run'].includes(test.status)) total.skipped++;
          }
        }
        await input.close();
        input = await open(ledger);
        let errors = Number(batch.status === 'interrupted');
        let counts = `tests="${total.tests + errors}" failures="${total.failures}" skipped="${total.skipped}" errors="${errors}"`;
        await destination.write(`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites ${counts}><testsuite name="Dyno repeated runs" ${counts}>\n`);
        for await (let line of input.readLines()) await destination.write(cases(JSON.parse(line)));
        if (batch.status === 'interrupted') await destination.write(`<testcase name="Batch interrupted" classname="Dyno"><error message="${escapeMarkup(batch.reason)}"/></testcase>\n`);
        await destination.write('</testsuite></testsuites>\n');
        await destination.close(); destination = undefined;
        await rename(temporary, join(directory, 'junit.xml'));
      } finally {
        await input?.close(); await destination?.close();
        await rm(temporary, { force: true });
      }
      return { directory, json: join(directory, 'batch.json'), html: join(directory, 'index.html'),
        ledger, junit: join(directory, 'junit.xml'), ...(firstFailureReplay ? { firstFailureReplay } : {}) };
    }
  });
}
