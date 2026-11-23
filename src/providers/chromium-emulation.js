// Chromium device emulation for one browser context. Emulation belongs to a
// CDP session, so every override for a page goes through that page's single
// session here: screenshots, viewport changes, and the visible-window fit.

// Space the window frame and toolbar take around the page, as Playwright sizes them.
let frame = { darwin: { width: 2, height: 80 }, win32: { width: 16, height: 88 } }[process.platform] ?? { width: 8, height: 85 };

export function deviceMetrics(plan, viewport, scale = 1) {
  return {
    ...viewport,
    mobile: plan.isMobile ?? false,
    deviceScaleFactor: plan.deviceScaleFactor ?? 1,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    screenOrientation: plan.isMobile && viewport.width > viewport.height
      ? { angle: 90, type: 'landscapePrimary' }
      : { angle: 0, type: plan.isMobile ? 'portraitPrimary' : 'landscapePrimary' },
    ...(scale < 1 ? { scale } : {}),
  };
}

// A viewport larger than the screen is shown scaled down so the whole app fits.
// The app still lays out, and screenshots still capture, at full size.
export function fitScale(viewport, screen, around = frame) {
  return Math.min(1,
    (screen.availWidth - around.width) / viewport.width,
    (screen.availHeight - around.height) / viewport.height);
}

let screenFor = (screens, bounds) =>
  screens.find(screen => bounds.left >= screen.left && bounds.left < screen.left + screen.width &&
    bounds.top >= screen.top && bounds.top < screen.top + screen.height) ??
  screens.find(screen => screen.isPrimary) ?? screens[0];

// `fit` is on for visible windows. Headless pages keep the previous behavior:
// overrides only once a page already has a session, such as after a capture.
// A window is fitted once per viewport size; later captures only resend the
// metrics override.
export function createEmulation({ context, plan, fit = false }) {
  let sessions = new Map();
  let fitted = new Map();
  let session = (page) => {
    if (!sessions.has(page)) sessions.set(page, context.newCDPSession(page));
    return sessions.get(page);
  };
  // The scale that fits the viewport on the window's screen, and the window
  // bounds that show it, when it needs scaling.
  let fitWindow = async (client, viewport) => {
    let [{ screenInfos }, { windowId, bounds }] = await Promise.all([
      client.send('Emulation.getScreenInfos'), client.send('Browser.getWindowForTarget')]);
    let screen = screenFor(screenInfos, bounds);
    let scale = screen ? fitScale(viewport, screen) : 1;
    return { scale, windowId, bounds: scale < 1 ? {
      left: screen.availLeft, top: screen.availTop,
      width: Math.ceil(viewport.width * scale) + frame.width,
      height: Math.ceil(viewport.height * scale) + frame.height,
    } : null };
  };
  let apply = async (page, viewport = page.viewportSize()) => {
    if (!fit && !sessions.has(page)) return;
    let client = await session(page);
    let size = `${viewport.width}x${viewport.height}`;
    let window = fit && fitted.get(page)?.size !== size ? { size, ...await fitWindow(client, viewport) } : null;
    if (window) fitted.set(page, window);
    await client.send('Emulation.setDeviceMetricsOverride', deviceMetrics(plan, viewport, fitted.get(page)?.scale ?? 1));
    if (window?.bounds) await client.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: window.bounds });
  };
  return Object.freeze({ session, apply });
}
