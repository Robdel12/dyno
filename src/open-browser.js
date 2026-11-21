import { spawn } from 'node:child_process';

// The command that hands a URL to the person's default browser.
export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url.replaceAll('&', '^&')]];
  return ['xdg-open', [url]];
}

// Opens the URL without waiting on the browser. Failures are reported, never thrown:
// the run continues and the printed URL still works.
export function openInBrowser(url, { onError = () => {}, platform = process.platform } = {}) {
  let [command, args] = browserCommand(url, platform);
  try {
    let child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', onError);
    child.unref();
  } catch (error) {
    onError(error);
  }
}
