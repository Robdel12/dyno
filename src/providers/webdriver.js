import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import firefox from 'selenium-webdriver/firefox.js';
import edge from 'selenium-webdriver/edge.js';
import getBrowsingContext from 'selenium-webdriver/bidi/browsingContext.js';
import { CaptureScreenshotParameters, Origin } from 'selenium-webdriver/bidi/captureScreenshotParameters.js';

export async function open(plan, viewport) {
  let builder = new Builder().forBrowser(
    plan.name === 'chromium' ? 'chrome' : plan.name === 'edge' ? 'MicrosoftEdge' : plan.name
  );
  if (['chrome', 'chromium', 'edge'].includes(plan.name)) {
    let options = plan.name === 'edge' ? new edge.Options() : new chrome.Options();
    options.enableBidi();
    options.setBinaryPath(plan.path);
    options.addArguments(
      ...plan.args,
      `--user-data-dir=${plan.profile}`,
      ...(plan.headless ? ['--headless=new'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-field-trial-config',
      ...(process.platform === 'linux' ? ['--password-store=basic'] : [])
    );
    builder = plan.name === 'edge' ? builder.setEdgeOptions(options) : builder.setChromeOptions(options);
  } else if (plan.name === 'firefox') {
    let options = new firefox.Options()
      .setBinary(plan.path)
      .enableBidi()
      .addArguments(...plan.args, '-profile', plan.profile, ...(plan.headless ? ['-headless'] : []));
    builder = builder.setFirefoxOptions(options);
  }
  let driver = await builder.build();
  try {
    let ownedWindow = await driver.getWindowHandle();
    let selectApp = () => driver.switchTo().window(ownedWindow);
    let caps = await driver.getCapabilities();
    let context;
    if (plan.name !== 'safari') {
      try {
        context = await getBrowsingContext(driver, { browsingContextId: ownedWindow });
        await context.setViewport(viewport.width, viewport.height, plan.deviceScaleFactor ?? 1);
      } catch (error) {
        throw new Error(
          `WebDriver ${plan.name} requires BiDi viewport support. Update the browser and driver. ${error.message}`,
          { cause: error }
        );
      }
    }
    return Object.freeze({
      identity: Object.freeze({
        provider: 'webdriver',
        name: plan.name,
        version: caps.get('browserVersion'),
        build: 'installed'
      }),
      open: async (url) => {
        await selectApp();
        if (context) await context.activate();
        await driver.get(url);
      },
      activate: async () => {
        await selectApp();
        if (context) await context.activate();
      },
      resize: async ({ width, height, current }) => {
        await selectApp();
        if (context) {
          await context.setViewport(width, height, plan.deviceScaleFactor ?? 1);
          return;
        }
        let rect = await driver.manage().window().getRect();
        await driver
          .manage()
          .window()
          .setRect({
            width: Math.max(100, rect.width + width - current.width),
            height: Math.max(100, rect.height + height - current.height)
          });
      },
      capture: async ({ fullPage = false } = {}) => {
        await selectApp();
        if (context)
          return Buffer.from(
            await context.captureScreenshot(
              new CaptureScreenshotParameters().origin(fullPage ? Origin.DOCUMENT : Origin.VIEWPORT)
            ),
            'base64'
          );
        if (fullPage)
          throw new Error('Full-page screenshots are unavailable in WebDriver Safari. Use a viewport screenshot.');
        return Buffer.from(await driver.takeScreenshot(), 'base64');
      },
      stop: () => driver.quit()
    });
  } catch (error) {
    await driver.quit();
    throw error;
  }
}
