import { browserChannel, chromiumFamily } from '../browsers.js';
import { nativeCapabilities } from '../native.js';
import { createNative } from './native.js';
import { createChromiumCapture } from './chromium-capture.js';
import { createEmulation } from './chromium-emulation.js';

// A context that fails to become a worker window is closed, not left open.
async function closingOnFailure(context, work) {
  try { return await work(); }
  catch (error) {
    await context.close();
    throw error;
  }
}

// Only finding a new context's CDP ID runs one at a time: it diffs the
// browser's context IDs. Windows then open for each worker in parallel.
let identifying = Promise.resolve();
function identifiedContext(browser, cdp, options) {
  let ids = async () => (await cdp.send('Target.getBrowserContexts')).browserContextIds;
  let work = identifying.then(async () => {
    let known = new Set(await ids());
    let context = await browser.newContext(options);
    return closingOnFailure(context, async () => ({ context, id: (await ids()).find(value => !known.has(value)) }));
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
    return await closingOnFailure(context, async () => {
      if (!id) throw new Error('Could not find the new browser context.');
      let [page] = await Promise.all([
        context.waitForEvent('page'),
        cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: id, newWindow: true, background: true }),
      ]);
      return { context, page };
    });
  } finally { await cdp.detach(); }
}

async function plainWindow(browser, options) {
  let context = await browser.newContext(options);
  return closingOnFailure(context, async () => ({ context, page: context.pages()[0] ?? await context.newPage() }));
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
    // Visible Chromium windows scale an oversized viewport down to fit the screen.
    let emulation = chromium ? createEmulation({ context, plan, fit: !plan.headless }) : undefined;
    let chromiumCapture = emulation ? createChromiumCapture({ page, plan, close: stop, emulation }) : undefined;
    await emulation?.apply(page);
    // The companion window runs each run's controller. It's opened once and
    // reused: opening a window takes focus, navigating an existing one doesn't.
    let companion;
    let liveCompanions = () => companion && !companion.isClosed() ? [companion] : [];
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
        if (starter && liveCompanions().length) {
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
          await emulation?.apply(companion, page.viewportSize());
        }
      },
      activate: raise,
      // Show app: the person asked to see this worker's app, so bring its tab
      // and window forward in every engine.
      reveal: () => page.bringToFront(),
      retire: async (url) => {
        // Keep the app's browsing context (including sessionStorage), but end
        // its old document and every companion/test document before handoff.
        // The companion window stays open on a blank page for the next run.
        if (url !== new URL('/__dyno__/blank', page.url()).href)
          throw new Error('Retire requires the owned app gateway blank URL.');
        let blank = (candidate) => candidate.goto(url, { waitUntil: 'load', timeout: 15000 });
        // Restart tests reloads the controller itself, and that reload can cancel ours. Closing the
        // companion still ends its document; the next run opens a new one.
        let companionBlank = async (candidate) => {
          try { await blank(candidate); }
          catch { await candidate.close(); }
        };
        let others = context.pages().filter((candidate) => candidate !== page && candidate !== companion);
        let results = await Promise.allSettled([
          ...others.map((candidate) => candidate.close()),
          ...liveCompanions().map(companionBlank),
          blank(page),
        ]);
        let failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
        if (failures.length)
          throw new AggregateError(failures, `Could not retire browser documents: ${failures.map((failure) => failure.message).join('; ')}`);
      },
      resize: async (size) => {
        await raise();
        await page.setViewportSize(size);
        let viewport = { width: size.width, height: size.height };
        await Promise.all([page, ...liveCompanions()].map((target) => emulation?.apply(target, viewport)));
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
