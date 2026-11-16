import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { loadConfig, normalizeConfig } from '../../src/config.js';
import { buildSuite } from '../../src/build.js';
import { createGateway } from '../../src/server.js';
import { project } from '../helpers/project.js';
import { injectBridge, responseHeaders } from '../../src/proxy.js';

test('injects before executable app scripts while preserving CSP, comments, and template content', () => {
  let input = '<!doctype html><!-- <head>fake</head> --><html><head><meta http-equiv="Content-Security-Policy" content="script-src self"><template><script>inert()</script></template><script src="/app.js"></script></head><body></body></html>';
  let output = injectBridge(input);
  assert.equal(output.replace('<script src="/__dyno__/bridge.js"></script>', ''), input);
  assert.ok(output.indexOf('bridge.js') > output.indexOf('Content-Security-Policy'));
  assert.ok(output.indexOf('bridge.js') > output.indexOf('inert()'));
  assert.ok(output.indexOf('bridge.js') < output.indexOf('src="/app.js"'));
});

test('keeps app redirects/cookies on the gateway and preserves security headers', () => {
  let headers = responseHeaders({ location: 'http://localhost:3000/account?tab=profile', 'set-cookie': ['session=test; Domain=localhost; Path=/; HttpOnly; Secure'], 'content-security-policy': "default-src 'self'", 'x-frame-options': 'SAMEORIGIN' }, new URL('http://localhost:3000'), 'http://127.0.0.1:7357');
  assert.equal(headers.location, 'http://127.0.0.1:7357/account?tab=profile');
  assert.equal(headers['set-cookie'][0], 'session=test; Path=/; HttpOnly; Secure');
  assert.equal(headers['content-security-policy'], "default-src 'self'");
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
});

test('uses the app script nonce without changing the app CSP', () => {
  let output = injectBridge('<html><head><script nonce="app-nonce" src="/app.js"></script></head></html>');
  assert.match(output, /<script nonce="app-nonce" src="\/__dyno__\/bridge.js"><\/script><script nonce="app-nonce" src="\/app.js">/);
});


test('validates an independent app request budget while retaining the default', () => {
  let input = { webServer: { url: 'http://localhost:3000' } };
  assert.equal(normalizeConfig(input, '/project/dyno.config.js').webServer.requestTimeout, 30000);
  let extended = normalizeConfig({ webServer: { ...input.webServer, requestTimeout: 120000 } }, '/project/dyno.config.js');
  assert.equal(extended.webServer.requestTimeout, 120000);
  assert.equal(extended.webServer.timeout, 30000);
  for (let requestTimeout of [0, -1, 1.5, Infinity, 2147483648])
    assert.throws(() => normalizeConfig({ webServer: { ...input.webServer, requestTimeout } }, '/project/dyno.config.js'), /webServer.requestTimeout must be a positive integer/);
});

test('the gateway applies the configured idle deadline and still serves the next app request', { timeout: 15000 }, async t => {
  let entered = Promise.withResolvers(), disconnected = Promise.withResolvers();
  let upstream = createServer((request, response) => {
    if (request.url === '/slow') {
      entered.resolve();
      response.once('close', disconnected.resolve);
      return;
    }
    response.end('ready');
  });
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let fixture = await project(t, { config: { webServer: {
    url: `http://127.0.0.1:${upstream.address().port}`, requestTimeout: 40
  } } });
  let config = await loadConfig(join(fixture.directory, 'dyno.config.js'));
  let gateway = await createGateway(config, await buildSuite(config));
  t.after(() => gateway.close());
  let pending = fetch(new URL('/slow', gateway.url));
  await entered.promise;
  let response = await pending;
  assert.equal(response.status, 502);
  assert.match(await response.text(), /App request exceeded 40 ms/);
  await disconnected.promise;
  assert.equal(await (await fetch(new URL('/ready', gateway.url))).text(), 'ready');
});
