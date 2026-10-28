import { chromium, firefox, webkit } from 'playwright-core';

export async function open(plan, viewport, onExit) {
  let engine = { chrome: chromium, edge: chromium, chromium, firefox, webkit }[plan.name];
  let context = await engine.launchPersistentContext(plan.profile, {
    headless: plan.headless,
    args: plan.args,
    viewport,
    deviceScaleFactor: plan.deviceScaleFactor ?? 1,
    timeout: 30000,
    ...(plan.path
      ? { executablePath: plan.path }
      : ['chrome', 'edge'].includes(plan.name)
        ? { channel: plan.name === 'edge' ? 'msedge' : 'chrome' }
        : {})
  });
  try {
    let browser = context.browser();
    let page = context.pages()[0] ?? (await context.newPage());
    let closing = false;
    let disconnected = () => {
      if (!closing) onExit?.();
    };
    browser.on('disconnected', disconnected);
    page.on('close', disconnected);
    page.setDefaultTimeout(15000);
    return Object.freeze({
      identity: Object.freeze({
        provider: 'playwright',
        name: plan.name,
        version: browser.version(),
        build: plan.path ? 'custom' : ['chromium', 'firefox', 'webkit'].includes(plan.name) ? 'playwright' : 'installed'
      }),
      open: (url) => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
      resize: (size) => page.setViewportSize(size),
      capture: () =>
        page.screenshot({
          type: 'png',
          animations: 'allow',
          caret: 'initial',
          scale: 'device',
          fullPage: false,
          timeout: 15000
        }),
      stop: () => {
        closing = true;
        return context.close();
      }
    });
  } catch (error) {
    await context.close();
    throw error;
  }
}
