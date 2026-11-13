import { testTitle } from './suite.js';
import { timingPhases, timingOperations, timingDuration, timingLabels, failurePlace } from './browser/timing-format.js';
import { slowestTests } from './browser/timings.js';
import { pullCurve, pullSheet, pace, tachometer, testCount, sheetSpan } from './browser/dyno-chart.js';
import { escapeMarkup, wordmark } from './browser/markup.js';

export { escapeMarkup };

let errors = (test) => [test.error, ...test.additionalErrors].filter(Boolean);
let failureText = (error) =>
  `[${error.phase}] ${error.stack ?? error.message}${error.source ? `\n${error.source.file}:${error.source.line}:${error.source.column}\n${error.source.code}` : ''}`;
let consoleText = (test) =>
  test.output
    .map((entry) => `[${Math.round(entry.elapsed)} ms] ${entry.source} ${entry.level}: ${entry.text}`)
    .join('\n');
export function junitReport(report) {
  let x = escapeMarkup;
  let cases = report.tests
    .map(
      (test) =>
        `<testcase name="${x(test.name)}" classname="${x([test.file, ...test.suites].join(' › '))}" time="${test.duration / 1000}">${
          test.status === 'failed'
            ? `<failure message="${x(test.error.message)}" type="${x(test.error.phase)}">${x(errors(test).map(failureText).join('\n\n'))}</failure>`
            : ['skipped', 'not-run'].includes(test.status)
              ? `<skipped message="${x(test.skipReason ?? 'Run ended before this test reported.')}"/>`
              : ''
        }<system-out>${x([consoleText(test), ...test.attachments.map((image) => (image.status === 'captured' ? `Screenshot: ${image.path}` : `${image.status === 'missing' ? 'Screenshot unavailable' : 'Image skipped'}: ${image.name} (${image.reason})`))].filter(Boolean).join('\n'))}</system-out></testcase>`
    )
    .join('\n');
  let interrupted = report.status === 'interrupted';
  if (interrupted)
    cases += `\n<testcase name="Run interrupted" classname="Dyno"><error message="${x(report.error?.message ?? 'The run did not complete.')}">${x(report.error ? failureText(report.error) : 'The run did not complete.')}</error></testcase>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${report.tests.length + Number(interrupted)}" failures="${report.summary.failed}" errors="${Number(interrupted)}" skipped="${report.summary.skipped + report.summary.notRun}" time="${report.summary.duration / 1000}"><testsuite name="Dyno" tests="${report.tests.length + Number(interrupted)}" failures="${report.summary.failed}" errors="${Number(interrupted)}" skipped="${report.summary.skipped + report.summary.notRun}" time="${report.summary.duration / 1000}">${cases}</testsuite></testsuites>\n`;
}

function errorMarkup(error) {
  let x = escapeMarkup;
  let place = failurePlace(error);
  return `<div class="failure">
    <h2>${x(error.message)}</h2>
    ${place ? `<p class="failure-location">${x(place)}</p>` : ''}
    ${error.source ? `<pre class="source-excerpt">${x(error.source.code)}</pre>` : ''}
    ${error.stack ? `<details><summary>Stack trace</summary><pre>${x(error.stack)}</pre></details>` : ''}
  </div>`;
}
function imageMarkup(image) {
  let x = escapeMarkup;
  if (image.status !== 'captured')
    return `<p class="output-notice">${image.status === 'missing' ? 'Screenshot unavailable' : 'Image skipped'}: ${x(image.name)}. ${x(image.reason)}</p>`;
  return `<figure class="screenshot">
    <a href="${x(image.path)}"><img src="${x(image.path)}" alt="${x(image.name)}" loading="lazy"></a>
    <figcaption>${x(image.name)}, ${image.width} × ${image.height} in ${x(image.browser.name)}</figcaption>
  </figure>`;
}
function timingMarkup(timings) {
  if (!timings) return '';
  let x = escapeMarkup;
  return `<details class="saved-timings"><summary>Timings</summary>
    <dl class="timing-phases">${timingPhases(timings).map(entry => `<div><dt>${x(entry.name)}</dt><dd>${x(timingDuration(entry.duration))}</dd></div>`).join('')}</dl>
    <p>Times include waiting. Steps and operations can overlap; do not add these rows together. Debug pauses are included.</p>
    <table class="timings-table"><caption>Hooks, operations, and steps, slowest first</caption><thead><tr><th scope="col">Work</th><th scope="col">Started</th><th scope="col">Duration</th></tr></thead>
    <tbody>${timingOperations(timings).map(entry => `<tr><td><strong>${x(entry.name)}</strong><span class="timing-kind">${x(timingLabels[entry.kind])} in ${x(entry.phase ?? 'test')}, ${x(entry.status)}</span></td><td>${x(timingDuration(entry.start))}</td><td>${x(timingDuration(entry.duration))}</td></tr>`).join('')}</tbody></table>
    ${timings.truncated ? `<p>${timings.truncated} additional timings were not recorded.</p>` : ''}</details>`;
}
function testMarkup(test) {
  let x = escapeMarkup;
  let note =
    test.status === 'skipped'
      ? test.skipReason
      : test.status === 'not-run'
        ? 'Run ended before this test reported.'
        : '';
  return `<details id="test-${test.index}" class="saved-test" data-test data-file="${x(test.file)}" data-status="${x(test.status)}" ${test.status === 'failed' ? 'open' : ''}>
    <summary><span class="saved-status">${x(test.status === 'not-run' ? 'not run' : test.status)}</span><span class="saved-name">${x(testTitle(test))}</span><span class="test-time">${Math.round(test.duration)} ms</span></summary>
    <div class="saved-output">
      ${errors(test).map(errorMarkup).join('')}
      ${note ? `<p>${x(note)}</p>` : ''}
      ${test.workerId !== undefined ? `<p class="output-notice">Worker ${x(test.workerId)}</p>` : ''}
      ${timingMarkup(test.timings)}
      ${test.output.length ? `<h2>Console</h2><pre>${x(consoleText(test))}</pre>` : ''}
      ${test.attachments.map(imageMarkup).join('')}
    </div>
  </details>`;
}
let readout = (label, value, kind = '') =>
  `<div class="readout"${kind ? ` data-kind="${kind}"` : ''}><dt>${label}</dt><dd>${value}</dd></div>`;
