/**
 * `examples/vizzly` demonstrates login and navigation against a real app and database. It needs a Vizzly checkout with built `dist` assets and Docker. Set `VIZZLY_ROOT` if the checkout isn't the sibling `vizzly` directory.
 *
 * Run `npm run test:vizzly`, or append `-- --ui` to inspect it. Setup creates its own PostgreSQL and Redis containers, runs migrations and seeds, and supplies a disposable account. The app uses port 3017 and the gateway uses 7359. Cleanup removes only that run's containers and volumes.
 *
 * This example is optional. `npm test` uses the self-contained fixture app.
 *
 * @guide vizzly Vizzly example
 */

import { fileURLToPath } from 'node:url';

let root = process.env.VIZZLY_ROOT ?? fileURLToPath(new URL('../../../vizzly/', import.meta.url));

export default {
  testDir: './tests',
  setup: './setup.js',
  timeout: 20000,
  runTimeout: 90000,
  port: 7359,
  webServer: {
    command: [process.execPath, 'tests/e2e/test-server.js'],
    cwd: root,
    url: 'http://127.0.0.1:3017',
    ready: 'E2E test server running',
    timeout: 60000,
    reuseExistingServer: false,
    env: { NODE_ENV: 'test', PORT: '3017', E2E_TEST: 'true', CSP_REPORT_ONLY: 'false' }
  }
};
