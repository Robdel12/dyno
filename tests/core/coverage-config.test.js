import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../helpers/project.js';

test('coverage configuration errors explain the invalid option before starting the app', { timeout: 15000 }, async t => {
  for (let [coverage, message] of [
    [{ enabled: 'yes' }, 'coverage.enabled must be a boolean'],
    [{ include: [] }, 'coverage.include must be an array'],
    [{ reporters: ['mystery'] }, 'coverage.reporters supports'],
    [{ thresholds: { branches: 101 } }, 'coverage.thresholds accepts'],
    [{ baseline: '' }, 'coverage.baseline must be a non-empty path'],
    [{ provider: 'chromium' }, 'Unknown coverage option: provider'],
  ]) {
    let fixture = await project(t, { config: { coverage } });
    let result = await fixture.run(['--coverage']).completion;
    assert.equal(result.code, 1);
    assert(result.stderr.includes(message), result.stderr);
    assert.equal(result.events.some(event => event.type === 'ready'), false);
  }
});
