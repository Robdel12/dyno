import http from 'node:http';
import https from 'node:https';
import { parse } from 'parse5';

export function injectBridge(html) {
  let tree = parse(html, { sourceCodeLocationInfo: true });
  let scripts = [];
  let nonce;
  let head;
  let body;
  function visit(node) {
    if (node.tagName === 'script' && node.sourceCodeLocation) {
      scripts.push(node.sourceCodeLocation.startOffset);
      nonce ??= node.attrs?.find(attribute => attribute.name === 'nonce')?.value;
    }
    if (node.tagName === 'head') head = node;
    if (node.tagName === 'body') body = node;
    // Template contents are inert; do not inject into a template's script.
    for (let child of node.childNodes ?? []) visit(child);
  }
  visit(tree);
  let offset = scripts.length ? Math.min(...scripts) : head?.sourceCodeLocation?.endTag?.startOffset ?? body?.sourceCodeLocation?.startTag?.endOffset ?? html.length;
  let attribute = nonce === undefined ? '' : ` nonce="${nonce.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  return html.slice(0, offset) + `<script${attribute} src="/__dyno__/bridge.js"></script>` + html.slice(offset);
}

function requestHeaders(request, upstream, gatewayOrigin) {
  let headers = { ...request.headers, host: upstream.host, 'accept-encoding': 'identity' };
  delete headers.connection;
  // Preserve same-origin app semantics at the explicitly configured upstream.
  // Never turn a foreign caller's Origin into a trusted app Origin.
  if (headers.origin === gatewayOrigin) headers.origin = upstream.origin;
  if (headers.referer) {
    let referer = new URL(headers.referer);
    if (referer.origin === gatewayOrigin) headers.referer = upstream.origin + referer.pathname + referer.search;
  }
  return headers;
}

export function responseHeaders(input, upstream, gatewayOrigin) {
  let headers = { ...input };
  delete headers.connection;
  if (headers.location) {
    let target = new URL(headers.location, upstream);
    if (target.origin === upstream.origin) headers.location = gatewayOrigin + target.pathname + target.search + target.hash;
  }
  if (headers['access-control-allow-origin'] === upstream.origin) headers['access-control-allow-origin'] = gatewayOrigin;
  if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(cookie => cookie.replace(/;\s*Domain=([^;]+)/ig, (match, domain) => domain.replace(/^\./, '').toLowerCase() === upstream.hostname.toLowerCase() ? '' : match));
  return headers;
}

export function proxyRequest(request, response, { target, gatewayOrigin }) {
  let upstream = new URL(target);
  let transport = upstream.protocol === 'https:' ? https : http;
  let outgoing = transport.request(new URL(request.url, upstream), {
    method: request.method, headers: requestHeaders(request, upstream, gatewayOrigin)
  }, async incoming => {
    try {
      let headers = responseHeaders(incoming.headers, upstream, gatewayOrigin);
      if (request.method !== 'HEAD' && /text\/html/i.test(headers['content-type'] ?? '') && incoming.statusCode === 200) {
        if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') throw new Error('App ignored Accept-Encoding: identity; compressed HTML injection is unsupported.');
        let chunks = [];
        let size = 0;
        for await (let chunk of incoming) {
          size += chunk.length;
          if (size > 10_000_000) throw new Error('App HTML exceeds the 10 MB injection limit.');
          chunks.push(chunk);
        }
        let html = injectBridge(Buffer.concat(chunks).toString('utf8'));
        delete headers['content-length'];
        delete headers['content-encoding'];
        delete headers.etag;
        headers['cache-control'] = 'no-store';
        response.writeHead(incoming.statusCode, headers);
        response.end(html);
      } else {
        response.writeHead(incoming.statusCode, headers);
        incoming.pipe(response);
      }
    } catch (error) {
      incoming.destroy();
      if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain' });
      response.end(`Dyno gateway: ${error.message}`);
    }
  });
  outgoing.setTimeout(30000, () => outgoing.destroy(new Error('App request exceeded 30 seconds')));
  outgoing.on('error', error => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain' });
    response.end(`App server unavailable: ${error.message}`);
  });
  request.on('aborted', () => outgoing.destroy());
  request.pipe(outgoing);
}

export function proxyUpgrade(request, socket, head, { target, gatewayOrigin }) {
  let upstream = new URL(target);
  let transport = upstream.protocol === 'https:' ? https : http;
  let headers = requestHeaders(request, upstream, gatewayOrigin);
  headers.connection = 'Upgrade';
  let outgoing = transport.request(new URL(request.url, upstream), { headers });
  socket.once('close', () => outgoing.destroy());
  outgoing.setTimeout(30000, () => outgoing.destroy(new Error('App WebSocket upgrade exceeded 30 seconds')));
  outgoing.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (let [name, value] of Object.entries(response.headers)) socket.write(`${name}: ${value}\r\n`);
    socket.write('\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('close', () => upstreamSocket.destroy());
    upstreamSocket.on('close', () => socket.destroy());
  });
  outgoing.on('response', response => { response.resume(); socket.end(`HTTP/1.1 ${response.statusCode} Upgrade failed\r\nConnection: close\r\n\r\n`); });
  outgoing.on('error', () => socket.destroy());
  outgoing.end();
}
