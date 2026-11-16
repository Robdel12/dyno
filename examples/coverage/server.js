import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { instrumentCoverage } from 'dyno/coverage';

let directory = fileURLToPath(new URL('./', import.meta.url));
let collecting = process.env.DYNO_COVERAGE === '1';
let modules = new Map();
let baseline = {};
for (let name of ['app.js', 'greeting.ts', 'unused.js']) {
  let filename = join(directory, 'src', name);
  let code = await readFile(filename, 'utf8');
  let compiled = await transform(code, {
    loader: name.endsWith('.ts') ? 'ts' : 'js',
    sourcefile: filename,
    sourcemap: 'external',
    format: 'esm',
    target: 'es2022',
  });
  let output = compiled;
  if (collecting) {
    output = instrumentCoverage({
      code: compiled.code,
      filename: join(directory, '.dyno', 'compiled', name.replace(/\.ts$/, '.js')),
      inputSourceMap: JSON.parse(compiled.map),
    });
    baseline[output.coverage.path] = output.coverage;
  }
  let path = '/' + name.replace(/\.ts$/, '.js');
  modules.set(path, { type: 'text/javascript', body: output.code + `\n//# sourceMappingURL=${path}.map\n` });
  modules.set(path + '.map', {
    type: 'application/json',
    body: typeof output.map === 'string' ? output.map : JSON.stringify(output.map),
  });
}
if (collecting) {
  let filename = join(directory, '.dyno', 'coverage-baseline.json');
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(baseline));
}

let html = `<!doctype html><html><head><meta charset="utf-8"><title>Coverage example</title></head><body>
<h1>Greeting card</h1><form><label>Name <input name="name"></label><button>Save</button></form>
<p role="status">Ready</p><a href="/details">Open details</a><script type="module" src="/app.js"></script>
</body></html>`;
let server = http.createServer((request, response) => {
  let module = modules.get(request.url);
  response.setHeader('Cache-Control', 'no-store');
  if (module) {
    response.writeHead(200, { 'Content-Type': module.type + '; charset=utf-8' });
    response.end(module.body);
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; frame-ancestors 'self'",
  });
  response.end(request.url === '/details' ? html.replace('<h1>Greeting card</h1>', '<h1>Card details</h1>') : html);
});
server.listen(Number(process.env.PORT ?? 4302), '127.0.0.1', () => {
  console.log(`Coverage example listening at http://127.0.0.1:${server.address().port}`);
});
