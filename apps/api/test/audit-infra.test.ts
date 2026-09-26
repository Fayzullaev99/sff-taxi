import type { ArgumentsHost } from '@nestjs/common';
import { sql } from 'kysely';
import pg from 'pg';
import pino from 'pino';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS, redactUrl } from '../src/app.module.js';
import { loadEnv } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { migrate, MIGRATIONS_DIR } from '../src/core/db/migrate.js';
import { AppExceptionFilter } from '../src/core/http/app-exception.filter.js';

/** Infrastructure regressions from the audit: pool, timeouts, error mapping, log redaction. */

function database(overrides: Record<string, string> = {}) {
  return new Database(loadEnv({ ...process.env, ...overrides }));
}

/** The status and body the global filter answers with. */
function answer(error: unknown): { status: number; body: Record<string, unknown> } {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  new AppExceptionFilter().catch(error, host);
  return out;
}

async function pgError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a database error');
}

describe('database resilience', () => {
  let owner: pg.Client;
  beforeAll(async () => {
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();
  });
  afterAll(() => owner.end());

  it('survives an idle pooled connection being killed (no process-wide crash)', async () => {
    const db = database();
    const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db.kysely);
    // what a Postgres restart or failover does to idle connections
    await owner.query('select pg_terminate_backend($1)', [rows[0]!.pid]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const again = await sql<{ ok: number }>`select 1 as ok`.execute(db.kysely);
    expect(again.rows[0]!.ok).toBe(1);
    await db.onModuleDestroy();
  });

  it('gives up waiting for a row lock and answers 409 instead of hanging', async () => {
    const db = database({ DB_LOCK_TIMEOUT_MS: '300' });
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    await holder.query('begin');
    await holder.query("select id from cities where slug = 'guliston' for update");
    const started = Date.now();
    const error = await pgError(() =>
      db.transaction((trx) =>
        sql`select id from cities where slug = 'guliston' for update`.execute(trx),
      ),
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(answer(error)).toMatchObject({ status: 409 });
    await holder.query('rollback');
    await holder.end();
    await db.onModuleDestroy();
  });

  it('fails fast with 503 when the pool is exhausted', async () => {
    const db = database({ DB_POOL_MAX: '1', DB_CONNECT_TIMEOUT_MS: '200' });
    let release!: () => void;
    const held = db.transaction(() => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const error = await pgError(() => sql`select 1`.execute(db.kysely));
    expect(answer(error)).toMatchObject({ status: 503 });
    release();
    await held;
    await db.onModuleDestroy();
  });

  it('maps a deadlock and a statement timeout to answers a client can act on', async () => {
    const db = database({ DB_STATEMENT_TIMEOUT_MS: '100' });
    const timeout = await pgError(() => sql`select pg_sleep(1)`.execute(db.kysely));
    expect(answer(timeout)).toMatchObject({ status: 503 });
    const deadlock = Object.assign(new pg.DatabaseError('deadlock detected', 0, 'error'), {
      code: '40P01',
    });
    expect(answer(deadlock)).toMatchObject({ status: 409 });
    await db.onModuleDestroy();
  });
});

describe('migrations', () => {
  it('fail fast instead of queueing every query behind a table lock they wait for', async () => {
    // the real migrations (already applied) plus one that alters a table in use
    const dir = await mkdtemp(join(tmpdir(), 'taxi-audit-migrations-'));
    for (const name of await readdir(MIGRATIONS_DIR)) {
      if (name.endsWith('.sql')) await copyFile(join(MIGRATIONS_DIR, name), join(dir, name));
    }
    await writeFile(
      join(dir, '9999_audit_lock_probe.sql'),
      'ALTER TABLE cities ADD COLUMN audit_lock_probe int;',
    );
    const reader = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await reader.connect();
    await reader.query('begin');
    await reader.query('select count(*) from cities'); // a long transaction reading it
    const started = Date.now();
    await expect(
      migrate(process.env.DATABASE_MIGRATION_URL!, () => undefined, { dir, lockTimeoutMs: 300 }),
    ).rejects.toThrow(/9999_audit_lock_probe.*lock timeout/);
    expect(Date.now() - started).toBeLessThan(5_000);
    await reader.query('rollback');
    await reader.end();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('request logs', () => {
  it('never carry the Payme key, bearer tokens, stream tickets or phones', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: LOG_REDACT_PATHS },
      new Writable({
        write(chunk, _enc, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    );
    logger.info({
      req: {
        headers: { authorization: 'Basic UGF5Y29tOmtleQ==', cookie: 'sid=secret-cookie' },
        query: { phone: '+998901112233', ticket: 'single-use-stream-ticket' },
      },
    });
    const logged = lines.join('');
    expect(logged).not.toContain('UGF5Y29tOmtleQ');
    expect(logged).not.toContain('secret-cookie');
    expect(logged).not.toContain('+998901112233');
    expect(logged).not.toContain('single-use-stream-ticket');
  });

  it('mask share-trip tokens and stream tickets in logged URLs', () => {
    expect(redactUrl('/v1/share/AbC_dEf-123?x=1')).toBe('/v1/share/[Redacted]?x=1');
    expect(redactUrl('/v1/stream?ticket=abc&x=1')).toBe('/v1/stream?ticket=[Redacted]&x=1');
    expect(redactUrl('/v1/admin/rides?phone=%2B998901112233')).toBe(
      '/v1/admin/rides?phone=[Redacted]',
    );
    expect(redactUrl('/v1/rides/quote')).toBe('/v1/rides/quote');
  });
});
