# Running browsers

`dyno browsers` lists what Dyno can find. Pick a browser with `dyno --browser firefox`, or set `browser.name` in your config. Native mode launches a process at the test URL. Optional providers also capture pixels and size their owned window; test actions never use a remote driver.

| Browser | Headless | Visible | Session |
| --- | --- | --- | --- |
| Chrome / Chromium | Yes | `--ui` | Disposable profile and owned process |
| Edge | Yes | `--ui` | Disposable profile and owned process |
| Firefox | Yes | `--ui` | Disposable profile and owned process |
| Safari on macOS | No | `--browser safari --ui` | Opens the URL in Safari; existing profile, tabs stay open |
| Other browsers and devices | Through their own tooling | `--manual` | Open the printed URL yourself |

Safari's handoff doesn't provide profile isolation or browser-close detection. Storage cleanup stays explicit. Dyno never quits a browser it didn't create. Use manual mode on iOS, Android, or another device; the browser still needs the modern APIs listed in the guide.

## Optional managed providers

```sh
npm install --save-dev playwright-core
npx dyno install --browser webkit
npx dyno --provider playwright --browser webkit

npm install --save-dev selenium-webdriver
npx dyno --provider webdriver --browser firefox
npx dyno --provider webdriver --browser safari --ui
```

| Target | Playwright | WebDriver |
| --- | --- | --- |
| Installed Chrome / Edge | Branded channels | Matching vendor driver |
| Chromium | Playwright build | Installed Chromium + ChromeDriver |
| Firefox | Patched Playwright build | Installed Firefox + GeckoDriver |
| WebKit | Playwright build | Not a stock browser target |
| Actual Safari | Unsupported; choose WebKit explicitly | macOS Safari + built-in safaridriver; headed only |

Playwright's engine builds are coupled to its version. `dyno install` explicitly downloads matching Chromium/Firefox/WebKit builds; ordinary runs don't install browsers. A missing build gives a setup error. `browser.deviceScaleFactor` supports 1/2/3 with Playwright. Installed Chrome and Edge use their existing channels, unless an explicit executable path is selected.

WebDriver uses Selenium Manager to resolve/cache a matching driver, which may need network access on first use. Browser downloads are disabled; install the actual browser yourself. `browser.path` and the usual executable environment variables select an installed browser. Safari uses its system driver and requires **Remote Automation** opt-in. Dyno never enables it automatically or attaches to personal Safari tabs. Automation windows are isolated and can restrict physical interaction.

Providers run in a task-owned Node worker, with a disposable profile owned and removed by the CLI even if that worker crashes. Launch, capture, navigation, and shutdown have deadlines; cleanup also stops the worker's process tree. Manual URL visitors receive their own run and no managed capture capability, even while another browser has a driver connected. Chrome/Edge WebDriver sessions activate their owned page before navigating, so browser-local focus works in headless mode; no test actions use the driver. Tests never receive the driver handle.

Current local contract results cover Playwright Chrome/Chromium/WebKit and WebDriver stock Chrome/Firefox on this Mac. Actual Safari capture remains unverified because Remote Automation is disabled here. The provider reports that prerequisite before starting the app. CI adds Linux engine/provider contracts; Windows provider behavior still needs verification. Existing native-launcher CI is separate from screenshot coverage.

