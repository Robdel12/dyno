import { browserChannel } from '../browsers.js';
import { nativeCapabilities } from '../native.js';
import { createNative } from './native.js';

export async function open(browser, plan, viewport, onExit, onDiagnostic = () => {}) {
  let context = await browser.newContext({
    viewport,
    deviceScaleFactor: plan.deviceScaleFactor ?? 1,
    ...(plan.locale ? { locale: plan.locale } : {}),
    ...(plan.timezoneId ? { timezoneId: plan.timezoneId } : {}),
  });
  try {
    context.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/__dyno__/stream')
        onDiagnostic(`Controller event stream: ${request.failure()?.errorText ?? 'request failed'}`);
    });
    let page = context.pages()[0] ?? (await context.newPage());
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
      open: async (address) => {
        let url = new URL(address);
        let starter = url.pathname === '/__dyno__/';
        if (starter) {
          let fragment = new URLSearchParams(url.hash.slice(1));
          fragment.set('start', 'managed');
          url.hash = fragment.toString();
        }
        let deadline = Date.now() + 30000;
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (starter) {
          let timeout = Math.max(1, deadline - Date.now());
          // Acknowledge the companion's creation without waiting for app
          // navigations that the browser-local tests may immediately start.
          await Promise.all([
            page.waitForEvent('popup', { timeout }),
            page.getByRole('button', { name: 'Start tests', exact: true }).press('Enter', { timeout, noWaitAfter: true }),
          ]);
        }
      },
      activate: () => page.bringToFront(),
      retire: async (url) => {
        // Keep the app's browsing context (including sessionStorage), but end
        // its old document and every companion/test document before handoff.
        if (url !== new URL('/__dyno__/blank', page.url()).href)
          throw new Error('Retire requires the owned app gateway blank URL.');
        let results = await Promise.allSettled(context.pages().filter((candidate) => candidate !== page).map((candidate) => candidate.close()));
        let failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
        try { await page.goto(url, { waitUntil: 'load', timeout: 15000 }); }
        catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, 'Could not retire browser documents.');
      },
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
