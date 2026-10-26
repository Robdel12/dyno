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
