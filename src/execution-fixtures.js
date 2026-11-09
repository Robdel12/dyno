import { snapshotJson, snapshotFixtureTransport } from './fixture-protocol.js';

let record = value => value && typeof value === 'object' && !Array.isArray(value);

export function executionFixtures(value, defaults, identity) {
  if (value === undefined) return Object.freeze({ fixtures: defaults });
  let input = snapshotJson(value);
  if (!record(input) || Object.keys(input).some(key => !['fixtures', 'fixtureTransport'].includes(key)))
    throw new Error('beforeExecution must return { fixtures, fixtureTransport } or undefined.');
  if (input.fixtures !== undefined && !record(input.fixtures))
    throw new Error('Execution fixtures must be a JSON object.');
  for (let name of Object.keys(input.fixtures ?? {}))
    if (Object.hasOwn(defaults, name))
      throw new Error(`Execution fixture ${name} conflicts with a static fixture.`);
  return Object.freeze({
    fixtures: snapshotJson({ ...defaults, ...input.fixtures }, { maxBytes: 8_000_000 }),
    ...(Object.hasOwn(input, 'fixtureTransport') ? { fixtureTransport: snapshotFixtureTransport(input.fixtureTransport, identity) } : {}),
  });
}
