# Dyno

Write browser tests that run in the browser. Dyno starts your app, serves a test URL, and reports results. [Interactor.js](https://github.com/wwilsman/interactor.js) handles DOM interaction and waiting for the UI.

The app gets the full window, with tests in a companion window and a reporter you can open over the app. The included Playwright Core handles managed launch, screenshots, and viewport sizing. Manual runs just need the URL and a supported browser.

[Read the docs](https://robdel12.github.io/dyno/) or [write your first test](https://robdel12.github.io/dyno/next/guides/getting-started/).

## Try it in your app

Dyno is early and isn't published to npm yet. You'll need Node 24+.

```sh
npm install --save-dev github:Robdel12/dyno
npx dyno init
npx dyno install
```

Set your app's command and URL in `dyno.config.js`, then write a test:

```js
import { describe, test } from 'dyno';

describe('Contacts', () => {
  test('saves a contact', async ({ app, I }) => {
    await app.goto('/contacts/new');
    await I.find('Name').then.fill('Robert');
    await I.click('Save');
    await I.find('$([role=status])').text('Contact saved');
  });
});
```

Run `npx dyno` for headless tests or `npx dyno --ui` to inspect the app. Add `--watch` to rerun edits. Commit your lockfile to keep the tested Dyno revision. Each test gets fresh documents; your project owns storage and database cleanup.

## Work on Dyno

Clone this repo, run `npm ci`, and download Chromium with `node bin/dyno.js install`. Run the demo with `node bin/dyno.js --config examples/demo/dyno.config.js --ui` and the framework suite with `npm test`.

Start with [the vision](vision.md). [Architecture](docs/architecture.md), [CI setup](docs/ci.md), and [the documentation guide](docs/documentation.md) cover contributing. The portable [guide](docs/guide.md) and [API reference](docs/api.md) are generated from source.

MIT licensed. See [LICENSE](LICENSE).
