import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Same relative depth from src/core/db and dist/core/db.
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url));

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 7_231_201;

export interface MigrateOptions {
  /** Where the .sql files are (tests point elsewhere). */
  dir?: string;
  /**
   * How long one statement may wait for a table lock. ALTER TABLE on a busy table queues
   * behind a long transaction and every query behind it queues too: better to fail the
   * deploy fast and retry than to freeze the live API. 0 = wait forever.
   */
  lockTimeoutMs?: number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

/**
 * Applies pending migrations in filename order, each in its own transaction.
 * Must run as the schema owner. Fails if an already-applied file was edited.
 * Bookkeeping lives in the taxi_meta schema, which the runtime role cannot see.
 */
export async function migrate(
  connectionString: string,
  log: (message: string) => void = console.log,
  options: MigrateOptions = {},
): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('CREATE SCHEMA IF NOT EXISTS taxi_meta');
    await client.query(`
      CREATE TABLE IF NOT EXISTS taxi_meta.schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM taxi_meta.schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();

    for (const name of applied.keys()) {
      if (!files.includes(name)) throw new Error(`Applied migration ${name} is missing on disk`);
    }

    const newlyApplied: string[] = [];
    for (const name of files) {
      // normalise line endings so a Windows checkout hashes the same as CI
      const body = (await readFile(join(dir, name), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(body).digest('hex');
      const known = applied.get(name);
      if (known !== undefined) {
        if (known !== checksum) {
          throw new Error(
            `Migration ${name} was modified after being applied; add a new migration instead`,
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL lock_timeout = ' + Math.max(0, Math.trunc(lockTimeoutMs)));
        await client.query(body);
        await client.query(
          'INSERT INTO taxi_meta.schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, { cause: error });
      }
      log(`applied ${name}`);
      newlyApplied.push(name);
    }
    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
