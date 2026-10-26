# Working on Dyno

Read [vision.md](vision.md) before changing the API or execution model. Keep [README.md](README.md) short; detailed configuration belongs in [docs/guide.md](docs/guide.md).

Use plain JavaScript ES modules, prefer `let`, and keep functions small. Prefer immutable data and explicit inputs; keep browser, filesystem, network, and process effects at the boundaries. Avoid compatibility wrappers and parallel implementations.

Tests should run the CLI and real browser/app workflows. Do not mock Dyno internals or add arbitrary sleeps. Run `npm test`; use `npm run test:vizzly` for changes that affect app integration. Interactor.js owns convergence and DOM interaction.

Commits start with a gitmoji. Keep docs and comments conversational, practical, and brief. Never add co-author or AI attribution.
