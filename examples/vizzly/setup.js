import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

let exec = promisify(execFile);

export default async function setup({ config, signal }) {
  let root = config.webServer.cwd;
  await access(join(root, 'dist/index.html'));
  let directory = await mkdtemp(join(tmpdir(), 'dyno-vizzly-'));
  let project = `dyno-vizzly-${randomUUID().slice(0, 8)}`;
  let file = join(directory, 'compose.json');
  let environment = { ...process.env, NODE_ENV: 'test', E2E_TEST: 'true', DOTENV_CONFIG_PATH: join(root, '.env.test') };
  let compose = (...args) => exec('docker', ['compose', '-p', project, '-f', file, ...args], { env: environment, signal: args[0] === 'down' ? undefined : signal, timeout: 120000, maxBuffer: 2_000_000 });
  let teardown = async () => {
    try { await compose('down', '--volumes', '--remove-orphans'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  };
  await writeFile(file, JSON.stringify({ services: {
    db: {
      image: process.env.DYNO_POSTGRES_IMAGE ?? 'postgres:17',
      network_mode: 'bridge',
      environment: { POSTGRES_DB: 'vizzly_test_db', POSTGRES_USER: 'testuser', POSTGRES_PASSWORD: 'testpassword' },
      ports: ['127.0.0.1::5432'],
      healthcheck: { test: ['CMD-SHELL', 'pg_isready -U testuser -d vizzly_test_db'], interval: '1s', timeout: '3s', retries: 60 }
    },
    redis: {
      image: process.env.DYNO_REDIS_IMAGE ?? 'redis:7-alpine',
      network_mode: 'bridge',
      ports: ['127.0.0.1::6379'],
      healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '1s', timeout: '3s', retries: 60 }
    }
  } }));
  try {
    console.error('[vizzly] Starting isolated PostgreSQL and Redis');
    await compose('up', '-d', '--wait');
    signal.throwIfAborted();
    let published = async (service, port) => {
      let { stdout } = await compose('port', service, String(port));
      return stdout.trim().split('\n')[0].split(':').at(-1);
    };
    environment.DB_PORT = await published('db', 5432);
    environment.REDIS_URL = `redis://127.0.0.1:${await published('redis', 6379)}`;
    environment.TEST_DB_PORT = environment.DB_PORT;
    for (let args of [['migrate:latest'], ['seed:run']]) {
      console.error(`[vizzly] ${args[0]}`);
      await exec(process.execPath, [join(root, 'node_modules/knex/bin/cli.js'), ...args], { cwd: root, env: environment, signal, timeout: 120000, maxBuffer: 4_000_000 });
    }
    // Reuse the app's real fixture factories; no replacement auth/API implementation.
    Object.assign(process.env, environment);
    let factories = await import(pathToFileURL(join(root, 'tests/e2e/factories/index.js')).href);
    let fixture;
    try {
      fixture = await factories.createUserWithOrganization(
        { email: 'dyno@example.test', username: 'dyno', password: 'DynoTesting123!' },
        { name: 'Dyno Tests', slug: 'dyno-tests' }
      );
    } finally { await factories.db.destroy(); }
    console.error('[vizzly] Isolated account and organization ready');
    return {
      env: environment,
      fixtures: { user: { email: fixture.user.email, password: fixture.user.password }, organization: { name: fixture.organization.name, slug: fixture.organization.slug } },
      teardown
    };
  } catch (error) { await teardown(); throw error; }
}
