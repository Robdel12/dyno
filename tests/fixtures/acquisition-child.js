import { access } from 'node:fs/promises';
import { createServer } from 'node:http';

let [directory, parent, name] = process.argv.slice(2);
let server = createServer((request, response) => response.end(name));
process.once('message', async () => {
  await access(directory);
  await access(parent);
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.disconnect();
});
server.listen(0, '127.0.0.1', () => {
  process.send({ pid: process.pid, url: `http://127.0.0.1:${server.address().port}` });
});
