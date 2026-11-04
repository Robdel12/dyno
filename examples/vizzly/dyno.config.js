/**
 * @guide vizzly Real app example: Vizzly
 * `examples/vizzly` runs login and navigation against the real app and database. You'll need a Vizzly checkout with built `dist` assets and Docker. Set `VIZZLY_ROOT` if it isn't the sibling `vizzly` directory.
 *
 * Run `npm run test:vizzly`, or add `-- --ui` to inspect it. Setup creates private PostgreSQL and Redis containers, runs migrations and seeds, and provides a disposable account. The app uses port 3017; the gateway uses 7359. Cleanup removes only that run's containers and volumes.
 *
 * This integration is optional. `npm test` uses a self-contained fixture app.
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
