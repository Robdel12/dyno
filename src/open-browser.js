import { spawn } from 'node:child_process';

// The command that hands a URL to the person's default browser.
function browserCommand(url) {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '""', url.replaceAll('&', '^&')]];
  return ['xdg-open', [url]];
}

// Opens the URL without waiting on the browser. Failures are reported, never thrown:
// the run continues and the printed URL still works.
export function openInBrowser(url, { onError = () => {} } = {}) {
  let [command, args] = browserCommand(url);
  try {
    let child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', onError);
    child.unref();
  } catch (error) {
    onError(error);
  }
}
