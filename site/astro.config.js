import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';
import { guideNavigation } from './navigation.js';
import { settings } from './scripts/settings.js';

let { base } = settings();
export default defineConfig({
  site: 'https://robdel12.github.io',
  base,
  outDir: './dist',
  integrations: [starlight({
    title: 'Dyno',
    description: 'Browser tests that run in the browser.',
    social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Robdel12/dyno' }],
    customCss: ['./src/styles/docs.css'],
    components: { Header: './src/components/Header.astro' },
    plugins: [starlightTypeDoc({
      entryPoints: ['./.generated/types/dyno.d.ts', './.generated/types/config.d.ts'],
      tsconfig: './tsconfig.json',
      typeDoc: {
        name: 'API reference',
        readme: './.generated/overview.md',
        excludeInternal: true,
        excludeExternals: true,
        disableSources: true,
        expandObjects: true,
        expandParameters: true,
        parametersFormat: 'table',
        interfacePropertiesFormat: 'table',
        classPropertiesFormat: 'table',
        alwaysCreateEntryPointModule: true,
      },
    })],
    sidebar: [
      ...guideNavigation,
      { slug: 'cli' },
      typeDocSidebarGroup,
      { label: 'Contribute', items: [{ autogenerate: { directory: 'contributing' } }] },
    ],
  })],
});
