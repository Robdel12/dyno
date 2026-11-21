import { browserChannel, chromiumFamily } from '../browsers.js';
import { nativeCapabilities } from '../native.js';
import { createNative } from './native.js';
import { createChromiumCapture } from './chromium-capture.js';

// Only finding a new context's CDP ID runs one at a time: it diffs the
// browser's context IDs. Windows then open for each worker in parallel.
let identifying = Promise.resolve();
function identifiedContext(browser, cdp, options) {
  let ids = async () => (await cdp.send('Target.getBrowserContexts')).browserContextIds;
  let work = identifying.then(async () => {
    let known = new Set(await ids());
    let context = await browser.newContext(options);
    try { return { context, id: (await ids()).find(value => !known.has(value)) }; }
    catch (error) {
      await context.close();
      throw error;
    }
  });
  identifying = work.catch(() => {});
  return work;
}

// Visible Chromium windows take focus from whatever the person is doing when
// Playwright opens them. A window created over CDP with `background: true`
// doesn't, so headed Chromium workers open that way.
async function backgroundWindow(browser, options) {
  let cdp = await browser.newBrowserCDPSession();
  try {
    let { context, id } = await identifiedContext(browser, cdp, options);
    try {
      if (!id) throw new Error('Could not find the new browser context.');
      let [page] = await Promise.all([
        context.waitForEvent('page'),
        cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: id, newWindow: true, background: true }),
      ]);
      return { context, page };
    } catch (error) {
      await context.close();
      throw error;
    }
  } finally { await cdp.detach(); }
}

async function plainWindow(browser, options) {
  let context = await browser.newContext(options);
  try { return { context, page: context.pages()[0] ?? await context.newPage() }; }
  catch (error) {
    await context.close();
    throw error;
  }
}

export async function open(browser, plan, viewport, onExit, onDiagnostic = () => {}) {
  let chromium = chromiumFamily(plan.name);
  let options = {
    viewport,
    deviceScaleFactor: plan.deviceScaleFactor ?? 1,
    ...(plan.locale ? { locale: plan.locale } : {}),
    ...(plan.timezoneId ? { timezoneId: plan.timezoneId } : {}),
    ...(plan.isMobile !== undefined ? { isMobile: plan.isMobile } : {}),
    ...(plan.hasTouch !== undefined ? { hasTouch: plan.hasTouch } : {}),
    ...(plan.userAgent !== undefined ? { userAgent: plan.userAgent } : {}),
  };
  let { context, page } = chromium && !plan.headless
    ? await backgroundWindow(browser, options) : await plainWindow(browser, options);
  try {
    context.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/__dyno__/stream')
        onDiagnostic(`Controller event stream: ${request.failure()?.errorText ?? 'request failed'}`);
    });
    let closing = false;
    let disconnected = () => {
      if (!closing) onExit?.();
    };
    page.on('close', disconnected);
    page.setDefaultTimeout(15000);
    let stop = async () => {
      closing = true;
      await context.close();
    };
    // Chromium renders, captures, and takes input in a background tab, so it
    // never needs to raise the window. Other engines still bring the app forward.
    let raise = chromium ? async () => {} : () => page.bringToFront();
    let native = createNative({
      context,
      page,
      capabilities: nativeCapabilities(plan.name),
      close: stop,
      raise,
    });
    let chromiumCapture = chromium
      ? createChromiumCapture({ context, page, plan, close: stop }) : undefined;
    // The companion window runs each run's controller. It's opened once and
    // reused: opening a window takes focus, navigating an existing one doesn't.
    let companion;
    return Object.freeze({
      identity: Object.freeze({
        provider: 'playwright',
        name: plan.name,
        version: browser.version(),
        build: plan.path ? 'custom' : browserChannel(plan.name) ? 'installed' : 'playwright',
      }),
      open: async (address) => {
        let url = new URL(address);
        let starter = url.pathname === '/__dyno__/';
        if (starter) {
          let fragment = new URLSearchParams(url.hash.slice(1));
          fragment.set('start', 'managed');
          url.hash = fragment.toString();
        }
        if (starter && companion && !companion.isClosed()) {
          // The controller keeps its window name and its opener, the app window.
          let controller = new URL(url);
          controller.pathname = '/__dyno__/controller';
          await companion.goto(controller.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return;
        }
        let deadline = Date.now() + 30000;
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (starter) {
          let timeout = Math.max(1, deadline - Date.now());
          // Acknowledge the companion's creation without waiting for app
          // navigations that the browser-local tests may immediately start.
          [companion] = await Promise.all([
            page.waitForEvent('popup', { timeout }),
            page.getByRole('button', { name: 'Start tests', exact: true }).press('Enter', { timeout, noWaitAfter: true }),
          ]);
        }
      },
      activate: raise,
      retire: async (url) => {
        // Keep the app's browsing context (including sessionStorage), but end
        // its old document and every companion/test document before handoff.
        // The companion window stays open on a blank page for the next run.
        if (url !== new URL('/__dyno__/blank', page.url()).href)
          throw new Error('Retire requires the owned app gateway blank URL.');
        let others = context.pages().filter((candidate) => candidate !== page && candidate !== companion);
        let reused = companion && !companion.isClosed() ? [companion] : [];
        let results = await Promise.allSettled([
          ...others.map((candidate) => candidate.close()),
          ...[...reused, page].map((candidate) => candidate.goto(url, { waitUntil: 'load', timeout: 15000 })),
        ]);
        let failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Could not retire browser documents.');
      },
      resize: async (size) => {
        await raise();
        await page.setViewportSize(size);
        await chromiumCapture?.resize(size);
      },
      capture: ({ fullPage = false, clip } = {}) => {
        if (chromiumCapture && (fullPage || clip)) return chromiumCapture.capture({ clip });
        return page.screenshot({
          type: 'png',
          animations: 'allow',
          caret: 'initial',
          scale: 'device',
          fullPage: clip ? true : fullPage,
          ...(clip ? { clip } : {}),
          timeout: 15000,
        });
      },
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
