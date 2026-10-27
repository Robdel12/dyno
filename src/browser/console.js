export function formatOutput(value) {
  let seen = new WeakSet();
  function format(item, depth) {
    if (typeof item === 'string') return item;
    if (typeof item === 'bigint') return `${item}n`;
    if (typeof item === 'function') return `[Function ${Object.getOwnPropertyDescriptor(item, 'name')?.value || 'anonymous'}]`;
    if (!item || typeof item !== 'object') return String(item);
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (item instanceof Error) return `Error: ${Object.getOwnPropertyDescriptor(item, 'message')?.value ?? ''}`;
    if (depth >= 2) return Array.isArray(item) ? '[Array]' : '[Object]';
    let entries = Object.keys(item).slice(0, 12).map(key => {
      let descriptor = Object.getOwnPropertyDescriptor(item, key);
      let text = descriptor && 'value' in descriptor ? format(descriptor.value, depth + 1) : '[Getter]';
      return Array.isArray(item) ? text : `${key}: ${text}`;
    });
    return Array.isArray(item) ? `[${entries.join(', ')}]` : `{${entries.join(', ')}}`;
  }
  try { return format(value, 0).slice(0, 2000); }
  catch { return '[Value could not be printed]'; }
}

export function captureConsole(target, receive) {
  let pending = [];
  let captured = 0;
  let scheduled = false;
  let flush = () => {
    scheduled = false;
    if (!pending.length) return;
    let entries = pending; pending = [];
    try { receive(entries); } catch {}
  };
  let restorers = ['log', 'info', 'warn', 'error', 'debug'].map(level => {
    let original = target[level];
    if (typeof original !== 'function') return () => {};
    let wrapped = (...args) => {
      // Diagnostics should never change the application console's behavior.
      try {
        if (captured < 100) {
          pending = [...pending, { level, text: args.map(formatOutput).join(' ').slice(0, 2000) }];
          captured++;
          if (!scheduled) { scheduled = true; queueMicrotask(flush); }
        }
      } catch {}
      return Reflect.apply(original, target, args);
    };
    target[level] = wrapped;
    return () => { if (target[level] === wrapped) target[level] = original; };
  });
  return () => { flush(); for (let restore of restorers) restore(); };
}
