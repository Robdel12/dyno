import { describe, test, beforeEach } from 'dyno';

describe('Authentication', () => {
  beforeEach(async ({ app }) => {
    let response = await app.request('/api/auth/logout', { method: 'POST' });
    if (!response.ok && response.status !== 401) throw new Error(`Could not reset the test session: HTTP ${response.status}`);
  });

  test('signs in and opens the organization dashboard', async ({ app, I, fixtures }) => {
    await app.goto('/login');
    await I.type(fixtures.user.email).into('Username or Email');
    await I.type(fixtures.user.password).into('Password');
    await I.click('"Sign In"$(button)');

    await I.assert(() => app.window.location.pathname === `/${fixtures.organization.slug}`, 'Expected the organization dashboard URL');
    await I.find('No projects yet').visible();
    await I.find(fixtures.organization.name).visible();
  });

  test('keeps the requested destination while switching between sign-in and registration', async ({ app, I }) => {
    let destination = '/dyno-tests/settings/general?source=dyno';
    await app.goto(`/login?redirect=${encodeURIComponent(destination)}`);
    await I.click('Create account');
    await I.find('Start testing UI changes').visible();
    await I.assert(() => new URLSearchParams(app.window.location.search).get('redirect') === destination, 'Expected registration to preserve the redirect');
    await I.click('"Sign in"$(button)');
    await I.find('Welcome back').visible();
    await I.assert(() => new URLSearchParams(app.window.location.search).get('redirect') === destination, 'Expected sign-in to preserve the redirect');
  });
});
