# What we're building

Dyno is for developers writing acceptance tests for web apps. Open a URL, run the tests in that browser, and debug them there. You should be able to use another desktop browser, a phone, or a TV without needing a dedicated driver for each one.

The CLI starts the app, bundles tests, serves the runner, and reports results. Tests run in their own JavaScript context and read the app's DOM directly. Interactor.js handles interaction and assertions without a remote command for every step.

## What to preserve

- Make the first test easy to write. One config, an app URL, and ordinary browser code.
- Keep tests and Interactor in the browser. Optional controllers handle launch, screenshots, and window sizing.
- Give the app its full, unscaled viewport. Open the reporter for inspection without moving the app.
- Keep functions small, data immutable, and side effects at clear boundaries.
- Test real user workflows. Wait for observable state and explain failures plainly.
- Leave storage and backend cleanup to the project. Fresh documents don't reset a database or browser session.
- Say when a capability is unavailable. Required screenshots fail; explicitly optional screenshots can skip.

## Keep the scope small

Dyno owns the test run, its processes, and its output. Apps keep their own development servers and hot reload. Avoid an adapter for every framework or a large orchestration service.

Interactions use DOM methods and synthetic events. Physical input, real-device emulation, and visual baseline comparison are separate problems. URL-only execution is the goal across browsers; the current runner still needs modern browser APIs.

Write docs and UI copy like you're helping another developer: short, concrete, and candid about limits. See the [guide](docs/guide.md) for current behavior and the [design guide](docs/design.md) for the reporter.
