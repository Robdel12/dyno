import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import firefox from 'selenium-webdriver/firefox.js';
import edge from 'selenium-webdriver/edge.js';

export async function open(plan, viewport) {
  let builder = new Builder().forBrowser(
    plan.name === 'chromium' ? 'chrome' : plan.name === 'edge' ? 'MicrosoftEdge' : plan.name
  );
  if (['chrome', 'chromium', 'edge'].includes(plan.name)) {
    let options = plan.name === 'edge' ? new edge.Options() : new chrome.Options();
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
      .addArguments(...plan.args, '-profile', plan.profile, ...(plan.headless ? ['-headless'] : []));
    builder = builder.setFirefoxOptions(options);
  }
  let driver = await builder.build();
  try {
    let caps = await driver.getCapabilities();
    if (plan.name !== 'safari')
      await driver
        .manage()
        .window()
        .setRect({ width: viewport.width, height: viewport.height + 160 });
    return Object.freeze({
      identity: Object.freeze({
        provider: 'webdriver',
        name: plan.name,
        version: caps.get('browserVersion'),
        build: 'installed'
      }),
      open: async (url) => {
        // ChromeDriver's initial headless tab can be visible but unfocused.
        // Activate the owned page once; browser-local Interactor handles all actions.
        if (['chrome', 'chromium', 'edge'].includes(plan.name))
          await driver.sendDevToolsCommand('Page.bringToFront', {});
        await driver.get(url);
      },
      resize: async ({ width, height, current }) => {
        let rect = await driver.manage().window().getRect();
        await driver
          .manage()
          .window()
          .setRect({
            width: Math.max(100, rect.width + width - current.width),
            height: Math.max(100, rect.height + height - current.height)
          });
      },
      capture: async () => Buffer.from(await driver.takeScreenshot(), 'base64'),
      stop: () => driver.quit()
    });
  } catch (error) {
    await driver.quit();
    throw error;
  }
}
