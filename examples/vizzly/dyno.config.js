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
