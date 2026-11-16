let packetLimit = 8_000_000;
let pendingLimit = 32_000_000;
let documentLimit = 10_000;
let bytes = (value) => new TextEncoder().encode(value).byteLength;
let errorMessage = (error) => `Coverage collection failed: ${error?.message ?? String(error)}`.slice(0, 1000);

export function createAppCoverage(appWindow, controller, binding, documentId) {
  let sequence = 0;
  let identity = { runId: binding.runId, executionId: binding.executionId, documentId };
  return Object.freeze({
    register() {
      controller.__dynoCoverage.receive(appWindow, { kind: 'register', ...identity });
    },
    snapshot() {
      let packet = { ...identity, sequence: ++sequence, coverage: {} };
      try {
        packet.coverage = JSON.parse(JSON.stringify(appWindow.__coverage__ ?? {}));
      } catch (error) {
        packet.error = errorMessage(error);
      }
      controller.__dynoCoverage.receive(appWindow, { kind: 'snapshot', ...packet });
    },
  });
}

export function createBrowserCoverage({ appWindow, runId, origin, post, execution }) {
  let documents = new Map();
  let pending = new Map();
  let pendingBytes = 0;
  let inFlightBytes = 0;
  let publishing;
  let failure;
  let closed = false;
  let owned = (source, input) => {
    try {
      return !closed && source === appWindow && source.location.origin === origin &&
        input?.runId === runId && typeof input.executionId === 'string' &&
        typeof input.documentId === 'string' && input.documentId.length > 0 &&
        source.__browserTestBridge?.id === input.documentId;
    } catch { return false; }
  };
  let queue = (input) => {
    let packet = {
      runId,
      executionId: input.executionId,
      documentId: input.documentId,
      sequence: input.sequence,
      coverage: input.coverage,
      ...(input.error ? { error: input.error } : {}),
    };
    let size;
    try {
      size = bytes(JSON.stringify(packet));
      if (size > packetLimit) throw new Error('A coverage snapshot exceeds the 8 MB limit.');
      let previous = pending.get(input.documentId)?.bytes ?? 0;
      if (pendingBytes + inFlightBytes - previous + size > pendingLimit - 4096)
        throw new Error('Pending coverage exceeds the 32 MB limit.');
    } catch (error) {
      packet = { ...packet, coverage: {}, error: errorMessage(error) };
      size = bytes(JSON.stringify(packet));
    }
    let previous = pending.get(input.documentId)?.bytes ?? 0;
    pending.set(input.documentId, { packet, bytes: size });
    pendingBytes += size - previous;
    if (packet.error) failure ??= new Error(packet.error);
  };
  let flush = () => {
    if (publishing) return publishing;
    publishing = (async () => {
      while (pending.size) {
        let [documentId, next] = pending.entries().next().value;
        pending.delete(documentId);
        pendingBytes -= next.bytes;
        inFlightBytes = next.bytes;
        try {
          await post('coverage', next.packet);
        } catch (error) {
          failure ??= new Error(`Could not save coverage: ${error.message}`);
          throw failure;
        } finally { inFlightBytes = 0; }
      }
      if (failure) throw failure;
    })().finally(() => { publishing = undefined; });
    return publishing;
  };
  return Object.freeze({
    receive(source, input) {
      if (!owned(source, input)) return;
      if (input.kind === 'register') {
        if (input.executionId !== execution() || documents.has(input.documentId)) return;
        if (documents.size >= documentLimit) {
          failure ??= new Error('Coverage collection exceeds the 10,000 document limit.');
          return;
        }
        documents.set(input.documentId, { executionId: input.executionId, sequence: 0 });
        return;
      }
      let document = documents.get(input.documentId);
      let currentExecution = execution();
      if (input.kind !== 'snapshot' || !document || input.executionId !== document.executionId ||
        (currentExecution && input.executionId !== currentExecution) || !Number.isSafeInteger(input.sequence) ||
        input.sequence <= document.sequence || failure) return;
      document.sequence = input.sequence;
      queue(input);
      // Persist navigation snapshots while the test continues. The boundary
      // flush still observes any failure from this background delivery.
      void flush().catch(() => {});
    },
    snapshot() {
      if (closed) return;
      try { appWindow.__browserTestBridge?.snapshotCoverage?.(); }
      catch (error) { failure ??= new Error(errorMessage(error)); }
    },
    flush,
    close() {
      closed = true;
      documents.clear();
      pending.clear();
      pendingBytes = 0;
    },
  });
}
