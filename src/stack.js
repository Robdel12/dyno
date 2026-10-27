import { resolve } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

export function mapStack(stack, sourceMap, root) {
  if (!stack || !sourceMap) return stack;
  let trace = new TraceMap(sourceMap);
  return stack.replace(/https?:\/\/[^\s)]+\/__dyno__\/suite\.js(?:\?[^\s):]*)?:(\d+):(\d+)/g, (match, line, column) => {
    let original = originalPositionFor(trace, { line: Number(line), column: Number(column) - 1 });
    return original.source ? `${resolve(root, original.source)}:${original.line}:${original.column + 1}` : match;
  });
}

// Source text comes from this run's bundle, never from an arbitrary file path.
export function sourceContext(error, bundle, root) {
  if (!bundle?.map) return;
  for (let stack of [error.stack, error.declaration]) {
    for (let line of stack?.split('\n') ?? []) {
      for (let file of bundle.files) {
        let path = resolve(root, file);
        let offset = line.indexOf(path + ':');
        if (offset < 0) continue;
        let position = /^(\d+):(\d+)/.exec(line.slice(offset + path.length + 1));
        if (!position) continue;
        let index = bundle.map.sources.findIndex(source => resolve(root, source) === path);
        let text = bundle.map.sourcesContent?.[index];
        if (typeof text !== 'string') continue;
        let number = Number(position[1]);
        let startLine = Math.max(1, number - 2);
        let code = text.split('\n').slice(startLine - 1, number + 2).map(line => line.slice(0, 2000)).join('\n');
        return { file, line: number, column: Number(position[2]), startLine, code };
      }
    }
  }
}
