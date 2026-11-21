import { relative, isAbsolute, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metrics } from '../coverage-model.js';

// Pure text helpers shared by the terminal and LLM reporters. Inputs are
// events; outputs are strings. Nothing here writes to a stream.

let packageRoot = fileURLToPath(new URL('../../', import.meta.url));
let identity = (format, text) => text;

export let plural = (count, word, many = word + 's') => `${count} ${count === 1 ? word : many}`;

// Paths inside the working directory read better relative. Others stay absolute.
export function displayPath(path, cwd) {
  if (!path || !isAbsolute(path)) return path;
  let relativePath = relative(cwd, path);
  return relativePath && !relativePath.startsWith('..' + sep) && relativePath !== '..' ? relativePath : path;
}

// "2 failed, 3 passed, 1 skipped": failures first, zero counts left out.
export function tally({ failed = 0, passed = 0, skipped = 0, notRun = 0 }, paint = identity) {
  return [
    failed ? paint('red', `${failed} failed`) : '', paint('green', `${passed} passed`),
    skipped ? paint('dim', `${skipped} skipped`) : '', notRun ? paint('dim', `${notRun} not run`) : '',
  ].filter(Boolean).join(', ');
}

export let errorsOf = test => [test.error, ...(test.additionalErrors ?? [])].filter(Boolean);

// Keep the frames that point at project code, in V8 (`at fn (file)`) or
// Firefox and WebKit (`fn@file`) form. Dyno's runtime, Interactor, and browser
// internals only add noise. The coordinator appends the test declaration after
// "Declared at:"; the code frame already covers it.
function projectFrames(stack, cwd, limit = 5) {
  if (!stack) return [];
  return stack.split('\nDeclared at:')[0].split('\n')
    .filter(line => /^\s+at\s/.test(line) || /^[^\s]*@.+:\d+:\d+$/.test(line))
    .filter(line => !line.includes(packageRoot) && !/<anonymous>|node:internal|\/__dyno__\//.test(line))
    .map(line => line.trim().replaceAll(cwd.endsWith(sep) ? cwd : cwd + sep, ''))
    .slice(0, limit);
}

// Stack frames are worth printing when they say more than the source location.
export function extraFrames(error, cwd, location) {
  let frames = projectFrames(error.stack, cwd);
  return frames.length === 1 && location && frames[0].includes(location) ? [] : frames;
}

// Two lines before the failing line and one after, with the shared indent
// removed so the code sits flush and the caret still lands on the column.
export function codeFrame(source, { mark = text => text, dim = text => text, before = 2, after = 1 } = {}) {
  if (!source?.code) return [];
  let rows = source.code.replace(/\n$/, '').split('\n')
    .map((text, index) => ({ number: source.startLine + index, text }))
    .filter(row => row.number >= source.line - before && row.number <= source.line + after);
  if (!rows.some(row => row.number === source.line)) return [];
  while (rows.length > 1 && !rows[0].text.trim()) rows = rows.slice(1);
  while (rows.length > 1 && !rows.at(-1).text.trim()) rows = rows.slice(0, -1);
  let shared = Math.min(...rows.filter(row => row.text.trim()).map(row => row.text.match(/^\s*/)[0].length));
  let width = String(rows.at(-1).number).length;
  return rows.flatMap(({ number, text }) => {
    let code = text.slice(shared, shared + 160);
    if (number !== source.line) return [dim(`  ${String(number).padStart(width)} | ${code}`)];
    let column = Math.max(0, source.column - 1 - shared);
    return [mark(`> ${String(number).padStart(width)} | ${code}`), dim(`  ${' '.repeat(width)} | ${' '.repeat(column)}^`)];
  });
}

export let codeLanguage = file => ({ '.ts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js' })[extname(file ?? '')] ?? 'js';

export let browserName = browser => browser
  ? `${browser.name[0].toUpperCase()}${browser.name.slice(1)}${browser.version ? ' ' + browser.version.split('.')[0] : ''}`
  : '';

export let coverageText = summary =>
  metrics.filter(name => summary?.[name]).map(name => `${summary[name].pct}% ${name}`).join(', ');

export let coverageScope = coverage => coverage.scope === 'all-files' ? 'all included files' : 'loaded files';

export function attachmentText(attachment, cwd) {
  return attachment.status === 'captured'
    ? `Screenshot "${attachment.name}" saved to ${displayPath(attachment.path, cwd)}`
    : `Screenshot "${attachment.name}" skipped (${attachment.reason})`;
}
