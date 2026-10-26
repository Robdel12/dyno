import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { startProcess } from './process.js';

export async function launchBrowser(url, { path, headless = true, args = [], onExit } = {}) {
  let candidates = path || process.env.CHROME_PATH ? [path ?? process.env.CHROME_PATH] : [
    ...(platform() === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'] : []),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  let executable;
  for (let candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('Chrome/Chromium not found. Set browser.path or CHROME_PATH, or use --manual and open the capture URL in any supported browser.');
  let profile = await mkdtemp(join(tmpdir(), 'dyno-'));
  let browser = startProcess(executable, { shell: false, args: [
    ...(headless ? ['--headless=new'] : []), '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    `--user-data-dir=${profile}`, '--window-size=1440,1080', ...args, url
  ] });
  let exited = () => onExit?.(browser.failure ?? new Error('Browser closed before tests completed.'));
  browser.child.once('exit', exited);
  browser.child.once('error', exited);
  return {
    async stop() {
      browser.child.removeListener('exit', exited);
      browser.child.removeListener('error', exited);
      await browser.stop();
      await rm(profile, { recursive: true, force: true });
    }
  };
}
