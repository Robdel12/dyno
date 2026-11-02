import { readFile, stat } from 'node:fs/promises';
import { parseSchedule } from './schedule-model.js';

export async function readReplay(file) {
  if ((await stat(file)).size > 8_000_000) throw new Error('Replay schedule exceeds 8 MB.');
  return parseSchedule(JSON.parse(await readFile(file, 'utf8')));
}
