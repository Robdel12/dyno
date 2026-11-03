# Working on the docs

Guides and API explanations live in JavaScript JSDoc, beside the code they describe. Astro and Starlight build the site. The site has its own dependencies; installing Dyno never installs them.

## Write once

Use `@guide slug Page title` on a JSDoc block for a guide. Add its slug to `guideOrder` in `site/scripts/generate.js`. Use `@api Application.goto` for an API explanation. These two build tags connect prose to a page or declaration; ordinary JSDoc such as `@example` still works.

Public signatures come from `types/`. The generator attaches source copy to temporary declarations, then TypeDoc builds the reference. Missing public API copy, duplicate tags and stale API names fail the build. Keep declarations accurate when changing behavior. Runtime code never imports documentation tooling.

The CLI page comes from actual `--help` output. The complete test example comes from `examples/demo/tests/contact.test.js`, which the browser suite runs. Repository architecture, browser support and contributor docs remain Markdown.

```sh
npm ci
npm --prefix site ci
npm --prefix site run dev
npm --prefix site run build
npm --prefix site test
```

After changing a source guide, run `npm --prefix site run generate -- --write-markdown`. Commit the generated `docs/guide.md` and `docs/api.md` for GitHub and installed packages. CI checks it. Generated site content and temporary declarations stay ignored. Restart the docs dev server after editing source comments; Astro watches the generated pages and site components.

## Versions

Next builds from the current checkout. A release tag such as `v0.1.0` must match `package.json`. Release builds require a clean tree and record the commit, package version and URL base in `version.json`. They keep the full HTML, assets and search index from that checkout. We don't create old docs by running today's generator on yesterday's Markdown.

The Release documentation workflow builds published GitHub releases. Docs rebuilds Next on main and assembles the site after a release upload completes. A published release receives its package tarball and a `dyno-docs-<tag>.tar.gz` asset. Existing assets are never overwritten. Use a new version to fix released docs. Only published releases are archived. Prereleases appear in the version picker; the homepage prefers the newest stable release, or Next before the first stable release.

Each publication downloads released docs assets and assembles them alongside Next. The archive command refuses to replace a version with different bytes or mix URL bases. `versions.json` and the root index can change; version directories stay unchanged. Frozen pages fetch that index for the version picker. If it cannot load, the current docs and search still work. Changing versions opens that version's homepage, since APIs can disappear between releases.

Search stays inside the chosen version. The default URL base is `/dyno/`; set `DYNO_DOCS_PATH` consistently when hosting elsewhere. Change `site` in `site/astro.config.js` for a custom domain. `DYNO_DOCS_VERSION` defaults to `next`. Build output is `site/dist`; assembled hosting output is `site/published`.

## Publish

The workflow always uploads a reviewable site artifact. To deploy it, enable GitHub Pages with **GitHub Actions** as the source and set the repository variable `DYNO_DOCS_DEPLOY=true`. The deployment job uses the `github-pages` environment. This is the only hosting switch; local builds never deploy anything.

Create the release tag from the intended clean commit, with the same version in `package.json`, then publish its GitHub release. The workflow checks the tag and builds both package and docs from it. This doesn't publish to npm; Dyno is still marked private. Release assets are the durable docs archive, so keep them when tidying releases. Never attach an unrelated file with the reserved docs asset name.

CI builds the real site and checks generated Markdown, links, exact-version archives, version switching and search in a browser. Framework tests remain separate. Run both before shipping changes to the generator or release flow.
