export default {
  testDir: './tests',
  port: 7358,
  webServer: {
    command: ['node', 'server.js'],
    url: 'http://127.0.0.1:4301',
    ready: 'Contact card listening',
    reuseExistingServer: !process.env.CI
  }
};
