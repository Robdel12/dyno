# Working on Dyno

Read [vision.md](vision.md) before product, API, or execution changes. Use [docs/architecture.md](docs/architecture.md) for execution and provider boundaries, [docs/design.md](docs/design.md) for reporter work, and [docs/guide.md](docs/guide.md) for current behavior. Keep [README.md](README.md) short.

Use plain JavaScript ES modules, prefer `let`, and keep functions small. Prefer immutable data and explicit inputs; keep browser, filesystem, network, and process effects at the boundaries. Avoid compatibility wrappers and parallel implementations.

Tests should run the CLI and real browser/app workflows. Don't mock Dyno internals or add arbitrary sleeps. Run `npm test`; use `npm run test:vizzly` for app integration changes when the Vizzly checkout is available. Interactor.js owns convergence and DOM interaction. [docs/ci.md](docs/ci.md) lists the test suites and CI setup.

Write docs and UI copy in plain, conversational language. Keep it brief, explain what happens, and be candid about limits. Commits start with a gitmoji. Never add co-author or AI attribution.
