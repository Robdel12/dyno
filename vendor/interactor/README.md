# Interactor.js

Unmodified source from [Interactor.js 3.6.2](https://github.com/wwilsman/interactor.js/tree/d22e523485359a924cedfbc32ee3912c80319dbb), commit `d22e523485359a924cedfbc32ee3912c80319dbb`. Its MIT license is in [LICENSE](LICENSE).

Dyno ships this snapshot so apps don't need Git subdependencies or an Interactor build step. Types are generated from the same source with Dyno's pinned TypeScript version.

To update it, change the revision in `scripts/vendor-interactor.js` and run `npm run vendor:interactor`. Review the source and declaration diff, then run the package and browser tests. Don't edit the snapshot by hand.
