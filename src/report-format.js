import { testTitle } from './suite.js';

let clean = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '�');
export let escapeMarkup = (value) =>
  clean(value).replace(
    /[<>&"']/g,
    (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]
  );
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
  let labels = {
    test: 'Test',
    beforeEach: 'Setup · beforeEach',
    afterEach: 'Cleanup · afterEach',
    app: 'Application',
    timeout: 'Test timeout',
    cleanup: 'Cleanup timeout',
    runtime: 'Test runtime'
  };
  return `<div class="failure">
    <p class="failure-location">${x(labels[error.phase] ?? error.phase)}</p>
    <h2>${x(error.message)}</h2>
    ${error.source ? `<p class="failure-location">${x(error.source.file)}:${error.source.line}:${error.source.column}</p><pre class="source-excerpt">${x(error.source.code)}</pre>` : ''}
    ${error.stack ? `<details><summary>Stack trace</summary><pre>${x(error.stack)}</pre></details>` : ''}
  </div>`;
}
function imageMarkup(image) {
  let x = escapeMarkup;
  if (image.status !== 'captured')
    return `<p class="output-notice">${image.status === 'missing' ? 'Screenshot unavailable' : 'Image skipped'}: ${x(image.name)} · ${x(image.reason)}</p>`;
  return `<figure class="screenshot">
    <a href="${x(image.path)}"><img src="${x(image.path)}" alt="${x(image.name)}" loading="lazy"></a>
    <figcaption>${x(image.name)} · ${image.width} × ${image.height} · ${x(image.browser.name)}</figcaption>
  </figure>`;
}
function testMarkup(test) {
  let x = escapeMarkup;
  let note =
    test.status === 'skipped'
      ? test.skipReason
      : test.status === 'not-run'
        ? 'Run ended before this test reported.'
        : '';
  return `<details class="saved-test" data-test data-file="${x(test.file)}" data-status="${x(test.status)}" ${test.status === 'failed' ? 'open' : ''}>
    <summary><span class="saved-status">${x(test.status === 'not-run' ? 'not run' : test.status)}</span><span class="saved-name">${x(testTitle(test))}</span><span class="test-time">${Math.round(test.duration)} ms</span></summary>
    <div class="saved-output">
      ${errors(test).map(errorMarkup).join('')}
      ${note ? `<p>${x(note)}</p>` : ''}
      ${test.output.length ? `<h2>Console</h2><pre>${x(consoleText(test))}</pre>` : ''}
      ${test.attachments.map(imageMarkup).join('')}
    </div>
  </details>`;
}
export function htmlReport(report, css) {
  let x = escapeMarkup;
  let files = [...new Set(report.tests.map((test) => test.file))];
  let title =
    report.status === 'interrupted' ? 'Run interrupted' : report.summary.failed ? 'Run failed' : 'Run complete';
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>Dyno · ${x(report.status)}</title><style>${css}</style>
  </head><body><main class="saved-report">
    <a href="run.json">Run JSON</a> · <a href="junit.xml">JUnit</a>
    <h1>${title}</h1>
    <p>${report.summary.passed} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped · ${report.summary.notRun} not run</p>
    <p>Saved report · ${x(report.runId)}${report.startedAt ? ` · ${x(report.startedAt)}` : ''}</p>
    ${report.error ? errorMarkup(report.error) : ''}
    <label>Filter tests<input type="search" id="search" placeholder="Search files, suites, and test output"></label>
    <p id="empty" hidden>No tests match this filter.</p>
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
      document.getElementById('empty').hidden=visible>0;
    });
  </script></body></html>`;
}
