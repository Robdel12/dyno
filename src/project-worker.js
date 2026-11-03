import { normalizeConfig } from './config.js';

let record = value => value && typeof value === 'object' && !Array.isArray(value);
let snapshot = value => {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (record(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
  return value;
};

export function projectWorker(config, project, index, defaults = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project))
    throw new Error('createWorker must return a project worker with its app configuration.');
  for (let key of Object.keys(project))
    if (!['webServer', 'env', 'fixtures', 'drain', 'teardown'].includes(key))
      throw new Error(`Unknown project worker option: ${key}.`);
  for (let input of [defaults, project])
    for (let name of ['webServer', 'env', 'fixtures'])
      if (input[name] !== undefined && !record(input[name])) throw new Error(`Project worker ${name} must be an object.`);
  for (let name of ['drain', 'teardown'])
    if (project[name] !== undefined && typeof project[name] !== 'function')
      throw new Error(`Project worker ${name} must be a function.`);
  let webServer = normalizeConfig({ webServer: {
    ...config.webServer, ...defaults.webServer, ...project.webServer,
    env: { ...config.webServer.env, ...defaults.webServer?.env, ...defaults.env, ...project.webServer?.env, ...project.env },
  } }, config.file).webServer;
  let fixtures;
  try { fixtures = snapshot(JSON.parse(JSON.stringify({ ...defaults.fixtures, ...project.fixtures }))); }
  catch (error) { throw new Error('Project worker fixtures must be JSON-serializable.', { cause: error }); }
  return Object.freeze({
    config: Object.freeze({ ...config, port: index === 0 ? config.port : 0, webServer }),
    fixtures,
    drain: project.drain ?? defaults.drain,
  });
}
