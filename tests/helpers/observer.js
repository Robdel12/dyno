import assert from 'node:assert/strict';
import { acceptObserverFrame } from '../../src/browser/reporting.js';

export async function observeRun(t, url) {
  let abort = new AbortController();
  let response = await fetch(url, { signal: AbortSignal.any([t.signal, abort.signal]) });
  assert.equal(response.status, 200);
  let reader = response.body.getReader(), decoder = new TextDecoder(), pending = '', observed;
  let close = async () => { abort.abort(); await reader.cancel().catch(() => {}); };
  let phases = [];
  t.after(close);
  return {
    close, phases,
    async until(predicate) {
      while (true) {
        let end;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          let frame = pending.slice(0, end); pending = pending.slice(end + 2);
          let kind = /^event: (.+)$/m.exec(frame)?.[1], data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!data || !['view-start', 'view-tests', 'snapshot', 'view-change'].includes(kind)) continue;
          observed = acceptObserverFrame(observed, kind, JSON.parse(data));
          if (!observed.pending) {
            phases.push(observed.view.phase);
            if (predicate(observed.view)) return observed.view;
          }
        }
        let chunk = await reader.read();
        assert.equal(chunk.done, false, 'Reporter disconnected before the requested state.');
        pending += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}
