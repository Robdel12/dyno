import { randomUUID } from 'node:crypto';

// A real debugger pause preserves queued app callbacks. Disabling scripts drops
// them; freezing the page instead emits application lifecycle events.
export function createChromiumCapture({ context, page, plan, close }) {
  let client;
  let resize = async viewport => {
    if (!client) return;
    await client.send('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      mobile: plan.isMobile ?? false,
      deviceScaleFactor: plan.deviceScaleFactor ?? 1,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      screenOrientation: plan.isMobile && viewport.width > viewport.height
        ? { angle: 90, type: 'landscapePrimary' }
        : { angle: 0, type: plan.isMobile ? 'portraitPrimary' : 'landscapePrimary' },
    });
  };
  let capture = async ({ clip } = {}) => {
    client ??= await context.newCDPSession(page);
    let paused;
    let stopped = Promise.withResolvers();
    let observed = event => { paused = event; stopped.resolve(event); };
    let resumed = () => { paused = undefined; };
    client.on('Debugger.paused', observed);
    client.on('Debugger.resumed', resumed);
    let marker = `dynoCapture_${randomUUID().replaceAll('-', '')}`;
    let deadline = AbortSignal.timeout(15000);
    let expired = Promise.withResolvers();
    let abort = () => expired.reject(new Error('Chromium screenshot exceeded 15000 ms.'));
    deadline.addEventListener('abort', abort, { once: true });
    let send = (method, input) => Promise.race([client.send(method, input), expired.promise]);
    let work = async () => {
      await send('Debugger.enable');
      if (paused) throw new Error('Resume the application debugger before taking a screenshot.');
      let evaluation = send('Runtime.evaluate', {
        expression: `(function ${marker}() { debugger; })()`,
      });
      let event = await Promise.race([
        stopped.promise,
        evaluation.then(() => { throw new Error('Could not pause application JavaScript for screenshot.'); }),
      ]);
      if (event.callFrames[0]?.functionName !== marker)
        throw new Error('The application debugger interrupted screenshot preparation.');
      let viewport = page.viewportSize();
      // Device emulation belongs to a CDP session. Match the SDK's current
      // viewport here so capture cannot reset its pixel ratio or screen size.
      await resize(viewport);
      let { cssContentSize } = await send('Page.getLayoutMetrics');
      let size = {
        width: Math.ceil(Math.max(viewport.width, cssContentSize.width)),
        height: Math.ceil(Math.max(viewport.height, cssContentSize.height)),
      };
      if (clip && (clip.x + clip.width > size.width || clip.y + clip.height > size.height))
        throw new Error('Screenshot element no longer fits in the app document.');
      let result = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, ...size, ...clip, scale: 1 },
        captureBeyondViewport: size.width > viewport.width || size.height > viewport.height,
      });
      if (paused?.callFrames[0]?.functionName !== marker)
        throw new Error('Application execution resumed or navigated during screenshot.');
      return Buffer.from(result.data, 'base64');
    };
    try {
      return await Promise.race([work(), expired.promise]);
    } finally {
      let interrupted = false;
      try {
        if (deadline.aborted) await close();
        else {
          if (plan.hasTouch)
            await send('Emulation.setTouchEmulationEnabled', { enabled: true });
          if (paused?.callFrames[0]?.functionName === marker) {
            try { await send('Debugger.resume'); }
            catch (error) {
              // Navigation can end the pause before its resumed event arrives.
              if (!error.message.includes('Can only perform operation while paused')) throw error;
              interrupted = true;
            }
          }
          await send('Debugger.disable');
        }
      } catch (error) {
        await close();
        throw new Error('Could not restore application execution after screenshot; the browser context was closed.', { cause: error });
      } finally {
        deadline.removeEventListener('abort', abort);
        client.off('Debugger.paused', observed);
        client.off('Debugger.resumed', resumed);
      }
      if (interrupted) throw new Error('Application execution resumed or navigated during screenshot.');
    }
  };
  return Object.freeze({ capture, resize });
}
