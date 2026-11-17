// Installed before framework code in every browser document by the local coverage preload.
export function collectBrowserCoverage({ buildId } = {}) {
  if (globalThis.__dynoSelfCollector) return;
  let token = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  let id = [token.slice(0, 8), token.slice(8, 12), token.slice(12, 16), token.slice(16, 20), token.slice(20)].join('-');
  let sequence = 0;
  let pending = false;
  let leaving = false;
  let changes = {};
  let pendingChanges = false;
  let failures = [];
  let terminalBytes = 0;
  let packet = (coverage, hashes) => JSON.stringify({ schemaVersion: 1, buildId, id, sequence: ++sequence, coverage, hashes });
  let recordFailure = message => {
    message += ` (${location.pathname}; document ${id})`;
    failures.push(message);
    try {
      let serialized = JSON.stringify({ schemaVersion: 1, buildId, id, sequence: ++sequence, coverage: {}, errors: [message] });
      globalThis.__dynoSelfCoverageBinding(serialized).catch(() => {});
      if (leaving && location.protocol.startsWith('http')) navigator.sendBeacon('/__dyno_self_coverage__', serialized);
    } catch {}
  };
  let deliver = serialized => {
    try {
      if (leaving && location.protocol.startsWith('http')) {
        terminalBytes += new TextEncoder().encode(serialized).length;
        if (terminalBytes > 49152) {
          recordFailure('Framework coverage exceeded its 48 KiB terminal delivery budget.');
          return;
        }
        if (!navigator.sendBeacon('/__dyno_self_coverage__', serialized))
          recordFailure('Framework coverage could not queue its final counters.');
      } else {
        return globalThis.__dynoSelfCoverageBinding(serialized).catch(error => {
          if (!leaving) recordFailure(`Framework coverage binding failed: ${error.message}`);
        });
      }
    } catch (error) { recordFailure(`Framework coverage delivery failed: ${error.message}`); }
  };
  let flush = () => {
    pending = false;
    let coverage = Object.fromEntries(Object.entries(globalThis.__dynoSelfCoverage).map(([path, file]) =>
      [path, { s: file.s, f: file.f, b: file.b }]));
    if (!Object.keys(coverage).length) return;
    let hashes = Object.fromEntries(Object.entries(globalThis.__dynoSelfCoverage).map(([path, file]) => [path, file.hash]));
    let serialized = packet(coverage, hashes);
    if (leaving && new TextEncoder().encode(serialized).length > 32768) {
      recordFailure('Framework coverage final counters exceed the 32 KiB packet budget.');
      return;
    }
    return deliver(serialized);
  };
  let changed = (path, field, key, value, index) => {
    if (leaving) {
      changes[path] ??= {};
      changes[path][field] ??= {};
      if (index === undefined) changes[path][field][key] = value;
      else {
        changes[path][field][key] ??= {};
        changes[path][field][key][index] = value;
      }
      if (!pendingChanges) {
        pendingChanges = true;
        queueMicrotask(() => {
          pendingChanges = false;
          let coverage = changes;
          changes = {};
          deliver(packet(coverage));
        });
      }
    } else if (!pending) {
      pending = true;
      queueMicrotask(flush);
    }
  };
  let observe = (value, path, field, key) => new Proxy(value, {
    set(target, index, value) {
      target[index] = value;
      changed(path, field, key ?? index, value, key === undefined ? undefined : index);
      return true;
    },
  });
  globalThis.__dynoSelfCoverage = new Proxy({}, {
    set(target, path, value) {
      value.s = observe(value.s, path, 's');
      value.f = observe(value.f, path, 'f');
      for (let [key, hits] of Object.entries(value.b)) value.b[key] = observe(hits, path, 'b', key);
      target[path] = value;
      if (!pending) { pending = true; queueMicrotask(flush); }
      return true;
    },
  });
  globalThis.__dynoSelfCollector = { flush, failures };
  addEventListener('pagehide', () => { leaving = true; flush(); });
  addEventListener('pageshow', () => { leaving = false; terminalBytes = 0; });
}
