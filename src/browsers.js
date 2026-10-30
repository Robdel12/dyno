import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright-core';

export let browserNames = Object.freeze(['chromium', 'firefox', 'webkit', 'chrome', 'edge']);

let engines = Object.freeze({ chromium, firefox, webkit });

export function browserEngine(name) {
  return engines[name] ?? (['chrome', 'edge'].includes(name) ? chromium : undefined);
}

export function browserChannel(name) {
  return { chrome: 'chrome', edge: 'msedge' }[name];
}

export async function installedBrowsers() {
  return Object.freeze(await Promise.all(Object.entries(engines).map(async ([name, engine]) => {
    let path = engine.executablePath();
    try {
      await access(path, constants.X_OK);
      return Object.freeze({ name, installed: true, path });
    } catch {
      return Object.freeze({ name, installed: false, path });
    }
  })));
}
