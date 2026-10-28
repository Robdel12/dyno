import { join } from 'node:path';
import { homedir } from 'node:os';

export let browserNames = Object.freeze(['chrome', 'chromium', 'edge', 'firefox', 'safari', 'webkit']);

export function browserCandidates(name, system = process.platform, env = process.env) {
  let app = { chrome: 'Google Chrome', chromium: 'Chromium', edge: 'Microsoft Edge', firefox: 'Firefox', safari: 'Safari' }[name];
  let binary = { chrome: 'Google Chrome', chromium: 'Chromium', edge: 'Microsoft Edge', firefox: 'firefox' }[name];
  if (system === 'darwin') return [
    ...['/Applications', join(homedir(), 'Applications')].map(root => name === 'safari' ? join(root, `${app}.app`) : join(root, `${app}.app/Contents/MacOS`, binary))
  ];
  if (system === 'win32') {
    let suffix = { chrome: 'Google/Chrome/Application/chrome.exe', chromium: 'Chromium/Application/chrome.exe', edge: 'Microsoft/Edge/Application/msedge.exe', firefox: 'Mozilla Firefox/firefox.exe' }[name];
    return suffix ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map(root => join(root, suffix)) : [];
  }
  return { chrome: ['google-chrome', 'google-chrome-stable'], chromium: ['chromium', 'chromium-browser'], edge: ['microsoft-edge', 'microsoft-edge-stable'], firefox: ['firefox'], safari: [] }[name] ?? [];
}

export function browserArguments(name, { profile, headless, args = [], url }, system = process.platform) {
  if (name === 'firefox') return [
    ...args, '--no-remote', '--new-instance', '--profile', profile,
    ...(headless ? ['--headless'] : []), '--new-window', url
  ];
  return [
    ...(system === 'linux' ? ['--password-store=basic'] : []), ...args, ...(headless ? ['--headless=new'] : []), '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-field-trial-config',
    `--user-data-dir=${profile}`, '--window-size=1440,1080', url
  ];
}
