import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createFixtureController, createFixtureHttpHandler } from '../../src/fixtures.js';

let db = new DatabaseSync(process.env.FIXTURE_DATABASE);
db.exec('CREATE TABLE users (name TEXT NOT NULL)');
let active = new Set(), holds = new Set();
let resets = 0;
let controller = createFixtureController({
  workerId: process.env.FIXTURE_WORKER,
  context: { db },
  pause() {
    let id = Symbol();
    holds.add(id);
    return Object.freeze({
      idle: () => Promise.allSettled([...active]),
      resume: () => { holds.delete(id); },
    });
  },
  reset({ db }, execution) {
    db.exec('DELETE FROM users');
    return { resetNumber: ++resets, execution: execution.executionId, appProcess: process.pid };
  },
  operations: {
    'users.create': ({ db }, { name }) => {
      db.prepare('INSERT INTO users VALUES (?)').run(name);
      return { name, process: process.pid };
    },
    'users.count': ({ db }) => db.prepare('SELECT count(*) AS count FROM users').get().count,
    'users.wait': async (_context, _input, { signal }) => {
      await new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return null;
    },
  },
});
let fixtures = createFixtureHttpHandler(controller, { token: process.env.FIXTURE_TOKEN });
let page = `<!doctype html><h1>Contacts</h1><label>Name<input name="name"></label><button>Save</button><ul></ul>
<script>
let refresh=async()=>{let users=await(await fetch('/api/users')).json();document.querySelector('ul').replaceChildren(...users.map(user=>{let item=document.createElement('li');item.textContent=user.name;return item;}));};
document.querySelector('button').onclick=async()=>{await fetch('/api/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.querySelector('input').value})});await refresh();};
refresh();
</script>`;
let app = async (request, response) => {
  if (request.url === '/api/users') {
    if (request.method === 'POST') {
      let chunks = [];
      for await (let chunk of request) chunks.push(chunk);
      let { name } = JSON.parse(Buffer.concat(chunks).toString());
      db.prepare('INSERT INTO users VALUES (?)').run(name);
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(db.prepare('SELECT name FROM users').all()));
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(page);
  }
};
let server = createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (request.method === 'HEAD') { response.end(); return; }
  if (await fixtures(request, response)) return;
  if (holds.size) { response.writeHead(503).end(); return; }
  let work = app(request, response);
  active.add(work);
  try { await work; }
  finally { active.delete(work); }
});
server.listen(0, '127.0.0.1', () => {
  process.send({ url: `http://127.0.0.1:${server.address().port}` });
});
process.once('SIGTERM', async () => {
  try {
    await controller.close();
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    db.close();
    process.exitCode = 0;
    process.disconnect();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
});
