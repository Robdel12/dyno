# Browser setup

`dyno browsers` lists installed launchers. Choose one with `dyno --browser firefox` or `browser.name` in your config. Native mode opens the test URL; tests run in that browser.

| Browser | Headless | Visible | Native session |
| --- | --- | --- | --- |
| Chrome / Chromium | Yes | `--ui` | Disposable profile |
| Edge | Yes | `--ui` | Disposable profile |
| Firefox | Yes | `--ui` | Disposable profile |
| Safari on macOS | No | `--browser safari --ui` | Existing Safari session |
| Other browsers and devices | Use their own tooling | `--manual` | Open the printed URL |

Safari's native launcher opens a URL in your existing session. It leaves tabs and storage alone and can't detect when you close the test tab. Other native launchers own their browser process and profile.

Manual mode works without a local browser installed. Use `--manual --host 0.0.0.0` for another device. The runner needs the [modern browser APIs listed in the guide](guide.md#current-limits).

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

Managed sessions own their browser, profile, and cleanup. Chrome/Edge WebDriver sessions activate the page before navigation so headless focus works. A manual visitor gets a separate run without access to the managed browser's capture provider.

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

Local checks cover Chrome and Firefox URL-only runs, Playwright Chrome/Chromium/WebKit capture, and WebDriver Chrome/Firefox capture. Safari capture and Windows providers still need verification. A mobile-sized desktop viewport doesn't prove real-device behavior. Dyno doesn't configure iOS WebDriver sessions yet.

On macOS 27, some Firefox builds exit with `Could not find profile folder` when launched from the command line. Try a current build, or use `--manual` and open the URL in Firefox yourself. See [Mozilla's report](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476). Dyno includes browser output in startup failures.

## Run the checks

```sh
npm test
npm run test:firefox
node scripts/test.js edge
DYNO_CAPTURE_PROVIDER=webdriver DYNO_CAPTURE_BROWSER=firefox npm run test:capture
```

The [CI workflow](../.github/workflows/test.yml) defines native Chrome/Firefox/Edge jobs on macOS and Linux, plus Linux Playwright and WebDriver capture jobs. Check the [latest run](https://github.com/Robdel12/dyno/actions/workflows/test.yml) for results.

Linux CI supplies a D-Bus session. Its Edge job installs the official browser package and repairs the hosted image's sandbox setup. Those machine-specific fixes stay in the workflow; Dyno doesn't change browser permissions or OS security settings. The packaged-install check needs normal registry access and an empty npm cache.
