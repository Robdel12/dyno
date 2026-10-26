import { access, stat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';
import { startProcess } from './process.js';
import { browserNames, browserCandidates, browserArguments } from './browsers.js';

async function executable(candidate, name) {
  let choices = candidate.includes('/') || candidate.includes('\\') ? [resolve(candidate)] : (process.env.PATH ?? '').split(delimiter).flatMap(root => {
    let base = join(root, candidate);
    return process.platform === 'win32' ? [base, ...['.exe', '.cmd'].map(extension => base + extension)] : [base];
  });
  for (let path of choices) {
    try {
      let entry = await stat(path);
      if (name === 'safari' ? !entry.isDirectory() : !entry.isFile()) continue;
      await access(path, name === 'safari' ? constants.R_OK : constants.X_OK);
      return path;
    } catch {}
  }
}

export async function resolveBrowser({ name = 'chrome', path, args = [] } = {}, { headless = true } = {}) {
  if (!browserNames.includes(name)) throw new Error(`Unknown browser "${name}". Choose ${browserNames.join(', ')}.`);
  if (name === 'safari' && process.platform !== 'darwin') throw new Error('Safari launching is available on macOS. Use --manual for another device.');
  if (name === 'safari' && headless) throw new Error('Safari has no headless launcher. Use --browser safari --ui, or --manual.');
  if (name === 'safari' && args.length) throw new Error('Safari URL handoff does not accept browser.args.');
  let override = path ?? process.env[`${name.toUpperCase()}_PATH`];
  let candidates = override ? [override] : browserCandidates(name);
  for (let candidate of candidates) {
    let path = await executable(candidate, name);
    if (path) return Object.freeze({ name, path, args: Object.freeze([...args]), headless, isolated: name !== 'safari' });
  }
  throw new Error(`${name} not found or not executable${override ? `: ${override}` : ''}. Set browser.path or ${name.toUpperCase()}_PATH, run dyno browsers, or use --manual.`);
}

export async function installedBrowsers() {
  return Promise.all(browserNames.map(async name => {
    try {
      let browser = await resolveBrowser({ name }, { headless: false });
      return { name, installed: true, path: browser.path, headless: name !== 'safari', isolated: browser.isolated };
    } catch { return { name, installed: false, headless: name !== 'safari', isolated: name !== 'safari' }; }
  }));
}

export async function launchBrowser(url, { resolved, onExit, signal, ...options } = {}) {
  let plan = resolved ?? await resolveBrowser(options, { headless: options.headless ?? true });
  signal?.throwIfAborted();
  if (!plan.isolated) {
    let opener = startProcess('/usr/bin/open', { shell: false, signal, args: ['-a', plan.path, url] });
    try {
      await opener.ready;
      let result = await opener.closed;
      if (result.code !== 0) throw opener.failure;
      signal?.throwIfAborted();
      return Object.freeze({ name: plan.name, isolated: false, stop: async () => {} });
    } finally { await opener.stop(); }
  }
  let profile = await mkdtemp(join(tmpdir(), `dyno-${plan.name}-`));
  let browser;
  let exited;
  let stopping;
  let stop = () => stopping ??= (async () => {
    browser?.child.removeListener('exit', exited);
    browser?.child.removeListener('error', exited);
    try { await browser?.stop(); }
    finally { await rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
  })();
  try {
    if (plan.name === 'firefox') await writeFile(join(profile, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("browser.aboutwelcome.enabled", false);',
      'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);'
    ].join('\n'));
    signal?.throwIfAborted();
    browser = startProcess(plan.path, { shell: false, signal, args: browserArguments(plan.name, { ...plan, profile, url }) });
    exited = () => {
      let help = plan.name === 'firefox' && process.platform === 'darwin' && browser.logs.includes('Could not find profile folder')
        ? '\nFirefox 157 and earlier can fail on macOS 27 before opening an isolated profile. Use Firefox 158+ or --manual; see docs/browsers.md.' : '';
      onExit?.(new Error(`${plan.name} closed before the run finished. ${browser.failure?.message ?? ''}\n${browser.logs}${help}`.trim()));
    };
    browser.child.once('exit', exited);
    browser.child.once('error', exited);
    await browser.ready;
    signal?.throwIfAborted();
    if (browser.failure) throw browser.failure;
    return Object.freeze({ name: plan.name, isolated: true, stop, get logs() { return browser.logs; } });
  } catch (error) { await stop(); throw error; }
}
