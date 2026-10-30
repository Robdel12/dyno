import { buildSuite } from './build.js';
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
        message: 'URL-only mode: open the test URL in your browser. Screenshots need an optional provider.'
      }
    ];
  else
    await check('browser', async () => {
      let plan = await resolveSession(config.browser, { headless: !ui });
      return `${config.browser.name} · ${config.browser.provider} · ${plan.path ?? 'provider-managed build'}`;
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
