# Dyno

Browser tests that run in the browser. Dyno starts your app, serves a test URL, and reports the results. [Interactor.js](https://github.com/wwilsman/interactor.js) handles DOM interaction and assertions in the same browser as your app.

Open the URL to run tests without a driver or extension. Dyno keeps the app in the main window and runs tests in a companion window. Optional providers add screenshots and window sizing. Other devices remain a goal; popup and background-tab behavior still need real-device checks.

Dyno is early and isn't published to npm yet. You'll need Node 24+ and an installed browser. Chrome is the default.

## Try it

```sh
git clone https://github.com/Robdel12/dyno.git
cd dyno
npm ci
node bin/dyno.js --config examples/demo/dyno.config.js --ui
```

The app fills the original browser window. If the browser blocks the companion window, click **Start**. Keep both windows open. Press **Ctrl+Shift+D** to inspect results over the app, or open the printed reporter URL separately.

## Use it in an app

```sh
npm install --save-dev github:Robdel12/dyno
npx dyno init
npx dyno doctor
```

Set your app's command and URL in `dyno.config.js`, then write a test:

```js
import { test } from 'dyno';

test('saves a contact', async ({ app, I }) => {
  await app.goto('/contacts/new');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Contact saved');
});
```

Run `npx dyno` for a headless run, `npx dyno --ui` to inspect the app, or `npx dyno --manual` to open the URL yourself. Each test gets a fresh runtime and app document. Storage and database cleanup stay explicit. Use `--watch` to rerun test and helper edits. Each run also saves an HTML report you can open after Dyno stops.

## Screenshots

```sh
npm install --save-dev playwright-core
npx dyno --provider playwright --browser chrome
```

Then `await app.screenshot('dashboard', { fullPage: true })` saves the full app page. Managed providers also support `await app.setViewport({ width: 390, height: 844 })`. Native and manual runs use the actual window size. [Browser setup](docs/browsers.md) covers providers and their limits.

## Work on Dyno

Run `npm test` with Chrome installed. [CI setup](docs/ci.md) lists the individual suites. The macOS process-cleanup test also needs `cc`. The optional `npm run test:vizzly` integration needs a Vizzly checkout, its built frontend, and Docker; the main suite doesn't need any of those.

Start with [the vision](vision.md). The [guide](docs/guide.md) covers the API and configuration; [architecture](docs/architecture.md) explains execution and capture. The [design guide](docs/design.md) covers the reporter.
