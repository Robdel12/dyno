import { buildSuite } from './build.js';
import { installedBrowsers, browserChannel } from './browsers.js';
import { resolveSession } from './browser-session.js';

export async function diagnose(config, { manual = false, ui = false } = {}) {
  let checks = [{ name: 'config', status: 'passed', message: `Loaded ${config.file}` }];
  let check = async (name, inspect) => {
    try {
      checks = [...checks, { name, status: 'passed', message: await inspect() }];
    } catch (error) {
      checks = [...checks, { name, status: 'failed', message: error.message }];
    }
  };
  await check('tests', async () => `${(await buildSuite(config)).files.length} test file(s) bundle successfully`);
  if (manual)
    checks = [
      ...checks,
      {
        name: 'browser',
        status: 'info',
        message: 'URL-only mode: open the test URL in your browser. Screenshots and viewport resizing require a managed run.'
      }
    ];
  else
    await check('browser', async () => {
      let plan = await resolveSession(config.browser, { headless: !ui });
      if (plan.path) return `${plan.name} · Playwright · ${plan.path}`;
      if (browserChannel(plan.name)) return `${plan.name} · Playwright channel; installation is checked when the browser starts`;
      let installed = (await installedBrowsers()).find(browser => browser.name === plan.name);
      if (!installed?.installed) throw new Error(`Browser build is missing. Run dyno install --browser ${plan.name}.`);
      return `${plan.name} · Playwright · ${installed.path}`;
    });
  await check('app', async () => {
    let responding = false;
    try {
      await fetch(config.webServer.url, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
      responding = true;
    } catch {}
    if (responding && !config.webServer.reuseExistingServer)
      throw new Error(
        `The app already responds at ${config.webServer.url}. Stop it or set webServer.reuseExistingServer: true.`
      );
    if (responding) return `Will reuse ${config.webServer.url}`;
    if (!config.webServer.command) throw new Error('The app is not responding and webServer.command is missing.');
    return `Will start the app at ${config.webServer.url}; readiness is checked from process output and HTTP at startup.`;
  });
  return Object.freeze({
    ok: checks.every((check) => check.status !== 'failed'),
    checks: Object.freeze(checks.map((check) => Object.freeze(check)))
  });
}
