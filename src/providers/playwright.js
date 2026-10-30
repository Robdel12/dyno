import { browserChannel, browserEngine } from '../browsers.js';

export async function open(plan, viewport, onExit) {
  let engine = browserEngine(plan.name);
  let context = await engine.launchPersistentContext(plan.profile, {
    headless: plan.headless,
    args: plan.args,
    viewport,
    deviceScaleFactor: plan.deviceScaleFactor ?? 1,
    timeout: 30000,
    ...(plan.path
      ? { executablePath: plan.path }
      : browserChannel(plan.name)
        ? { channel: browserChannel(plan.name) }
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
        build: plan.path ? 'custom' : browserChannel(plan.name) ? 'installed' : 'playwright'
      }),
      open: (url) => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
      activate: () => page.bringToFront(),
      resize: async (size) => {
        await page.bringToFront();
        await page.setViewportSize(size);
      },
      capture: ({ fullPage = false } = {}) =>
        page.screenshot({
          type: 'png',
          animations: 'allow',
          caret: 'initial',
          scale: 'device',
          fullPage,
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
