import { describe, test } from 'dyno';
import metadata from '../../../package.json' with { type: 'json' };

let releaseVersion = `v${metadata.version}`;
let releasePath = `/dyno/${releaseVersion}/`;

describe('Documentation', () => {
  test('reads API copy and the real command flags', async ({ app, I }) => {
    await app.goto('/dyno/next/api/readme/');
    await I.scope('$(main)').click('Application');
    await I.find('$(h1)').text('Application');
    await I.scope('$(main)').assert(({ $ }) => $.textContent.includes('Navigate to a same-origin app path'));
    await app.screenshot('docs-api-desktop');
    await app.goto('/dyno/next/api/dyno/interfaces/testdescriptor/');
    await I.scope('$(tr:has(#property-skipreason))').assert(({ $ }) => $.textContent.includes('null'));
    await app.goto('/dyno/next/cli/');
    await I.find('$(h1)').text('Commands and flags');
    await I.scope('$(main)').assert(({ $ }) => $.textContent.includes('--workers'));
  });

  test('changes versions and searches inside the frozen release', async ({ app, I }) => {
    await app.goto('/dyno/next/');
    await I.scope('$(main)').assert(({ $ }) => $.textContent.includes('Next-only documentation marker'));
    await I.find(releaseVersion).times(1);
    await I.click(releaseVersion);
    await I.assert(() => app.window.location.pathname === releasePath, 'Expected the frozen release');
    await I.find('Version').value(releasePath);
    await I.scope('$(main)').assert(({ $ }) => !$.textContent.includes('Next-only documentation marker'));
    await I.click('$(button[data-open-modal])');
    await I.scope('$(dialog)').find('Search').then.fill('screenshots');
    await I.find('$(.pagefind-ui__result-link)').rendered();
    await I.assert(() => [...app.document.querySelectorAll('.pagefind-ui__result-link')].every(link => new URL(link.href).pathname.startsWith(releasePath)), 'Expected results from the selected release');
  });

  test('can read and navigate on a phone viewport', async ({ app, I }) => {
    await app.setViewport({ width: 390, height: 844 });
    await app.goto('/dyno/next/guides/getting-started/');
    await I.find('$(h1)').text('Write your first test');
    await I.find('$(#docs-version)').visible();
    await app.screenshot('docs-mobile-content');
    await I.assert(() => app.document.documentElement.scrollWidth <= app.window.innerWidth, 'Expected the page to fit the viewport');
    await I.click('$(button[popovertarget="starlight__sidebar"])');
    await I.find('Write tests').visible();
    await app.screenshot('docs-mobile');
  });
});
