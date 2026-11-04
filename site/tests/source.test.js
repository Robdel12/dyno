import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceDocs, documentedTypes } from '../scripts/source.js';
import { settings } from '../scripts/settings.js';

let source = `/**
 * Save a real contact.
 * @example
 * await app.goto('/contacts');
 * @api Application
 */
/**
 * Navigate to a real route.
 * @api Application.goto
 */
/**
 * Use your existing app server.
 * @guide app-server App server
 */
export function createApp() {}
`;
test('source copy and examples attach to the actual public signature', () => {
  let { api, guides } = sourceDocs([{ path: 'app.js', text: source }]);
  let declaration = 'export interface Application { goto(path: string): Promise<void>; }';
  let result = documentedTypes('app.d.ts', declaration, api, new Set());
  assert.match(result, /Save a real contact/);
  assert.match(result, /@example\n \* await app.goto/);
  assert.match(result, /Navigate to a real route/);
  assert.match(result, /goto\(path: string\): Promise<void>/);
  assert.doesNotMatch(result, /@api/);
  assert.equal(guides.get('app-server').title, 'App server');
  assert.throws(() => documentedTypes('app.d.ts', declaration + '\nexport let undocumented: string;', api, new Set()), /undocumented.*needs source JSDoc/);
  assert.throws(() => sourceDocs([{ path: 'app.js', text: source + source }]), /Duplicate @api Application/);
  assert.throws(() => sourceDocs([{ path: 'app.js', text: '/**\n * @api App\n * @api Other\n */\nlet app;' }]), /one @api or @guide/);
  let internal = documentedTypes('app.d.ts', 'type Private = string;\n' + declaration, api, new Set());
  assert.match(internal, /@internal/);
});

test('version and base settings cannot escape their published directory', () => {
  assert.deepEqual(settings({}), { version: 'next', path: '/dyno/', base: '/dyno/next/' });
  assert.equal(settings({ DYNO_DOCS_VERSION: 'v1.2.3-rc.1', DYNO_DOCS_PATH: '/' }).base, '/v1.2.3-rc.1/');
  for (let version of ['../main', 'v01.2.3', 'v1.2', '<script>', 'v1.2.3/other'])
    assert.throws(() => settings({ DYNO_DOCS_VERSION: version }));
  for (let path of ['//other/', '/docs/../', '/docs', '/<script>/'])
    assert.throws(() => settings({ DYNO_DOCS_PATH: path }));
});
