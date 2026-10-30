# Browser setup

Playwright Core ships with Dyno. It handles managed browser launch, screenshots, and viewport sizing. Tests and Interactor still execute in the browser. Explicit native operations use that same managed session.

Download a browser build once, then run:

```sh
npx dyno install                      # Chromium, the default
npx dyno install --browser firefox
npx dyno install --browser webkit
npx dyno --browser webkit              # headless
npx dyno --browser firefox --ui        # visible
npx dyno browsers                      # downloaded builds and paths
```

Runs never download browsers. `dyno install` uses Playwright's installer and cache. On Linux, use `dyno install --with-deps` to also install [Playwright's system dependencies](https://playwright.dev/docs/browsers#install-system-dependencies). That explicit option can require administrator access.

| Target | Setup |
| --- | --- |
| Chromium, Firefox, WebKit | Download the matching build with `dyno install` |
| Installed Chrome | `dyno --browser chrome` uses Playwright's Chrome channel |
| Installed Edge | `dyno --browser edge` uses Playwright's Edge channel |
| Stock Safari, other browsers and devices | `dyno --manual`, then open the printed URL |

WebKit and Safari are separate targets. WebKit results don't establish Safari behavior. `dyno browsers` lists downloaded engine builds; Chrome and Edge channel availability is checked at launch.

## Manual runs

Manual mode needs no local browser installed. Open the printed URL, click **Start tests** if its popup was blocked, and keep the app and companion windows open. Use `--manual --host 0.0.0.0` to try another device. Tests still need the [modern browser APIs listed in the guide](guide.md#current-limits).

A URL-only browser can't capture screenshots or resize its own tab. Required screenshots fail; `{ optional: true }` reports a skipped image. A matching `app.setViewport` request succeeds, and a different size fails. Fixed config dimensions must also match the actual window.

## Managed runs

Dyno owns a fresh browser profile and its processes. Playwright keeps the original app page for capture and sizing, even when the companion is active. Closing the app interrupts its run. Shutdown closes the browser; Dyno also removes processes left by a crashed worker.

Screenshots are PNGs of the original app page with the reporter hidden. `fullPage: true` preserves the app viewport and captures the whole page. Masks change only the PNG. Animation suppression and caret hiding are prepared in the browser and restored afterward. See the [screenshot API](guide.md#screenshots).

`browser.deviceScaleFactor` accepts `1`, `2`, or `3`. Viewport dimensions describe desktop layout; they don't emulate a phone's input or operating system.

## Native capabilities

| Feature | Chromium / Chrome / Edge | Firefox | WebKit | Manual URL |
| --- | --- | --- | --- | --- |
| Native keys and pointer | Yes | Yes | Yes | Unavailable |
| Dialog handling and browser console | Yes | Yes | Yes | Unavailable |
| Reduced motion | Yes | Yes | Yes | Unavailable |
| Clipboard permission grants | Read/write | Unavailable | Read only | Unavailable |
| Virtual authenticator | Yes | Unavailable | Unavailable | Unavailable |
| App network offline | Yes | Unavailable | Unavailable | Unavailable |

Capabilities describe the provider API; they don't make an unsupported engine silently pass a required test. Use `app.native.capabilities` and keep browser-specific coverage explicit. An authenticator is virtual browser hardware; your app still owns its real registration, challenge, and signature validation.

App offline blocks the original app page's requests while companion HTTP remains connected. Chromium also changes the companion's navigator.onLine signal. This is not fully isolated offline state. Context-wide Playwright offline would disconnect the runner too, so Dyno doesn't use it.

Managed config accepts `browser.locale` and `browser.timezoneId`, for example `en-US` and `UTC`. These apply when creating the browser context. Native state resets between tests; cookies and backend state still belong to the project. Managed Firefox disables background timer throttling, matching Playwright’s BiDi defaults, so the companion’s Interactor retries keep running while the app is active. Manual browsers retain their own background policies.

## Custom executables

Prefer Playwright's matching builds. To use a compatible executable, pass `--browser-path` or set `browser.path`. Dyno passes it to Playwright's `executablePath`; it doesn't scan application folders or read browser-specific path environment variables.

```js
browser: {
  name: 'chromium',
  path: '/path/to/chrome',
  args: []
}
```

Custom builds may be incompatible with Playwright. Extra arguments go directly to the browser and can break automation. Profile and instance flags are reserved because Dyno owns the session.

## Known limits

CI exercises Chromium, Firefox, and WebKit on Linux and macOS. Windows and companion behavior on phones, iOS, and TVs still need verification. Manual execution is available there, but popup and background-tab policies can affect it. Dyno doesn't ship extensions or a separate native or WebDriver launcher.

On this macOS 27 machine, the downloaded Firefox build exits with `Could not find profile folder` before tests start. [Mozilla tracks this command-line startup problem](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476). Use a working environment or open the URL manually; Dyno does not change OS privacy settings.

See [CI setup](ci.md) for the suites and saved results.
