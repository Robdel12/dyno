import { buildSuite } from './build.js';
import { createTestWatcher, createWatchState, watchTransition } from './watch.js';

export function createWatchSession({ config, inputs, signal, reload, onStatus, onError }) {
  let state = createWatchState();
  let closed = false;
  let pending;
  let notify = (event) => { if (!closed && !signal.aborted) onStatus(event); };
  let ready = () => !closed && !signal.aborted && state.run === 'idle' &&
    state.build === 'idle' && state.revision !== state.published;
  let transition = (event) => { state = watchTransition(state, event); };
  let rebuild = async () => {
    let attempted = state.revision;
    transition({ type: 'building' });
    try {
      do {
        attempted = state.revision;
        notify({ status: 'building', revision: attempted });
        let updated = await buildSuite(config);
        if (closed || signal.aborted) return;
        watcher.track(updated.inputs);
        transition({ type: 'built' });
        if (state.revision !== attempted) transition({ type: 'building' });
      } while (state.build === 'building');
    } catch (error) {
      if (closed || signal.aborted) return;
      transition({ type: 'failed', revision: attempted });
      notify({ status: 'error', message: error.message });
      return;
    }
    if (state.run === 'running') {
      notify({ status: 'queued', message: 'Test edits queued until this run finishes.' });
      return;
    }
    transition({ type: 'scheduled', revision: attempted });
    try {
      if (reload()) transition({ type: 'running' });
      notify({ status: 'watching', message: 'Tests updated. Waiting for the browser to run them.' });
    } catch (error) {
      notify({ status: 'error', message: `Tests rebuilt, but the browser could not reload: ${error.message}. Reopen the test URL.` });
    }
  };
  let requestBuild = () => {
    if (pending || !ready()) return;
    pending = rebuild().catch(onError).finally(() => {
      pending = undefined;
      requestBuild();
    });
  };
  let watcher = createTestWatcher({
    root: config.root, testDir: config.testDir,
    ignoredPaths: [config.reportDir, config.artifactsDir],
    onError: (error) => { notify({ status: 'error', message: error.message }); onError(error); },
    onChange: () => {
      if (closed || signal.aborted) return;
      transition({ type: 'changed' });
      notify({
        status: state.run === 'running' ? 'queued' : 'changed', revision: state.revision,
        message: state.run === 'running' ? 'Test edits queued until this run finishes.' : 'Test files changed.'
      });
      requestBuild();
    }
  });
  try { watcher.track(inputs); }
  catch (error) { watcher.close(); throw error; }
  notify({ status: 'watching', message: 'Watching tests and imported project helpers.' });
  return Object.freeze({
    observe(event) {
      if (closed || signal.aborted) return;
      if (event.type === 'capture') transition({ type: 'running' });
      if (['complete', 'fatal'].includes(event.type)) {
        transition({ type: 'finished' });
        requestBuild();
      }
    },
    async close() {
      closed = true;
      watcher.close();
      await pending;
    }
  });
}
