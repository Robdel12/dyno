# Dyno

Browser tests that run in the browser. Dyno starts your app, serves a test URL, and reports the results. [Interactor.js](https://github.com/wwilsman/interactor.js) handles DOM interaction and assertions.

## Try it

Requires Node 24+ and an installed browser. Chrome is the default.

```sh
npm ci
node bin/dyno.js --config examples/demo/dyno.config.js --ui
```

## Use it in an app

Dyno is private and isn't published to npm yet. Install your checkout, then generate a config and an example test:

```sh
npm install --save-dev /path/to/Dyno
npx dyno init
```

Set your app's command and URL in `dyno.config.js`, then run `npx dyno`.

```js
import { test } from 'dyno';

test('saves a contact', async ({ app, I }) => {
  await app.goto('/contacts/new');
  await I.type('Robert').into('$(input[name=name])');
  await I.click('Save');
  await I.find('$([role=status])').text('Contact saved');
});
```

`--browser firefox` selects Firefox; `dyno browsers` lists installed launchers. [Browser setup](docs/browsers.md) covers Edge, Chromium, and Safari. `--ui` shows the actual app. Press Ctrl+Shift+D to request inspection; the reporter opens in its own overlay at the next test boundary, with output, source excerpts, and pause/rerun controls. `--manual` prints a URL you can open yourself. Tests and the app get separate, fresh JavaScript contexts; storage and database cleanup stay explicit.

## Capture screenshots

Add an optional provider. Tests still execute in the browser:

```sh
npm install --save-dev playwright-core
npx dyno --provider playwright --browser chrome
```

Then `await app.screenshot('dashboard')` saves the real app viewport. `app.setViewport({ width: 390, height: 844 })` also works without a driver. [Browser setup](docs/browsers.md) covers Playwright engine builds and WebDriver for stock browsers, including Safari.

## Work on Dyno

```sh
npm test
npm run test:vizzly
```

The macOS cleanup regression also uses the system C compiler (`cc`).

The Vizzly example needs a sibling Vizzly checkout, its built frontend, and Docker. It creates and removes its own test services.

Start with [the vision](vision.md). The [guide](docs/guide.md) covers configuration and current limits. [Architecture](docs/architecture.md) explains execution and capture; interactions use synthetic DOM events.
