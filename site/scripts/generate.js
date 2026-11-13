import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceDocs, documentedTypes } from './source.js';
import { guideOrder } from '../navigation.js';
import { tachometer } from '../../src/browser/dyno-chart.js';

let exec = promisify(execFile);
export let root = fileURLToPath(new URL('../../', import.meta.url));
export let site = join(root, 'site');
let read = path => readFile(join(root, path), 'utf8');
let write = async (path, text) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};
export async function generate() {
  let files = [];
  for await (let path of glob(['src/**/*.js', 'examples/vizzly/dyno.config.js'], { cwd: root }))
    files.push({ path, text: await read(path) });
  let { api, guides } = sourceDocs(files.sort((a, b) => a.path.localeCompare(b.path)));
  let output = join(site, 'src/content/docs');
  await rm(output, { recursive: true, force: true });
  await rm(join(site, '.generated'), { recursive: true, force: true });
  let used = new Set();
  for (let [source, target] of [['types/index.d.ts', 'types/dyno.d.ts'], ['types/config.d.ts', 'types/config.d.ts'], ['types/test.d.ts', 'types/test.d.ts'], ['types/fixtures.d.ts', 'types/fixtures.d.ts']])
    await write(join(site, '.generated', target), documentedTypes(source, await read(source), api, used));
  for (let key of api.keys()) if (!used.has(key)) throw new Error(`Source @api ${key} has no public declaration.`);
  let requiredGuides = [...guideOrder, 'overview', 'api-overview', 'cli'];
  for (let key of requiredGuides) if (!guides.has(key)) throw new Error(`Missing source guide ${key}.`);
  for (let key of guides.keys()) if (!requiredGuides.includes(key)) throw new Error(`Add guide ${key} to guideOrder.`);
  let overview = guides.get('overview');
  let markdown = `# Using Dyno\n\n${overview.body.split('\n\n').slice(0, 2).join('\n\n')}\n`;
  let anchors = new Map();
  let slug = heading => heading.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
  for (let key of guideOrder) {
    let guide = guides.get(key);
    anchors.set(slug(guide.title), `guides/${key}/`);
    for (let [, heading] of guide.body.matchAll(/^#{2,3} (.+)$/gm)) anchors.set(slug(heading), `guides/${key}/#${slug(heading)}`);
  }
  let base = process.env.DYNO_DOCS_BASE ?? '/dyno/next/';
  function links(body) {
    return body.replace(/\]\(([^)]+)\)/g, (match, href) => {
      let [file, hash] = href.split('#');
      file = file.replace(/^(?:\.\.\/)?docs\//, '');
      let route = { 'api.md': 'api/readme/', 'guide.md': 'guides/getting-started/', 'browsers.md': 'guides/browsers/', 'architecture.md': 'contributing/architecture/', 'design.md': 'contributing/design/', 'ci.md': 'contributing/ci/', 'documentation.md': 'contributing/documentation/' }[file];
      if (file.startsWith('api/')) route = file;
      if ((!file || file === 'guide.md') && anchors.has(hash)) route = anchors.get(hash);
      else if (hash && route) route += `#${hash}`;
      if (!route && file.startsWith('../')) {
        let resource = file.slice(3);
        let kind = resource.split('/').at(-1).includes('.') ? 'blob' : 'tree';
        return `](https://github.com/Robdel12/dyno/${kind}/${process.env.DYNO_DOCS_COMMIT ?? 'main'}/${resource}${hash ? `#${hash}` : ''})`;
      }
      if (!route) return match;
      return `](${base}${route})`;
    });
  }
  // Frontmatter is written as JSON, which is valid YAML.
  let page = async (path, frontmatter, body) => write(join(output, `${path}.md`), `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${links(body)}\n`);
  let action = (text, route, variant) => ({ text, link: base + route, variant });
  await page('index', { title: overview.title, template: 'splash', hero: {
    tagline: 'Dyno runs your tests inside the browser, right next to your app, and plots every run as it happens.',
    actions: [action('Write your first test', 'guides/getting-started/', 'primary'), action('Read the API', 'api/readme/', 'secondary')],
  } }, overview.body);
  // Starlight renders this entry at /404. Its build warns that [...slug] also lists it; the /404 route wins.
  await page('404', { title: 'Not on the sheet', template: 'splash', pagefind: false, hero: {
    tagline: "This page isn't part of these docs. Search for it, or start from the top.",
    image: { html: `<figure class="stalled">${tachometer({ phase: 'connecting', progress: 0 })}<figcaption>The needle hasn't moved. Nothing ran here.</figcaption></figure>` },
    actions: [action('Back to the docs', '', 'primary')],
  } }, '');
  for (let key of guideOrder) {
    let { title, body } = guides.get(key);
    markdown += `\n## ${title}\n\n${body.replace(/^(#{2,5}) /gm, '#$1 ')}\n`;
    await page(`guides/${key}`, { title }, body);
  }
  for (let [path, target] of [['docs/browsers.md', 'guides/browsers'], ['docs/architecture.md', 'contributing/architecture'], ['docs/design.md', 'contributing/design'], ['docs/ci.md', 'contributing/ci'], ['docs/documentation.md', 'contributing/documentation'], ['vision.md', 'contributing/vision']]) {
    let [heading, ...body] = (await read(path)).split('\n');
    await page(target, { title: heading.replace(/^# /, '') }, body.join('\n'));
  }
  await page('example', { title: 'A complete test' }, `This is the demo test we run in CI. Copy the pattern and change the workflow for your app.\n\n\`\`\`js\n${(await read('examples/demo/tests/contact.test.js')).trim()}\n\`\`\`\n`);
  let cli = guides.get('cli').body + '\n';
  for (let command of ['', 'run', 'init', 'doctor', 'browsers', 'install']) {
    let { stdout } = await exec(process.execPath, [join(root, 'bin/dyno.js'), ...(command ? [command] : []), '--help'], { cwd: root });
    cli += `\n## dyno${command ? ` ${command}` : ''}\n\n\`\`\`text\n${stdout.trim()}\n\`\`\`\n`;
  }
  await page('cli', { title: 'Commands and flags' }, cli);
  await write(join(site, '.generated/overview.md'), links(guides.get('api-overview').body) + '\n');
  let reference = '# API reference\n\n' + guides.get('api-overview').body.replace(/\[([^\]]+)\]\(api\/[^)]+\)/g, '`$1`') + '\n\nSignatures: [browser types](../types/index.d.ts), [configuration](../types/config.d.ts), [app-process fixtures](../types/fixtures.d.ts). See the [guide](guide.md) for examples.\n';
  let groups = [
    ['Tests and hooks', ['src/browser/registry.js', 'src/browser/index.js', 'src/suite.js']],
    ['Interactors', ['src/browser/interactor.js']],
    ['App and screenshots', ['src/browser/app.js']],
    ['Managed capabilities', ['src/browser/native.js']],
    ['Timings', ['src/browser/timings.js']],
    ['Configuration and Node setup', ['src/config.js', 'src/project-worker.js']],
    ['App-process fixtures', ['src/fixtures.js']],
  ];
  for (let [title, paths] of groups) {
    reference += `\n## ${title}\n\n| API | Use |\n| --- | --- |\n`;
    for (let [name, { body, path }] of api) {
      if (!paths.includes(path)) continue;
      reference += `| \`${name}\` | ${body.split('\n\n')[0].replaceAll('\n', ' ').replaceAll('|', '\\|')} |\n`;
    }
  }
  return { guide: markdown, reference };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let { guide, reference } = await generate();
  let banner = '<!-- Generated from source JSDoc. Run npm --prefix site run generate -- --write-markdown. -->\n';
  for (let [file, body] of [['docs/guide.md', guide], ['docs/api.md', reference]]) {
    if (process.argv.includes('--write-markdown')) await writeFile(join(root, file), banner + body);
    if (process.argv.includes('--check-markdown') && await read(file) !== banner + body)
      throw new Error(`${file} is stale. Run npm --prefix site run generate -- --write-markdown.`);
  }
}
