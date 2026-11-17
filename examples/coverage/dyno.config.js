export default {
  testDir: './tests',
  port: 7360,
  coverage: {
    baseline: '.dyno/coverage-baseline.json',
    include: ['src/**'],
    reporters: ['text', 'html', 'lcov', 'json'],
  },
  webServer: {
    command: ['node', 'server.js'],
    url: 'http://127.0.0.1:4302',
    ready: 'Coverage example listening',
    reuseExistingServer: false,
  },
};
