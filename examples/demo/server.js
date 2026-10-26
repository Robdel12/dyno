import http from 'node:http';

let html = `<!doctype html><html><head><meta charset="utf-8"><title>Contact card</title></head><body>
<h1>Contact card</h1><form><label>Name <input name="name"></label><button>Save</button></form><p role="status">Ready</p>
<script>
let count = 0;
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  let response = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.querySelector('input').value }) });
  let result = await response.json();
  document.querySelector('[role=status]').textContent = 'Saved ' + result.name + ' · ' + ++count;
});
</script></body></html>`;
let server = http.createServer(async (request, response) => {
  if (request.url === '/api/save' && request.method === 'POST') {
    let body = '';
    for await (let chunk of request) body += chunk;
    if (request.headers.origin !== `http://${request.headers.host}`) { response.writeHead(403); response.end('Unexpected Origin'); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'demo_saved=true; HttpOnly; SameSite=Lax; Path=/' });
    response.end(body);
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' });
  response.end(html);
});
server.listen(Number(process.env.PORT ?? 4301), '127.0.0.1', () => console.log(`Contact card listening at http://127.0.0.1:${server.address().port}`));
