# What we're building

Dyno makes acceptance tests feel like working on the app itself. Open a URL, run the tests in a real browser, and debug them there. A browser shouldn't need a dedicated driver to join a test run.

The CLI handles the boring parts: starting the app, bundling tests, serving the runner, and reporting results. Interactor.js handles DOM interaction and assertions. Tests live in their own JavaScript context and can read the app's DOM directly.

## Keep it simple

- One config and a useful first test. Setup should be easy to understand.
- Prefer small functions, immutable data, and composition. Keep effects at the edges.
- Test through real user workflows. Mock external services only when necessary.
- Retry observations; keep side effects deliberate. Explain failures clearly.
- Treat storage and backend cleanup as explicit project choices.

Keep the browser execution model as we grow. Optional browser controllers handle launch, screenshots, and host sizing. Tests and Interactor stay browser-local. The app fills a stable frame; the reporter uses its own overlay or observer URL. Extra capabilities explain their requirements and limits. Avoid a big orchestration platform or a framework-specific integration for every app.
