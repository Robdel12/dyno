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

Dyno doesn't change OS permissions, rewrite Firefox's application metadata, or change your installed browser. All 41 checks passed in local Chrome and a disposable official Firefox Beta 159 build. They also passed in Linux Firefox ESR 153 inside a disposable container limited to one CPU. Both Vizzly workflows passed in the earlier Chrome/Firefox integration checks. Installed Firefox 157 reproduced the macOS startup failure above.

## Verification

`npm test` uses Chrome. `npm run test:firefox` uses Firefox; `node scripts/test.js edge` selects Edge. Set the matching executable environment variable when needed.

The CI matrix runs the same CLI, app, gateway, and packaged-install checks on macOS and Linux with Chrome, Firefox, and Edge. It uses the complete browser installations supplied by the hosted runner image and logs the selected executable and version before testing. Adding the workflow is not a claim that CI has passed. Windows discovery and process-tree cleanup are implemented but still need a Windows verification run. Safari 27.0.1 also passed the read-only demo through the visible URL handoff. Its headless rejection and capability reporting have automated checks; its full suite still needs a visible macOS verification run.

## CI setup

The six CI jobs use the browser installations supplied by GitHub's [Ubuntu image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) and [macOS image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md). Unpacked browser downloads caused sandbox and app-bundle startup failures.

Ubuntu's hosted Edge installation also had incorrect sandbox permissions. The Linux Edge job restores `/opt/microsoft/msedge/msedge-sandbox` to `root:root` and mode `4755` before testing, matching the browser's diagnostic and [Chromium's sandbox setup](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/suid_sandbox_development.md). This repair stays in CI; Dyno does not change installed browser permissions.

Linux CI runs inside `dbus-run-session`, which supplies a real session bus and closes it when the test command exits. Edge stalled before joining Dyno with repeated D-Bus errors when launched without that session. [Chromium's test harness](https://chromium.googlesource.com/chromium/src/testing/+/ad2ea17bd4c3ab9c8b702bda00746990cac785d6/xvfb.py) also supplies a bus for headless tests to avoid startup hangs.

Acceptance fixtures use Dyno's normal 10-second test and 60-second run limits, including cold browser startup. The outer Node deadline leaves room for CLI cleanup. Only tests of timeout behavior use short deadlines. Tests wait for CLI events, HTTP responses, and browser assertions; the held-navigation check releases the real app response explicitly. There are no test retries or startup sleeps.

The packaged-install check uses its own empty npm cache and normal registry access. `npm ci` can cache exact tarballs without caching the package metadata needed by a fresh project's install, so `--offline` was an invalid assumption there. This check needs network access just like the documented first installation.

Browser completion deadlines include recent browser output, so a browser that stays alive without joining doesn't hide its startup diagnostics.
