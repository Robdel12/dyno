import { test } from 'node:test';
import assert from 'node:assert/strict';
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
