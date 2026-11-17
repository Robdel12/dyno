import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { instrumentCoverage } from 'dyno/coverage';

export async function serveCoverageApp({ root = process.cwd(), collecting = process.env.DYNO_COVERAGE === '1', port = 0 } = {}) {
  let modules = new Map();
  let baseline = {};
  for (let name of ['app.ts', 'unvisited.ts']) {
    let filename = join(root, 'src', name);
    let compiled = await transform(await readFile(filename, 'utf8'), {
      loader: 'ts', sourcefile: filename, sourcemap: 'external', format: 'esm', target: 'es2022',
    });
    let output = compiled;
    if (collecting && process.env.COVERAGE_BUILD !== 'disabled') {
      output = instrumentCoverage({ code: compiled.code,
        filename: join(root, '.dyno', 'compiled', name.replace('.ts', '.js')),
        inputSourceMap: JSON.parse(compiled.map) });
      baseline[output.coverage.path] = output.coverage;
    }
    let path = '/' + name.replace('.ts', '.js');
    modules.set(path, { type: 'text/javascript', body: output.code + `\n//# sourceMappingURL=${path}.map\n` });
    modules.set(path + '.map', { type: 'application/json',
      body: typeof output.map === 'string' ? output.map : JSON.stringify(output.map) });
  }
  if (Object.keys(baseline).length) {
    let filename = join(root, '.dyno', 'coverage-baseline.json');
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(baseline));
  }
  let server = http.createServer((request, response) => {
    let path = new URL(request.url, 'http://localhost').pathname;
    let module = modules.get(path);
    response.setHeader('Cache-Control', 'no-store');
    if (module) {
      response.writeHead(200, { 'Content-Type': module.type });
      response.end(module.body);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html',
      'Content-Security-Policy': "script-src 'self'; frame-ancestors 'self'" });
    response.end(`<!doctype html><html><head><title>Coverage app</title></head><body>
      <h1>${path === '/next' ? 'Next page' : 'Coverage app'}</h1>
      <button id="accept">Accept</button><button id="reject">Reject</button><button id="finish">Finish</button>
      <output role="status">Ready</output><a href="/next">Next page</a>
      <script type="module" src="/app.js"></script></body></html>`);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await serveCoverageApp({ port: Number(process.env.PORT) });
  console.log('COVERAGE_READY');
}