Physical iPhone/iPad Safari can use native safaridriver through a connected, trusted Mac after device opt-in, but Dyno does not configure that integration yet. URL-only functional tests still work subject to the runner's browser requirements. A desktop mobile-sized viewport isn't real-device coverage. See [Apple’s setup](https://developer.apple.com/documentation/safari-developer-tools/ios-enabling-webdriver).

## Finding executables

Dyno checks normal application locations on macOS and Windows, and PATH on Linux. You can use `--browser-path`, `browser.path`, or the matching environment variable: `CHROME_PATH`, `CHROMIUM_PATH`, `EDGE_PATH`, `FIREFOX_PATH`, `SAFARI_PATH`. Safari's path is its `.app` directory. Other paths identify an executable, not a shell command.

```js
browser: {
  name: 'firefox',
  path: '/Applications/Firefox.app/Contents/MacOS/firefox',
  args: []
}
```

Linux Chromium-family launchers use `--password-store=basic` inside their disposable profiles so startup does not depend on a desktop keyring service. Chromium-family launchers also disable component updates and bundled field-trial configuration for the disposable session; native Edge logs showed startup downloading vendor components despite `--disable-background-networking`. Your normal browser profile is separate.

Extra arguments are passed directly. Dyno reserves profile and instance flags so a test can't accidentally borrow your normal browser profile. It doesn't download browsers during a run.

## Firefox on macOS 27

Firefox 157 and earlier can fail before loading the URL with `Could not find profile folder`, even with a fresh profile. Mozilla fixed the shared app-data lookup in Firefox 158. Use a current installed build with native/WebDriver mode, a fixed Playwright build, or `--manual` and open the URL through Firefox normally. We keep the browser's diagnostic output in the CLI error. [Mozilla's report](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476), [upstream fix tracking](https://github.com/microsoft/playwright/issues/42768).

Dyno doesn't change OS permissions, rewrite Firefox's application metadata, or change your installed browser. The suite passed in local Chrome and a disposable official Firefox Beta 159 build. Linux Firefox ESR 153 was also verified inside a disposable container limited to one CPU during the launcher work. Both Vizzly workflows passed in the earlier Chrome/Firefox integration checks. Installed Firefox 157 reproduced the macOS startup failure above.

## Verification

`npm test` uses Chrome. `npm run test:firefox` uses Firefox; `node scripts/test.js edge` selects Edge. Set the matching executable environment variable when needed.

The CI matrix runs the same CLI, app, gateway, and packaged-install checks on macOS and Linux with Chrome, Firefox, and Edge. It uses complete browser installations and logs the selected executable before testing. The actual browser reports its user agent when it joins; the test script does not launch a separate `--version` process. Adding the workflow is not a claim that CI has passed. Windows discovery and process-tree cleanup are implemented but still need a Windows verification run. Safari 27.0.1 also passed the read-only demo through the visible URL handoff. Its headless rejection and capability reporting have automated checks; its full suite still needs a visible macOS verification run.

## CI setup

Chrome, Firefox, and macOS Edge use the installations supplied by GitHub's [Ubuntu image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) and [macOS image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md). Linux Edge installs the full stable package from Microsoft's signed apt repository before testing; the image's preinstalled copy intermittently stalled before opening the test URL. We use the package installer so its dependencies, sandbox helper, and metadata are installed together.

Ubuntu's hosted Edge installation also had incorrect sandbox permissions. The Linux Edge job restores `/opt/microsoft/msedge/msedge-sandbox` to `root:root` and mode `4755` before testing, matching the browser's diagnostic and [Chromium's sandbox setup](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/suid_sandbox_development.md). The image also loaded conflicting AppArmor attachments for Edge, which blocked its user namespaces. The job replaces those attachments with one explicit Edge profile allowing `userns`, following [Chromium’s AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md). These repairs stay in CI; Dyno does not change installed browser permissions or security profiles.

Linux CI runs inside `dbus-run-session`, which supplies a real session bus and closes it when the test command exits. Edge stalled before joining Dyno with repeated D-Bus errors when launched without that session. [Chromium's test harness](https://chromium.googlesource.com/chromium/src/testing/+/ad2ea17bd4c3ab9c8b702bda00746990cac785d6/xvfb.py) also supplies a bus for headless tests to avoid startup hangs.

Acceptance fixtures use Dyno's normal 10-second test and 60-second run limits, including cold browser startup. The outer Node deadline leaves room for CLI cleanup. Only tests of timeout behavior use short deadlines. Tests wait for CLI events, HTTP responses, and browser assertions; the held-navigation check releases the real app response explicitly. There are no test retries or startup sleeps.

The packaged-install check uses its own empty npm cache and normal registry access. `npm ci` can cache exact tarballs without caching the package metadata needed by a fresh project's install, so `--offline` was an invalid assumption there. This check needs network access just like the documented first installation.

Browser completion deadlines include recent browser output, so a browser that stays alive without joining doesn't hide its startup diagnostics.

On macOS, process cleanup checks for live group members when the OS reports `EPERM`. A group containing only exited zombie processes is already stopped; a live process that cannot be signalled still fails cleanup.
