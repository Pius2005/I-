/**
 * Dev-only PostgreSQL launcher.
 *
 * `npm run db:embedded` (repo root) starts a real PostgreSQL server using the
 * binaries shipped in `@embedded-postgres/<platform>-<arch>`, for machines
 * without Docker. The API never uses this module; production runs on
 * docker-compose or a managed Postgres.
 *
 * Windows builds of PostgreSQL refuse to run when the binary or data directory
 * path contains non-ASCII characters — and this repository is called "Iṣẹ́".
 * So both the binaries and the data directory are mirrored into an ASCII
 * directory under the OS temp folder, which is also where the existing local
 * verification setup lives.
 *
 * Environment overrides: EMBEDDED_PG_PORT, EMBEDDED_PG_DB, EMBEDDED_PG_USER,
 * EMBEDDED_PG_PASSWORD, EMBEDDED_PG_DIR (base working directory).
 *
 * Press Ctrl+C to stop. Data persists between runs.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const port = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const database = process.env.EMBEDDED_PG_DB ?? 'ise';
const user = process.env.EMBEDDED_PG_USER ?? 'ise';
const password = process.env.EMBEDDED_PG_PASSWORD ?? 'ise_password';

const isWindows = process.platform === 'win32';
const exe = (name: string) => (isWindows ? `${name}.exe` : name);

function platformPackage() {
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  return `@embedded-postgres/${platform}-${process.arch}`;
}

/** Locate a package directory without relying on export-mapped subpaths. */
function packageDir(name: string) {
  let current: string;
  try {
    current = path.dirname(require.resolve(name));
  } catch {
    current = path.dirname(require.resolve(`${name}/package.json`));
  }
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not locate the ${name} package. Run npm install first.`);
}

const baseDir = process.env.EMBEDDED_PG_DIR
  ? path.resolve(process.env.EMBEDDED_PG_DIR)
  : path.join(os.tmpdir(), 'ise-embedded-pg');
const binRoot = path.join(baseDir, 'native', 'bin');
const dataDir = path.join(baseDir, 'data');
const logFile = path.join(baseDir, 'pg.log');
const pwFile = path.join(baseDir, '.pgpass-init');

const bin = (name: string) => path.join(binRoot, exe(name));

async function ensureBinaries() {
  const pgCtl = bin('pg_ctl');
  if (existsSync(pgCtl)) return;
  const source = path.join(packageDir(platformPackage()), 'native');
  if (!existsSync(source)) {
    throw new Error(
      `PostgreSQL binaries were not found at ${source}. Run npm install so ${platformPackage()} is downloaded.`,
    );
  }
  await mkdir(baseDir, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`Copying PostgreSQL binaries to ${binRoot} so a Unicode project path cannot break them.`);
  await cp(source, path.join(baseDir, 'native'), { recursive: true, force: true });
}

/** initdb rejects an existing non-empty directory, so only run it once. */
async function ensureDataDir() {
  if (existsSync(path.join(dataDir, 'PG_VERSION'))) return;
  await mkdir(dataDir, { recursive: true });
  await writeFile(pwFile, password, { encoding: 'utf8' });
  await runQuiet(bin('initdb'), [
    '-D',
    dataDir,
    '-U',
    user,
    '--auth=scram-sha-256',
    `--pwfile=${pwFile}`,
    '--encoding=UTF8',
    '--locale=C',
  ]);
}

/**
 * `execFile` cannot feed stdin, and the bundled binaries do not ship `createdb`,
 * so databases are created through PostgreSQL's single-user mode.
 */
function runWithInput(file: string, args: string[], input: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || /already exists/i.test(stderr)) return resolve();
      reject(new Error(`${path.basename(file)} exited with code ${code}: ${stderr.trim().slice(-400)}`));
    });
    child.stdin.end(input);
  });
}

/**
 * Runs a helper with no inherited stdio. `pg_ctl` hands its stdio to the
 * postmaster it spawns, so capturing output here would keep the pipe open for
 * as long as the database runs and the promise would never settle.
 */
function runQuiet(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${path.basename(file)} exited with code ${code}`));
    });
  });
}

function ensureDatabase() {
  if (!/^[a-z_][a-z0-9_]*$/i.test(database)) {
    throw new Error(`EMBEDDED_PG_DB must be a simple identifier, received "${database}".`);
  }
  return runWithInput(
    bin('postgres'),
    ['--single', '-D', dataDir, 'postgres'],
    `CREATE DATABASE \"${database}\";\n`,
  );
}

async function isRunning() {
  try {
    await runQuiet(bin('pg_ctl'), ['-D', dataDir, 'status']);
    return true;
  } catch {
    return false;
  }
}

async function start() {
  await ensureBinaries();
  await ensureDataDir();
  if (await isRunning()) return;
  // Single-user mode needs an idle cluster, so create the database before boot.
  await ensureDatabase();
  await runQuiet(bin('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o', `-p ${port}`, '-w', 'start']);
}

function stop() {
  return runQuiet(bin('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop']).catch(() => undefined);
}

async function main() {
  await start();

  // eslint-disable-next-line no-console
  console.log(
    `\nPostgreSQL ${port > 0 ? `is running on port ${port}` : ''} (user ${user}, database ${database}).\n` +
      `Data directory: ${dataDir}\n` +
      `DATABASE_URL=postgresql://${user}:${password}@localhost:${port}/${database}?schema=public\n\n` +
      `Leave this terminal open. Ctrl+C stops the database.\n`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\nReceived ${signal}; stopping PostgreSQL...`);
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start embedded PostgreSQL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
