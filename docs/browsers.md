# Browser setup

`dyno browsers` lists installed launchers. Choose one with `dyno --browser firefox` or `browser.name` in your config. Native mode opens the start URL. The app stays in the original window; tests run in a companion window in that browser.

| Browser | Headless | Visible | Native session |
| --- | --- | --- | --- |
| Chrome / Chromium | Yes | `--ui` | Disposable profile |
| Edge | Yes | `--ui` | Disposable profile |
| Firefox | Yes | `--ui` | Disposable profile |
| Safari on macOS | No | `--browser safari --ui` | Existing Safari session |
| Other browsers and devices | Use their own tooling | `--manual` | Open the printed URL |

Safari's native launcher opens a URL in your existing session. It leaves tabs and storage alone and can't detect when you close the test tab. Other native launchers own their browser process and profile.

Manual mode needs no local browser installed. Open the printed URL, click **Start** if its popup was blocked, and keep the app and companion windows open. Use `--manual --host 0.0.0.0` to try another device. The runner needs the [modern browser APIs listed in the guide](guide.md#current-limits); mobile popup and background-tab behavior remains unverified.

Native and manual sessions use the actual app viewport. They cannot resize it through `app.setViewport`; a matching request succeeds and a different size fails. Fixed config dimensions must also match. Use a managed provider for window sizing.

## Add screenshots and window control

Providers are optional. Test actions and assertions still execute in the browser.

```sh
npm install --save-dev playwright-core
npx dyno install --browser webkit
npx dyno --provider playwright --browser webkit
```

```sh
npm install --save-dev selenium-webdriver
npx dyno --provider webdriver --browser firefox
```

| Target | Playwright | WebDriver |
| --- | --- | --- |
| Installed Chrome / Edge | Branded channels | Matching vendor driver |
| Chromium | Matching Playwright build | Installed Chromium + ChromeDriver |
| Firefox | Matching Playwright build | Installed Firefox + GeckoDriver |
| WebKit | Matching Playwright build | Unsupported |
| Safari | Unsupported | System safaridriver on macOS; visible only |

WebKit and Safari are separate targets. Dyno doesn't substitute one for the other.

Playwright builds must match the installed `playwright-core` version. `dyno install --browser chromium|firefox|webkit` downloads them explicitly. Runs don't download browsers. Installed Chrome and Edge use their normal channels unless you select an executable path. Playwright also supports `browser.deviceScaleFactor: 1`, `2`, or `3`.

WebDriver uses Selenium Manager to find a matching driver, which may need network access the first time. Install the browser yourself; browser downloads are disabled. For Safari, enable Remote Automation yourself, then run `dyno --provider webdriver --browser safari --ui`. Custom Safari paths aren't supported with WebDriver.

Managed sessions own their browser, profile, and cleanup. Screenshots activate the owned app tab before browser-local animation preparation. WebDriver Chrome, Edge, and Firefox use BiDi for viewport sizing and viewport capture, including sizes below the outer window’s minimum width. They retain the original app page/window handle for capture and resizing, even when the companion is active. Chrome/Edge WebDriver sessions activate the page before navigation so headless focus works. A manual visitor gets a separate run without access to the managed browser's capture provider.

## Screenshot support

All captures are PNGs from the original app window. Viewport capture is the default; `fullPage: true` leaves the viewport unchanged and captures the page's full content.

| Provider | Full-page capture |
| --- | --- |
| Playwright | Its page screenshot API |
| WebDriver Chrome / Chromium / Edge | BiDi viewport or document capture |
| WebDriver Firefox | BiDi viewport or document capture |
| WebDriver Safari | Unavailable; the request fails clearly |
| Native / manual | No screenshot provider |

`mask` accepts an array of app elements. `animations` accepts `'allow'` or `'disabled'`; `caret` accepts `'initial'` or `'hide'`. Defaults preserve animations and the caret. Dyno finishes finite animations and suspends infinite ones before measuring masks, with the same browser-local preparation for each provider. Masks affect only the PNG. Temporary caret styles are restored after capture. [The guide](guide.md#screenshots) shows the API.

## Choose an executable

Dyno checks standard application locations on macOS and Windows, and PATH on Linux. Override discovery with `--browser-path`, `browser.path`, or `CHROME_PATH`, `CHROMIUM_PATH`, `EDGE_PATH`, `FIREFOX_PATH`, or `SAFARI_PATH`.

```js
browser: {
  name: 'firefox',
  path: '/path/to/firefox',
  args: []
}
```

Safari's native path is an `.app` directory; other paths point to executables. Extra arguments are passed directly. Profile and instance flags are reserved so a test can't borrow your personal profile.

On Linux, Chromium-family launchers use a basic password store and disable background component updates in their disposable profiles. They don't change your normal browser configuration.

## Known limits

The implemented layout passed the local framework suite, plus Chrome and Firefox URL-only runs. Capture checks passed through Playwright Chrome and WebKit, and through WebDriver Chrome and Firefox 159 beta. They cover full-page pixels, masks, animation cleanup, responsive sizing, and interruption. Installed Firefox 158 failed initialization on this Mac; the beta results do not establish support for that installation.

Safari viewport capture, Windows providers, and companion behavior on phones, iOS, and TVs still need verification. Edge uses the same BiDi path but was not checked locally. WebKit does not establish Safari behavior, and a mobile-sized desktop viewport does not establish real-device behavior. Dyno does not configure iOS WebDriver sessions yet.

On macOS 27, some Firefox builds exit with `Could not find profile folder` when launched from the command line. Try a current build, or use `--manual` and open the URL in Firefox yourself. See [Mozilla's report](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476). Dyno includes browser output in startup failures.

## Run the checks

```sh
npm test
npm run test:firefox
npm run test:browser -- edge
DYNO_CAPTURE_PROVIDER=webdriver DYNO_CAPTURE_BROWSER=firefox npm run test:capture
```

The [CI workflow](../.github/workflows/ci.yml) defines native Chrome/Firefox/Edge jobs on macOS and Linux, plus Linux Playwright and WebDriver capture jobs. [CI setup](ci.md) covers the suites and saved results. Check the [latest run](https://github.com/Robdel12/dyno/actions/workflows/ci.yml) for results.

Linux CI supplies a D-Bus session. Its Edge job installs the official browser package and repairs the hosted image's sandbox setup. Those machine-specific fixes stay in the workflow; Dyno doesn't change browser permissions or OS security settings. The packaged-install check needs normal registry access and an empty npm cache.
