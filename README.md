# Dyno

Browser tests that run in the browser. Dyno starts your app, serves a test URL, and reports the results. [Interactor.js](https://github.com/wwilsman/interactor.js) handles DOM interaction and assertions.

## Try it

Requires Node 24+ and Chrome or Chromium.

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

`--ui` opens a browser for inspection and reruns. `--manual` prints a URL you can open yourself. Tests and the app get separate, fresh JavaScript contexts; storage and database cleanup stay explicit.

## Work on Dyno

```sh
npm test
npm run test:vizzly
```

The Vizzly example needs a sibling Vizzly checkout, its built frontend, and Docker. It creates and removes its own test services.

Start with [the vision](vision.md). The [guide](docs/guide.md) covers configuration and current limits. [Screenshot research](docs/research/screenshots.md) is separate from the runtime; interactions use synthetic DOM events.
