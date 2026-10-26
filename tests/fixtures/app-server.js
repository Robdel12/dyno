import http from 'node:http';
import { createHash } from 'node:crypto';

let script = `
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
<h1>Fixture app</h1><form><label>Name <input name="name"></label><button>Save</button></form>
<p role="status">Ready</p><button id="property">Change property</button><button id="reject">Reject</button><a href="/other">Other page</a>
<button id="dismiss">Dismiss notice</button><label>Review mode <select><option>Choose mode</option><option>Compare</option></select></label><output>No review mode</output>
<script>${script}</script></body></html>`;
let server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
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
  if (request.url === '/startup-error') response.end('<!doctype html><html><head><script>throw new Error("Startup exploded")</script></head><body><h1>Broken app</h1></body></html>');
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
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`FIXTURE_READY ${server.address().port} PID=${process.pid}`));
