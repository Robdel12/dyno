# Working on the docs

Guides and API copy live in JavaScript JSDoc, beside the code they describe. Astro and Starlight build the site with their own dependencies; installing Dyno never installs docs tooling.

## Write once

Use `@guide slug Page title` for a guide, then add its slug to `site/navigation.js`. That list controls the sidebar and portable guide order. Use `##` headings within a guide; the generator nests them in portable Markdown.

Use `@api Application.goto` for an API explanation. Public signatures come from `types/`; TypeDoc combines them with source copy. Missing copy, duplicate tags, and stale API names fail the build. Keep declarations accurate when behavior changes.

The CLI page uses actual `--help` output. The complete test comes from `examples/demo/tests/contact.test.js`, which the browser suite runs. Browser support and contributor docs stay in Markdown.

```sh
npm ci
npm --prefix site ci
npm --prefix site run dev
npm --prefix site run build
npm --prefix site test
```

After editing source comments, run `npm --prefix site run generate -- --write-markdown`. Commit the generated `docs/guide.md` and `docs/api.md`; CI checks them. Restart the dev server after source edits. Generated site content and temporary declarations stay ignored.

## Build versions

Next builds from the current checkout. A release tag such as `v0.1.0` must match `package.json` and have a clean tree. Release docs keep that checkout's HTML, assets, search index, and commit metadata. We don't rebuild old versions with today's generator.

Publishing a GitHub release triggers the Release documentation workflow. It attaches a package tarball and `dyno-docs-<tag>.tar.gz`; existing assets are never overwritten. Cut a new version to fix released docs. This doesn't publish to npm—Dyno is still marked private.

The Docs workflow builds Next on main and assembles the site after release uploads. It downloads published release archives and preserves their version directories. Keep those assets when tidying releases, and don't use the reserved filename for other files.

Prereleases appear in the version picker. The homepage prefers the newest stable release, or Next before the first one. Switching versions opens that version's homepage; search stays within it. Frozen pages fetch `versions.json` for the picker and still work if it can't load.

## Publish

GitHub Pages uses **GitHub Actions** as its source, with `DYNO_DOCS_DEPLOY=true` as the repository variable. The workflow uploads a reviewable artifact before deploying through the `github-pages` environment. Local builds never deploy.

The default URL base is `/dyno/`. Set `DYNO_DOCS_PATH` consistently to host elsewhere; change `site` in `site/astro.config.js` for a custom domain. `DYNO_DOCS_VERSION` defaults to `next`. Builds go to `site/dist`; assembled output goes to `site/published`. Archive assembly rejects conflicting versions or mixed URL bases.

Before shipping generator or release changes, run both docs and framework tests. Docs tests check generated Markdown, links, exact-version archives, version switching, and search in a real browser.
