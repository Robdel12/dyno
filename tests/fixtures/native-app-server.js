import { createServer } from 'node:http';

let records = [];
let statusReads = 0;
let mediaPreference;
let queuedNative = Promise.withResolvers(), cancelledNative = Promise.withResolvers();
let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native fixture</title>
<style>
body{font:16px system-ui;margin:24px}label{display:block;margin:12px 0}
#secret{position:absolute;left:600px;top:400px;width:60px;height:40px;background:rgb(200,10,20)}
#hover{width:200px;height:80px;background:rgb(20,60,140);margin:16px 0}
#hover:hover{background:rgb(20,160,80)}
#tall{position:absolute;top:1600px;left:24px;width:160px}#tall>div{height:500px}
@media(min-height:1000px){#tall>div{background:rgb(1,2,3)!important}}
</style></head><body>
<h1>Native fixture</h1>
<form><label>Name<input id="name" value="Robert"></label><label>Notes<textarea id="notes"></textarea></label><button id="save">Save note</button></form>
<p id="saved" role="status">Ready</p>
<div id="secret">Secret</div>
<button id="remove">Remove saved note</button><output id="removed"></output>
<button id="copy">Copy token</button><output id="copied"></output>
<button id="load">Load status</button><output id="network"></output>
<div id="hover">Hover target</div><a href="/destination">Open destination</a>
<div style="height:900px"></div>
<section id="tall"><div style="background:rgb(180,40,90)"></div><div style="background:rgb(20,160,80)"></div><div style="background:rgb(20,60,140)"></div></section>
<script>
window.viewportChanges=[];
window.viewportObservationStage='startup';
window.viewportSnapshot=()=>({
  width:innerWidth,height:innerHeight,outerWidth,outerHeight,
  clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,
  visualWidth:visualViewport?.width,visualHeight:visualViewport?.height,
  pixelRatio:devicePixelRatio,scrollX,scrollY,
  tallMedia:matchMedia('(min-height:1000px)').matches,
  visibility:document.visibilityState,focused:document.hasFocus(),at:performance.now()
});
window.addEventListener('resize',event=>viewportChanges.push({
  ...viewportSnapshot(),eventAt:event.timeStamp,stage:viewportObservationStage
}));
document.querySelector('form').onsubmit=async event=>{
  event.preventDefault();
  let response=await fetch('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.querySelector('#name').value,notes:document.querySelector('#notes').value})});
  if(!response.ok)throw Error('Save failed');
  let record=await response.json();
  document.querySelector('#saved').textContent='Saved '+record.name;
};
document.querySelector('#remove').onclick=async()=>{
  if(!confirm('Remove saved note?'))return;
  await fetch('/api/records',{method:'DELETE'});
  document.querySelector('#removed').textContent='Removed';
};
document.querySelector('#copy').onclick=async()=>{
  await navigator.clipboard.writeText('Dyno native token');
  document.querySelector('#copied').textContent='Copied';
};
document.querySelector('#load').onclick=async()=>{
  try{
    let response=await fetch('/api/status?probe='+crypto.randomUUID(),{cache:'no-store'});
    if(!response.ok)throw Error('Status failed');
    let value=await response.json();
    document.querySelector('#network').textContent='Connected '+value.revision;
  }catch{document.querySelector('#network').textContent='Offline';}
};
</script></body></html>`;

let server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  let path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/native-cancellation-gate.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`
      let held;
      self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
      self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', event => {
        let url = new URL(event.request.url);
        if (event.request.method !== 'POST' || !['/__dyno__/operations', '/__dyno__/operations/cancel'].includes(url.pathname)) return;
        event.respondWith((async () => {
          let input = await event.request.clone().json();
          if (url.pathname === '/__dyno__/operations' && input.operation === 'native' && input.input.kind === 'key' && input.input.key === 'Space') {
            held = { requestId: input.requestId, sent: Promise.withResolvers(), ...Promise.withResolvers() };
            await fetch('/api/native-queued', { method: 'POST' });
            await held.promise;
            // Deliver the real stale request even though its original client
            // fetch was aborted. The gateway must reject it before dispatch.
            let response = await fetch(new Request(event.request, { signal: new AbortController().signal }));
            held.sent.resolve(response.status);
            return response;
          }
          let response = await fetch(event.request);
          if (url.pathname === '/__dyno__/operations/cancel' && input.requestId === held?.requestId) {
            if (!response.ok) throw new Error('Native cancellation was not acknowledged');
            held.resolve();
            let status = await held.sent.promise;
            await fetch('/api/native-cancelled', { method: 'POST', body: String(status) });
          }
          return response;
        })());
      });
    `);
    return;
  }
  if (['/api/native-queued', '/api/native-cancelled'].includes(path)) {
    let observed = path === '/api/native-queued' ? queuedNative : cancelledNative;
    if (request.method === 'POST') {
      let body = ''; for await (let chunk of request) body += chunk;
      observed.resolve(body);
      response.end('recorded');
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: Number(await observed.promise) }));
    }
    return;
  }
  if (path === '/api/media-preference') {
    if (request.method === 'POST') {
      let chunks = [];
      for await (let chunk of request) chunks.push(chunk);
      mediaPreference = JSON.parse(Buffer.concat(chunks).toString()).reduced;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ reduced: mediaPreference }));
    return;
  }
  if (path === '/api/status') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ revision: ++statusReads }));
    return;
  }
  if (path === '/api/records') {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'DELETE') {
      records = [];
      response.end('{}');
      return;
    }
    if (request.method === 'POST') {
      let chunks = [];
      for await (let chunk of request) chunks.push(chunk);
      let record = JSON.parse(Buffer.concat(chunks).toString());
      records = [...records, record];
      response.end(JSON.stringify(record));
    } else response.end(JSON.stringify(records));
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(
    path === '/destination'
      ? '<!doctype html><html><body><h1>Destination ready</h1></body></html>'
      : html,
  );
});

server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('NATIVE_FIXTURE_READY'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
