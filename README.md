# Dyno

Browser tests that run in the browser. Dyno starts your app, serves a test URL, and reports the results. [Interactor.js](https://github.com/wwilsman/interactor.js) handles DOM interaction and assertions in the same browser as your app.

Open that URL in another browser or on another device to run the same tests. No driver or extension is required. Optional providers add screenshots and browser window control.

Dyno is early and isn't published to npm yet. You'll need Node 24+ and an installed browser. Chrome is the default.

## Try it

```sh
git clone https://github.com/Robdel12/dyno.git
cd dyno
npm ci
node bin/dyno.js --config examples/demo/dyno.config.js --ui
```

The app fills the browser. Press **Ctrl+Shift+D** to open the reporter after the current test finishes, or use the printed reporter URL in a separate tab.

## Use it in an app

```sh
npm install --save-dev github:Robdel12/dyno
npx dyno init
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

Run `npx dyno` for a headless run, `npx dyno --ui` to inspect the app, or `npx dyno --manual` to open the URL yourself. Tests and the app get fresh JavaScript contexts for each test. Storage and database cleanup stay explicit.

## Screenshots

```sh
npm install --save-dev playwright-core
npx dyno --provider playwright --browser chrome
```

Then `await app.screenshot('dashboard')` saves the app viewport. `await app.setViewport({ width: 390, height: 844 })` changes its layout, with or without a driver. [Browser setup](docs/browsers.md) covers Playwright builds and WebDriver for installed browsers.

## Work on Dyno

Run `npm test` with Chrome installed. [CI setup](docs/ci.md) lists the individual suites. The macOS process-cleanup test also needs `cc`. The optional `npm run test:vizzly` integration needs a Vizzly checkout, its built frontend, and Docker; the main suite doesn't need any of those.

Start with [the vision](vision.md). The [guide](docs/guide.md) covers the API and configuration; [architecture](docs/architecture.md) explains execution and capture. The [design guide](docs/design.md) covers the reporter.
