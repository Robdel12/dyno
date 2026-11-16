import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { instrumentFrameworkSource } from '../../scripts/coverage/instrument.js';

let exec = promisify(execFile);
let root = fileURLToPath(new URL('../../', import.meta.url));

async function runProbe(t, fault, portable = false, large = false) {
  let directory = await mkdtemp(join(tmpdir(), 'dyno-framework-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  let baseline = {};
  let code = {};
  for (let name of ['main', 'frame']) {
    let path = join(directory, name + '.js');
    let instrumenter = createInstrumenter({ esModules: true, coverageVariable: '__dynoSelfCoverage', coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
    let source = 'globalThis.hit = () => { globalThis.hits = (globalThis.hits ?? 0) + 1; }; hit();';
    if (fault === 'oversized') source += '\n' + 'hits += 0;\n'.repeat(5000);
    code[name] = instrumenter.instrumentSync(source, path);
    baseline[path] = instrumenter.lastFileCoverage();
  }
  let portablePath = join(directory, 'portable.js');
  if (portable) {
    let result = instrumentFrameworkSource('export let readViewport = page => page.evaluate(() => ({ width: innerWidth, height: innerHeight }));', portablePath);
    baseline[portablePath] = result.coverage;
    await writeFile(portablePath, result.code);
  }
  let baselinePath = join(directory, 'baseline.json');
  await writeFile(baselinePath, JSON.stringify(baseline));
  let proof = join(directory, 'proof.js');
  await writeFile(proof, `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import playwright from ${JSON.stringify(pathToFileURL(join(root, 'node_modules/playwright-core/index.mjs')).href)};
${portable ? `import { readViewport } from ${JSON.stringify(pathToFileURL(portablePath).href)};` : ''}
let code = ${JSON.stringify(code)};
let server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><script>' + code[request.url === '/frame' ? 'frame' : 'main'] + '</script>' +
    (request.url === '/main' ? '<iframe id="probe-frame" src="/frame"></iframe><button id="remove-frame">Remove frame</button>' : '') +
    '<a id="next" href="/next">Next</a>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser = await playwright[${JSON.stringify(process.env.DYNO_TEST_BROWSER ?? 'chromium')}].launch({ headless: true });
let context = await browser.newContext();
let page = await context.newPage();
let messages = [];
page.on('console', message => messages.push(message.text()));
try {
  await page.goto('http://127.0.0.1:' + server.address().port + '/main');
  ${portable ? 'assert.deepEqual(await readViewport(page), { width: 1280, height: 720 });' : ''}
  if (${JSON.stringify(Boolean(fault))}) {
    let observed = await page.evaluate(fault => {
      if (fault === 'rejected') Object.defineProperty(navigator, 'sendBeacon', { value: () => false });
      dispatchEvent(new PageTransitionEvent('pagehide'));
      hit();
      return { hits, failures: globalThis.__dynoSelfCollector.failures };
    }, ${JSON.stringify(fault)});
    assert.equal(observed.hits, 2);
    assert.ok(observed.failures.length > 0);
  } else {
  await page.evaluate(() => {
    document.getElementById('remove-frame').addEventListener('click', () => {
      let frame = document.getElementById('probe-frame');
      frame.contentWindow.hit();
      frame.remove();
    });
  });
  await page.locator('#remove-frame').click();
  await page.evaluate(() => {
    addEventListener('pagehide', () => hit());
    ${large ? "addEventListener('pagehide', () => { for (let index = 0; index < 10000; index++) hit(); });" : ''}
    document.getElementById('next').addEventListener('click', event => {
      event.preventDefault();
      hit();
      location.assign('/next');
    });
  });
  await Promise.all([
    page.waitForURL('**/next'),
    page.locator('#next').click(),
  ]);
  }
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(messages, []);
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
`);
  let raw = join(directory, 'raw');
  await exec(process.execPath, ['--import', join(root, 'scripts/coverage/bootstrap.js'), proof], {
    cwd: directory, timeout: 25000,
    env: { ...process.env, NODE_OPTIONS: '', DYNO_SELF_COVERAGE_DIR: raw, DYNO_SELF_COVERAGE_BASELINE: baselinePath },
  });
  let records = [];
  let errors = [];
  for (let name of await readdir(raw)) {
    let record = JSON.parse(await readFile(join(raw, name), 'utf8'));
    if (name.startsWith('errors-')) errors.push(...record);
    else records.push(record);
  }
  return { directory, records, errors };
}

test('framework coverage retains same-task iframe and final navigation hits without changing console or storage', { timeout: 30000 }, async t => {
  let { directory, records, errors } = await runProbe(t);
  assert.deepEqual(errors, []);
  let main = join(directory, 'main.js');
  let frame = join(directory, 'frame.js');
  let hits = path => records.filter(record => record.kind === 'browser' && record.coverage[path])
    .map(record => record.coverage[path].f[0]).sort((left, right) => left - right);
  assert.deepEqual(hits(frame), [2]);
  assert.deepEqual(hits(main), [1, 3]);
});

test('framework collection failures preserve app execution and remain explicit in coverage output', { timeout: 30000 }, async t => {
  for (let fault of ['rejected', 'oversized']) {
    let { errors } = await runProbe(t, fault);
    assert.ok(errors.some(message => /could not queue|32 KiB/.test(message)), errors.join('\n'));
  }
});

test('framework instrumentation preserves real serialized browser callbacks and their source counters', { timeout: 30000 }, async t => {
  let { directory, records, errors } = await runProbe(t, undefined, true);
  assert.deepEqual(errors, []);
  let source = join(directory, 'portable.js');
  let counters = records.filter(record => record.coverage[source]).map(record => record.coverage[source].f);
  assert.equal(counters.reduce((total, counter) => total + counter[0], 0), 1);
  assert.equal(counters.reduce((total, counter) => total + counter[1], 0), 1);
});

test('framework coverage batches large final handlers without losing their exact hit counts', { timeout: 30000 }, async t => {
  let { directory, records, errors } = await runProbe(t, undefined, false, true);
  assert.deepEqual(errors, []);
  let main = join(directory, 'main.js');
  let hits = records.filter(record => record.kind === 'browser' && record.coverage[main])
    .map(record => record.coverage[main].f[0]).sort((left, right) => left - right);
  assert.deepEqual(hits, [1, 10003]);
});
