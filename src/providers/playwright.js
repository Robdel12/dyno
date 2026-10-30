import { browserChannel, browserEngine } from '../browsers.js';
import { nativeCapabilities } from '../native.js';
import { createNative } from './native.js';

export async function open(plan, viewport, onExit) {
  let engine = browserEngine(plan.name);
  let context = await engine.launchPersistentContext(plan.profile, {
    headless: plan.headless,
    args: plan.args,
    viewport,
    deviceScaleFactor: plan.deviceScaleFactor ?? 1,
    // Match Playwright's BiDi defaults: the companion's Interactor timers must
    // keep running while native input activates the app page.
    ...(plan.name === 'firefox'
      ? {
          firefoxUserPrefs: {
            'dom.min_background_timeout_value': 0,
            'dom.min_background_timeout_value_without_budget_throttling': 0,
            'dom.timeout.enable_budget_timer_throttling': false,
          },
        }
      : {}),
    timeout: 30000,
    ...(plan.locale ? { locale: plan.locale } : {}),
    ...(plan.timezoneId ? { timezoneId: plan.timezoneId } : {}),
    ...(plan.path
      ? { executablePath: plan.path }
      : browserChannel(plan.name)
        ? { channel: browserChannel(plan.name) }
        : {}),
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
    let stop = () => {
      closing = true;
      return context.close();
    };
    let native = createNative({
      context,
      page,
      capabilities: nativeCapabilities(plan.name),
      close: stop,
    });
    return Object.freeze({
      identity: Object.freeze({
        provider: 'playwright',
        name: plan.name,
        version: browser.version(),
        build: plan.path ? 'custom' : browserChannel(plan.name) ? 'installed' : 'playwright',
      }),
      open: (url) => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
      activate: () => page.bringToFront(),
      resize: async (size) => {
        await page.bringToFront();
        await page.setViewportSize(size);
      },
      capture: ({ fullPage = false, clip } = {}) =>
        page.screenshot({
          type: 'png',
          animations: 'allow',
          caret: 'initial',
          scale: 'device',
          fullPage: clip ? true : fullPage,
          ...(clip ? { clip } : {}),
          timeout: 15000,
        }),
      native: native.native,
      cancelNative: native.cancelNative,
      resetNative: native.resetNative,
      stop,
    });
  } catch (error) {
    await context.close();
    throw error;
  }
}