export function htmlReport(report, css, { session = false } = {}) {
  let x = escapeMarkup;
  let files = [...new Set(report.tests.map((test) => test.file))];
  let title =
    report.status === 'interrupted' ? 'Run interrupted' : report.summary.failed ? 'Run failed' : 'Run complete';
  let curve = pullCurve(report.tests);
  let average = pace(curve);
  let slow = slowestTests(report.tests);
  let phase = report.status === 'interrupted' ? 'error' : 'completed';
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>Dyno report: ${x(report.status)}</title><style>${css}</style>
  </head><body><main class="saved-report">
    <header class="saved-masthead">
      ${wordmark}<span class="sr-only">Dyno</span>
      <nav class="saved-files" aria-label="Report files"><a href="run.json">Run JSON</a><a href="junit.xml">JUnit</a><a href="schedule.json">Execution order</a>${session ? '<a href="session.json">Session timings</a>' : ''}</nav>
    </header>
    <div class="pull-title">${tachometer({ phase, failed: report.summary.failed > 0, progress: curve.total ? curve.done / curve.total : 0 })}<h1>${title}</h1></div>
    <p class="saved-meta">${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped, ${report.summary.notRun} not run</p>
    <p class="saved-meta">Saved report ${x(report.runId)}${report.startedAt ? `, started ${x(report.startedAt)}` : ''}</p>
    ${report.schedule?.seed != null ? `<p class="saved-meta">Seed: ${x(report.schedule.seed)}</p>` : ''}
    ${curve.total ? `<div class="sheet">
      <figure class="sheet-chart"><div class="sheet-frame"><div class="sheet-canvas">${pullSheet(curve, { href: (point) => `#test-${point.index}` })}</div><span class="sheet-axis sheet-axis-y">${testCount(curve.total)}</span><span class="sheet-axis sheet-axis-x">${x(sheetSpan(curve))}</span></div>
      <figcaption><span class="sheet-legend"><span class="legend-trace">This pull</span></span><span class="sheet-hint">Steep is fast. Flat stretches are slow tests.</span></figcaption></figure>
      <dl class="readouts">${readout('Passed', report.summary.passed, 'passed')}<div class="readout" id="failed-summary" data-failed="${report.summary.failed > 0}"><dt>Failed</dt><dd>${report.summary.failed}</dd></div>${readout('Skipped', report.summary.skipped)}${readout('Not run', report.summary.notRun)}${readout('Run time', x(timingDuration(report.summary.duration)))}${readout('Per test', average === undefined ? '—' : x(timingDuration(average)))}</dl>
    </div>` : ''}
    ${report.coordination ? `<p class="saved-meta">${report.coordination.workers.length} ${report.coordination.workers.length === 1 ? 'worker' : 'workers'}, ${x(timingDuration(report.coordination.wallDuration))} wall, ${x(timingDuration(report.coordination.testWorkDuration))} summed test work</p>
      <details class="run-info"><summary>Worker timings</summary><ul>${report.coordination.workers.map(worker => `<li>Worker ${x(worker.id)}: ${x(timingDuration(worker.executionDuration))} execution, ${x(timingDuration(worker.handoffDuration))} handoff, ${x(timingDuration(worker.queueDuration))} queue to assignment, ${x(timingDuration(worker.unassignedDuration))} unassigned</li>`).join('')}</ul></details>` : ''}
    ${report.error ? errorMarkup(report.error) : ''}
    ${slow.length ? `<details class="run-info"><summary>Slowest tests</summary><ol class="slow-test-list">${slow.map(test => `<li><a href="#test-${test.index}">${x(testTitle(test))}</a><span>${x(timingDuration(test.duration))}</span></li>`).join('')}</ol></details>` : ''}
    <label class="saved-search"><span>Filter tests</span><input type="search" id="search" placeholder="Search files, suites, and test output"></label>
    <p id="empty" class="empty-list" hidden>No tests match this filter.</p>
    ${files
      .map(
        (file) =>
          `<section class="file-group"><h2>${x(file)}</h2>${report.tests
            .filter((test) => test.file === file)
            .map(testMarkup)
            .join('')}</section>`
      )
      .join('')}
  </main><script>
    document.getElementById('search').addEventListener('input',event=>{
      let query=event.target.value.toLowerCase();
      let visible=0;
      for(let test of document.querySelectorAll('[data-test]')){
        test.hidden=!(test.dataset.file+' '+test.textContent).toLowerCase().includes(query);
        if(!test.hidden)visible++;
      }
      for(let file of document.querySelectorAll('.file-group'))file.hidden=![...file.querySelectorAll('[data-test]')].some(test=>!test.hidden);
      let empty=document.getElementById('empty');
      empty.hidden=visible>0;
      if(!empty.hidden)empty.scrollIntoView({block:'nearest'});
    });
    for(let detail of document.querySelectorAll('.run-info'))detail.addEventListener('toggle',()=>{if(detail.open)detail.scrollIntoView({block:'nearest'});});
    for(let link of document.querySelectorAll('.sheet-plot a, .slow-test-list a'))link.addEventListener('click',()=>{let test=document.querySelector(link.getAttribute('href'));if(test)test.open=true;});
  </script></body></html>`;
}
