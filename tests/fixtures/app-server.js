import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';

let script = `
console.info('Fixture app ready');
window.appOnly = true;
let saves = 0;
let inputInAppRealm = true;
document.querySelector('input').addEventListener('input', event => { inputInAppRealm = event instanceof Event; });
document.querySelector('form').addEventListener('click', event => {
  if (!(event instanceof MouseEvent) || event.view !== window) {
    event.preventDefault();
    document.querySelector('[role=status]').textContent = 'Wrong click realm';
  }
});
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!inputInAppRealm) { document.querySelector('[role=status]').textContent = 'Wrong input realm'; return; }
  let response = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.querySelector('input').value }) });
  let result = await response.json();
  document.querySelector('[role=status]').textContent = 'Saved ' + result.name + ' · ' + ++saves;
  console.info('Contact saved', {name: result.name});
});
document.querySelector('#property').addEventListener('click', async () => {
  await fetch('/api/value');
  document.querySelector('input').value = 'Property only';
});
document.querySelector('#reject').addEventListener('click', () => Promise.reject(new Error('Unhandled app rejection')));
document.querySelector('#dismiss').addEventListener('click', event => {
  event.currentTarget.remove();
  document.querySelector('[role=status]').textContent = 'Notice dismissed';
});
document.querySelector('select').addEventListener('change', event => {
  document.querySelector('output').textContent = event instanceof Event ? 'Review mode: ' + event.target.value : 'Wrong select event realm';
});
`;
let html = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture app</title></head><body>
<h1>Fixture app</h1><form><label>Name<input name="name"></label><button>Save</button></form>
<p role="status">Ready</p><button id="property">Change property</button><button id="reject">Reject</button><a href="/other">Other page</a>
<button id="dismiss">Dismiss notice</button><label>Review mode <select><option>Choose mode</option><option>Compare</option></select></label><output>No review mode</output>
<script>${script}</script></body></html>`;
let lifecycle = [];
let inspection = Promise.withResolvers();
let browserWaiting = Promise.withResolvers();
let releaseBrowser = Promise.withResolvers();
let captureGate = readFileSync(new URL('./capture-gate.js', import.meta.url));
let captureBefore = Promise.withResolvers();
let captureStaged = Promise.withResolvers();
let captureCommitted = Promise.withResolvers();
let releaseCapture = Promise.withResolvers();
let navigationRequested = Promise.withResolvers();
let releaseNavigation = Promise.withResolvers();
let descendantPort;
let listening = false;
let announced = false;
function announceReady() {
  if (announced || !listening || (process.env.SPAWN_DESCENDANT && !descendantPort)) return;
  announced = true;
  console.log(`FIXTURE_READY ${server.address().port} PID=${process.pid}`);
}
if (process.env.SPAWN_DESCENDANT) {
  let descendant = spawn(process.execPath, ['--input-type=module', '-e', `import http from 'node:http';
import { readFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); let server=http.createServer((req,res)=>res.end('descendant')); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`], { stdio: ['ignore', 'pipe', 'inherit'] });
  descendant.stdout.setEncoding('utf8');
  descendant.stdout.on('data', data => { descendantPort = Number(data.trim()); announceReady(); });
}
let server = http.createServer(async (request, response) => {
  if (process.env.COOP) response.setHeader('Cross-Origin-Opener-Policy', process.env.COOP);
  if (process.env.COEP) response.setHeader('Cross-Origin-Embedder-Policy', process.env.COEP);
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/browser-waiting') { if(request.method==='POST')browserWaiting.resolve();else await browserWaiting.promise;response.end('waiting');return; }
  if (request.url === '/api/release-browser') { if(request.method==='POST')releaseBrowser.resolve();else await releaseBrowser.promise;response.end('released');return; }
  if (request.url === '/capture-gate.js') {
    response.writeHead(200, {'Content-Type':'text/javascript','Service-Worker-Allowed':'/'});
    response.end(captureGate);
    return;
  }
  if (request.url === '/api/capture-before') { if(request.method==='POST')captureBefore.resolve();else await captureBefore.promise;response.end('before');return; }
  if (request.url === '/api/capture-committed') { if(request.method==='POST')captureCommitted.resolve();else await captureCommitted.promise;response.end('committed');return; }
  if (request.url === '/api/capture-staged') { if(request.method==='POST')captureStaged.resolve();else await captureStaged.promise;response.end('staged');return; }
  if (request.url === '/api/release-capture') { if(request.method==='POST')releaseCapture.resolve();else await releaseCapture.promise;response.end('released');return; }
  if (request.url === '/api/inspection') {
    if (request.method === 'POST') { let body='';for await(let chunk of request)body+=chunk;inspection.resolve(JSON.parse(body));response.end('recorded'); }
    else { response.setHeader('Content-Type','application/json');response.end(JSON.stringify(await inspection.promise)); }
    return;
  }
  if (request.url === '/wrapped-link') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><style>p{width:179px;font:20px/1.5 system-ui}#large{height:200vh}#hidden{visibility:hidden}#cover{position:fixed;inset:0;background:white;pointer-events:none;display:none}</style><p>Start here with a <a href="/other">Create an account to document history</a></p><section id="large">A large section</section><button id="hidden">Hidden</button>');
    return;
  }
  if (request.url === '/interactor') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><h1>Contacts</h1>
      <section id="personal"><label>Name<input></label><output>Unchanged</output></section>
      <section id="work"><label>Name<input></label><label>Seats<input type="number"></label><label>Notes<textarea></textarea></label><output>Unchanged</output></section>
      <label>Photos<input type="file" multiple></label><p id="uploads">No photos</p>
      <label>Published name<input readonly value="Published contact"></label>
      <section id="transparent" style="opacity:0"><p>Private note</p></section>
      <section style="opacity:.2"><button style="opacity:.2">Faint control</button></section>
      <div id="shadow" style="opacity:0"></div><button id="reveal">Reveal note</button>
      <p id="below" style="margin-top:200vh">Below the fold</p>
      <script>
        document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML = '<p>Shadow note</p>';
        document.querySelector('#reveal').onclick = () => {
          document.querySelector('#transparent').style.opacity = '1';
          document.querySelector('#shadow').style.opacity = '1';
        };
        for(let section of document.querySelectorAll('section')) section.addEventListener('input', event => {
          section.querySelector('output').textContent = event instanceof Event ? event.target.value : 'Wrong event realm';
        });
        document.querySelector('[type=file]').addEventListener('change', async event => {
          let files = [...event.target.files];
          document.querySelector('#uploads').textContent = event instanceof Event && files.every(file=>file instanceof File)
            ? (await Promise.all(files.map(async file=>file.name+': '+await file.text()))).join(', ') : 'Wrong file realm';
        });
      </script>`);
    return;
  }
  if (request.url === '/visual') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:rgb(20,150,80)}canvas{position:absolute;left:0;top:0}form{margin:80px 20px}#layout:after{content:'Wide'}@media(max-width:500px){#layout:after{content:'Narrow'}}</style><canvas width="40" height="40"></canvas><form><label>Name<input name="name"></label><button>Save</button></form><p role="status">Ready</p><p id="layout"></p><script>let context=document.querySelector('canvas').getContext('2d');context.fillStyle='rgb(30,70,210)';context.fillRect(0,0,40,40);let saves=0;document.querySelector('form').onsubmit=event=>{event.preventDefault();document.querySelector('[role=status]').textContent='Saved '+document.querySelector('input').value+' · '+ ++saves;};</script>`);
    return;
  }
  if (request.url === '/held-app') {
    navigationRequested.resolve();
    await releaseNavigation.promise;
  }
  if (request.url === '/api/navigation-requested') {
    await navigationRequested.promise;
    response.end('navigation requested');
    return;
  }
  if (request.url === '/api/release-navigation' && request.method === 'POST') {
    releaseNavigation.resolve();
    response.end('navigation released');
    return;
  }
  if (['/gzip-app', '/brotli-app'].includes(request.url)) {
    let gzip = request.url === '/gzip-app';
    let bytes = (gzip ? gzipSync : brotliCompressSync)(Buffer.from(html));
    response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': gzip ? 'gzip' : 'br', 'Content-Length': bytes.length });
    response.end(bytes);
    return;
  }
  if (request.url === '/broken-stream') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '1000000' });
    response.write('partial');
    setImmediate(() => response.destroy());
    return;
  }
  if (request.url === '/descendant') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({port:descendantPort})); return; }
  if (request.url === '/api/lifecycle') {
    if (request.method === 'POST') {
      let body = '';
      for await (let chunk of request) body += chunk;
      lifecycle = [...lifecycle, body];
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(lifecycle));
    return;
  }
  if (request.url === '/api/logout') { response.writeHead(200, { 'Set-Cookie': 'saved=; Max-Age=0; HttpOnly; Path=/' }); response.end('signed out'); return; }
  if (request.url === '/api/crash') { response.end('stopping'); queueMicrotask(() => process.exit(9)); return; }
  if (request.url === '/nonce-app') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'nonce-fixture'; frame-ancestors 'self'" });
    response.end('<!doctype html><html><head><title>Nonce app</title></head><body><h1>Booting</h1><script nonce="fixture">document.querySelector("h1").textContent = "Nonce app ready"</script></body></html>');
    return;
  }
  if (request.url === '/blocked-app') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'none'; frame-ancestors 'self'" });
    response.end('<!doctype html><html><head><title>Blocked app</title></head><body><h1>Scripts blocked</h1></body></html>');
    return;
  }
  if (request.url === '/api/save') {
    let body = '';
    for await (let chunk of request) body += chunk;
    if (request.headers.origin !== `http://${request.headers.host}`) { response.writeHead(403); response.end('Untrusted origin'); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'saved=yes; HttpOnly; Path=/; SameSite=Lax' });
    response.end(body);
    return;
  }
  if (request.url === '/api/value') { response.writeHead(200); response.end('value'); return; }
  if (request.url === '/api/cookie') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ cookie: request.headers.cookie ?? '' })); return; }
  if (request.url === '/redirect') { response.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/other` }); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' });
  if (request.url === '/startup-error') response.end('<!doctype html><html><head><script>console.error("Startup diagnostic before the exception"); throw new Error("Startup exploded")</script></head><body><h1>Broken app</h1></body></html>');
  else if (request.url === '/other') response.end('<!doctype html><html><head><title>Other</title></head><body><h1>Other page</h1></body></html>');
  else response.end(html);
});
server.on('upgrade', (request, socket) => {
  let accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.write(Buffer.concat([Buffer.from([0x81, 5]), Buffer.from('hello')]));
  socket.on('data', () => socket.end(Buffer.from([0x88, 0])));
  socket.on('error', () => socket.destroy());
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => { listening = true; announceReady(); });
