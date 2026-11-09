let guides = (label, slugs) => ({
  label,
  items: slugs.map(slug => ({ slug: `guides/${slug}` })),
});

export let guideNavigation = [
  { label: 'Start here', items: [
    { label: 'Why Dyno', slug: '' },
    { slug: 'guides/getting-started' },
    { slug: 'guides/browsers' },
    { slug: 'example' },
  ] },
  guides('Write tests', ['interactors', 'suites', 'custom-interactors']),
  guides('Set up your app', ['configuration', 'app-server', 'fixtures']),
  guides('Run and debug', ['running', 'debugging', 'reports', 'timings']),
  guides('Browser features', ['screenshots', 'viewport', 'native', 'limits']),
  guides('Larger suites', ['concurrency', 'vizzly']),
];

// Browser setup is authored in Markdown; the other guides come from JSDoc.
export let guideOrder = guideNavigation.flatMap(group => group.items)
  .map(item => item.slug)
  .filter(slug => slug.startsWith('guides/') && slug !== 'guides/browsers')
  .map(slug => slug.slice('guides/'.length));
