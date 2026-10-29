import { watch } from 'node:fs';
import { dirname, relative, isAbsolute, resolve, sep } from 'node:path';

export function createTestWatcher({ root, testDir, onChange, onError, ignoredPaths = [] }) {
  let handles = new Map();
  let closed = false;
  let dependencies = new Set();
  let inside = (parent, path) => {
    let name = relative(parent, path);
    return name === '' || (!name.startsWith('..' + sep) && name !== '..' && !isAbsolute(name));
  };
  let ignored = (path) =>
    ignoredPaths.some((directory) => !inside(directory, testDir) && inside(directory, path)) ||
    path.split(sep).some((part) => ['node_modules', '.git', '.dyno'].includes(part));
  let add = (directory, recursive) => {
    if (handles.has(directory)) return;
    let handle = watch(directory, { recursive }, (event, name) => {
      let file = name ? resolve(directory, String(name)) : directory;
      if (ignored(file)) return;
      if ((inside(testDir, file) && /\.[jt]sx?$/.test(file)) || dependencies.has(file) || !name) onChange(file);
    });
    handle.on('error', onError);
    handles.set(directory, handle);
  };
  add(testDir, true);
  return Object.freeze({
    track(inputs) {
      if (closed) return;
      dependencies = new Set(inputs.filter((file) => inside(root, file) && !ignored(file)));
      let needed = new Set([...dependencies].filter((file) => !inside(testDir, file)).map((file) => dirname(file)));
      for (let [directory, handle] of handles)
        if (directory !== testDir && !needed.has(directory)) {
          handle.close();
          handles.delete(directory);
        }
      for (let directory of needed) add(directory, false);
    },
    close() {
      closed = true;
      for (let handle of handles.values()) handle.close();
      handles.clear();
    }
  });
}

// Edits advance a revision. Build and run work consume revisions without overlapping.
export function createWatchState() {
  return Object.freeze({ run: 'idle', build: 'idle', revision: 0, published: 0 });
}
export function watchTransition(state, event) {
  switch (event.type) {
    case 'changed':
      return Object.freeze({ ...state, revision: state.revision + 1 });
    case 'running':
      return Object.freeze({ ...state, run: 'running' });
    case 'finished':
      return Object.freeze({ ...state, run: 'idle' });
    case 'building':
      return Object.freeze({ ...state, build: 'building' });
    case 'built':
      return Object.freeze({ ...state, build: 'idle' });
    case 'scheduled':
      return Object.freeze({ ...state, published: event.revision });
    case 'failed':
      return Object.freeze({ ...state, build: 'idle', published: event.revision ?? state.revision });
    default:
      throw new Error(`Unknown watch event: ${event.type}`);
  }
}
