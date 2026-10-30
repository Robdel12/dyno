import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Managed operation evaluation</title>
<style>body{font:16px system-ui;margin:24px}label{display:block;margin:12px 0}input,textarea,button{font:inherit}#hover{width:240px;height:100px;background:rgb(20,60,140);color:white;margin:20px 0}#hover:hover{background:rgb(20,160,80)}#crop{width:160px;height:80px;background:rgb(180,40,90)}#motion{animation:move 5s infinite} @keyframes move{to{transform:translateX(20px)}} @media(min-height:1000px){#tall>div{background:rgb(1,2,3)!important}} @media(prefers-reduced-motion:reduce){#motion{animation:none}}</style></head>
<body><button id="reset">Reset example</button><form><label>Name<input id="name" value="Robert"></label><label>Notes<textarea id="notes"></textarea></label><button id="save">Save note</button></form><p id="saved" role="status">Ready</p><button id="copy">Copy evaluation token</button><output id="copied"></output><div id="hover">Hover target</div><div id="crop">Capture target</div><span id="motion">Motion</span><button id="load">Load status</button><output id="network"></output>
<div style="height:900px"></div><section id="tall" style="width:160px"><div style="height:500px;background:rgb(180,40,90)"></div><div style="height:500px;background:rgb(20,160,80)"></div><div style="height:500px;background:rgb(20,60,140)"></div></section>
<script type="module" src="/local.js"></script><script>
let form=document.querySelector('form'),saved=document.querySelector('#saved');
document.querySelector('#reset').onclick=()=>{form.reset();saved.textContent='Ready';document.querySelector('#network').textContent='';document.querySelector('#copied').textContent='';window.lastStatusRevision=null;};
form.onsubmit=async event=>{event.preventDefault();let response=await fetch('/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.querySelector('#name').value,notes:document.querySelector('#notes').value})});if(!response.ok)throw Error('Save failed');saved.textContent='Saved '+(await response.json()).name;};
document.querySelector('#copy').onclick=async()=>{await navigator.clipboard.writeText('Dyno evaluation token');document.querySelector('#copied').textContent='Copied';};
let hover=document.querySelector('#hover');hover.onmouseenter=()=>hover.dataset.hovered='true';hover.onmouseleave=()=>hover.dataset.hovered='false';
document.querySelector('#load').onclick=async()=>{try{let response=await fetch('/status?probe='+crypto.randomUUID(),{cache:'no-store'});if(!response.ok)throw Error('Load failed');let value=await response.json();window.lastStatusRevision=value.revision;document.querySelector('#network').textContent=value.status;}catch{document.querySelector('#network').textContent='Offline';}};
</script></body></html>`;

export async function startFixture() {
  let result = await build({
    stdin: {
      contents: `import { Interactor } from './src/browser/interactor.js';
    let I=new Interactor({root:()=>document.body,assert:{timeout:2000}});
    window.evalI=I;
    window.runLocalWorkflow=async()=>{
      await I.click('Reset example');
      await I.find('Name').then.fill('Robert');
      await I.find('Notes').then.fill('A saved note');
      await I.click('Save note');
      await I.find('$(#saved)').text('Saved Robert');
    };`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  let records = [];
  let statusReads = 0;
  let server = createServer(async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      let path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/local.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(result.outputFiles[0].text);
      } else if (path === '/controller') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Controller</title><h1>Evaluation controller</h1>');
      } else if (path === '/status') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ status: 'Connected', revision: ++statusReads }));
      } else if (path === '/records') {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'POST') {
          let chunks = [];
          for await (let chunk of request) chunks.push(chunk);
          let record = JSON.parse(Buffer.concat(chunks).toString());
          records = [...records, Object.freeze(record)];
          response.end(JSON.stringify(record));
        } else response.end(JSON.stringify(records));
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
      }
    } catch (error) {
      response.writeHead(500);
      response.end(error.message);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return Object.freeze({
    origin: `http://localhost:${server.address().port}`,
    statusReads: () => statusReads,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  });
}
