# Running browsers

`dyno browsers` lists what Dyno can find. Pick a browser with `dyno --browser firefox`, or set `browser.name` in your config. Dyno launches a process at the test URL; test actions never use a remote driver.

| Browser | Headless | Visible | Session |
| --- | --- | --- | --- |
| Chrome / Chromium | Yes | `--ui` | Disposable profile and owned process |
| Edge | Yes | `--ui` | Disposable profile and owned process |
| Firefox | Yes | `--ui` | Disposable profile and owned process |
| Safari on macOS | No | `--browser safari --ui` | Opens the URL in Safari; existing profile, tabs stay open |
| Other browsers and devices | Through their own tooling | `--manual` | Open the printed URL yourself |

Safari's handoff doesn't provide profile isolation or browser-close detection. Storage cleanup stays explicit. Dyno never quits a browser it didn't create. Use manual mode on iOS, Android, or another device; the browser still needs the modern APIs listed in the guide.

## Finding executables

Dyno checks normal application locations on macOS and Windows, and PATH on Linux. You can use `--browser-path`, `browser.path`, or the matching environment variable: `CHROME_PATH`, `CHROMIUM_PATH`, `EDGE_PATH`, `FIREFOX_PATH`, `SAFARI_PATH`. Safari's path is its `.app` directory. Other paths identify an executable, not a shell command.

```js
browser: {
  name: 'firefox',
  path: '/Applications/Firefox.app/Contents/MacOS/firefox',
  args: []
}
```

Extra arguments are passed directly. Dyno reserves profile and instance flags so a test can't accidentally borrow your normal browser profile. It doesn't download browsers during a run.

## Firefox on macOS 27

Firefox 157 and earlier can fail before loading the URL with `Could not find profile folder`, even with a fresh profile. Mozilla fixed the shared app-data lookup in Firefox 158. Use a current build or `--manual` and open the URL through Firefox normally. We keep the browser's diagnostic output in the CLI error. [Mozilla's report](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476), [upstream fix tracking](https://github.com/microsoft/playwright/issues/42768).

Dyno doesn't change OS permissions, rewrite Firefox's application metadata, or change your installed browser. The October 26 checks used stock Chrome 155 and a disposable official Firefox Beta 159 build; each passed all 39 checks, including the packaged install and runner controls. Both Vizzly workflows also passed in each browser. Older installed Firefox 157 reproduced the startup failure above.

## Verification

`npm test` uses Chrome. `npm run test:firefox` uses Firefox; `node scripts/test.js edge` selects Edge. Set the matching executable environment variable when needed.

The CI matrix runs the same CLI, app, gateway, and packaged-install checks on macOS and Linux with Chrome, Firefox, and Edge. Adding the workflow is not a claim that CI has passed. Windows discovery and process-tree cleanup are implemented but still need a Windows verification run. Safari 27.0.1 also passed the read-only demo through the visible URL handoff. Its headless rejection and capability reporting have automated checks; its full suite still needs a visible macOS verification run.
