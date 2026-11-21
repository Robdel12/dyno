// Chromium device emulation for one browser context. Emulation belongs to a
// CDP session, so every override for a page goes through that page's single
// session here: screenshots, viewport changes, and the visible-window fit.

// Space the window frame and toolbar take around the page, as Playwright sizes them.
let frames = { darwin: { width: 2, height: 80 }, win32: { width: 16, height: 88 } };
export let windowFrame = (platform = process.platform) => frames[platform] ?? { width: 8, height: 85 };

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
export function fitScale(viewport, screen, frame = windowFrame()) {
  return Math.min(1,
    (screen.availWidth - frame.width) / viewport.width,
    (screen.availHeight - frame.height) / viewport.height);
}

let screenFor = (screens, bounds) =>
  screens.find(screen => bounds.left >= screen.left && bounds.left < screen.left + screen.width &&
    bounds.top >= screen.top && bounds.top < screen.top + screen.height) ??
  screens.find(screen => screen.isPrimary) ?? screens[0];

// `fit` is on for visible windows. Headless pages keep the previous behavior:
// overrides only once a page already has a session, such as after a capture.
export function createEmulation({ context, plan, fit = false }) {
  let sessions = new Map();
  let session = (page) => {
    if (!sessions.has(page)) sessions.set(page, context.newCDPSession(page));
    return sessions.get(page);
  };
  let fitWindow = async (client, viewport) => {
    let [{ screenInfos }, { windowId, bounds }] = await Promise.all([
      client.send('Emulation.getScreenInfos'), client.send('Browser.getWindowForTarget')]);
    let screen = screenFor(screenInfos, bounds);
    let scale = screen ? fitScale(viewport, screen) : 1;
    let frame = windowFrame();
    let place = () => scale < 1 ? client.send('Browser.setWindowBounds', { windowId, bounds: {
      left: screen.availLeft, top: screen.availTop,
      width: Math.ceil(viewport.width * scale) + frame.width,
      height: Math.ceil(viewport.height * scale) + frame.height,
    } }) : undefined;
    return { scale, place };
  };
  let apply = async (page, viewport = page.viewportSize()) => {
    if (!fit && !sessions.has(page)) return;
    let client = await session(page);
    let { scale, place } = fit ? await fitWindow(client, viewport) : { scale: 1, place: () => {} };
    await client.send('Emulation.setDeviceMetricsOverride', deviceMetrics(plan, viewport, scale));
    await place();
  };
  return Object.freeze({ session, apply });
}
