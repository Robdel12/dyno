# Browser setup

Playwright Core comes with Dyno. Download a browser once, then run your tests:

```sh
npx dyno install                      # Chromium, the default
npx dyno --ui
npx dyno install --browser firefox
npx dyno --browser firefox --ui
npx dyno install --browser webkit
npx dyno --browser webkit
```

Runs never download browsers. On Linux, `dyno install --with-deps` also installs [system dependencies](https://playwright.dev/docs/browsers#install-system-dependencies) and may need administrator access. Use `dyno browsers` to see downloaded builds and paths.

Headless Chromium uses Playwright's default headless shell. On macOS, Chromium `--ui`, Chrome, Edge and custom Chromium executables reject captures taller than 16,384 physical pixels. Full Chromium can repeat content beyond that height while reporting valid dimensions. Use default headless Chromium for long-page images. This is a conservative support limit; some custom builds may work beyond it.

## Choose a browser

| Browser | How to run |
| --- | --- |
| Chromium, Firefox, WebKit | Install its matching build, then use `--browser` |
| Installed Chrome or Edge | `dyno --browser chrome` or `--browser edge` |
| Stock Safari, other browsers and devices | `dyno --manual`, then open the printed URL |

WebKit isn't Safari; passing WebKit tests doesn't establish Safari behavior. Chrome and Edge availability is checked at launch. Managed runs support screenshots and viewport sizing, with a private context per worker. Tests and Interactor still run in the browser.

## Open the URL yourself

Manual runs need no local browser installed. Open the printed URL and click **Start tests** if the popup was blocked. Keep the app and companion windows open. Use `--manual --host 0.0.0.0` to reach Dyno from another device.

A URL-only browser can't take screenshots or resize its tab. Required captures fail; explicitly optional ones report a skipped image. Viewport requests and fixed config dimensions must match the actual window. See [viewport sizing](guide.md#viewport-sizing).

## Native capabilities

Use `app.native.capabilities` to choose browser-specific coverage explicitly. Required operations fail when unsupported; Dyno doesn't substitute a synthetic event.

| Feature | Chromium / Chrome / Edge | Firefox | WebKit | Manual URL |
| --- | --- | --- | --- | --- |
| Native keys and pointer | Yes | Yes | Yes | Unavailable |
| App HTTP request guard | Yes | Yes | Yes | Unavailable |
| Dialogs and browser console | Yes | Yes | Yes | Unavailable |
| Color scheme and reduced motion | Yes | Yes | Yes | Unavailable |
| Clipboard permission grants | Read/write | Unavailable | Read only | Unavailable |
| Virtual authenticator | Yes | Unavailable | Unavailable | Unavailable |
| App network offline | Yes | Unavailable | Unavailable | Unavailable |

Native state resets between tests. Cookies, storage, and backend cleanup remain your project's responsibility. Chromium offline keeps companion HTTP connected, but can change its `navigator.onLine` too.

Set `browser.locale` and `browser.timezoneId` when creating managed contexts. `browser.deviceScaleFactor` accepts finite values from 1 to 3, including fractional ratios. Set `browser.hasTouch` for touch input, `browser.isMobile` for mobile viewport behavior, and `browser.userAgent` when needed. Firefox does not support `isMobile`. These are browser context settings; they do not reproduce a phone’s OS or hardware.

## Custom executables

Prefer Playwright's matching builds. Use `--browser-path` or `browser.path` for a compatible executable; Dyno passes it to Playwright without scanning application folders. Extra `browser.args` can break automation. Profile and instance flags are reserved because Dyno owns the session.

## Known limits

CI exercises Chromium, Firefox, and WebKit on Linux and macOS. Windows, phones, iOS, and TVs still need verification. Manual browsers need [modern APIs](guide.md#current-limits), and their popup and background-tab policies can affect the runner.

For launch failures, check `dyno browsers`, then run `dyno doctor` with that browser. Include its diagnostic when reporting a problem. A failed launch is an error; Dyno never silently switches browsers.
