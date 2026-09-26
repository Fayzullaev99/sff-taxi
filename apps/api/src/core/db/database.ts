import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import pg from 'pg';
import { ENV, type Env } from '../../config/env.js';
import type { DB } from './schema.js';

export type Tx = Transaction<DB>;

// bigint columns hold so'm amounts and sequence numbers, far below 2^53: read them as numbers
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// numeric is used for percentages and scores only
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// calendar dates (birth date, licence expiry) stay "YYYY-MM-DD": no time zone to shift them
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/** Pool settings from the environment: timeouts so nothing waits or holds a lock forever. */
export function poolConfig(env: Env): pg.PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    ...(env.DB_STATEMENT_TIMEOUT_MS ? { statement_timeout: env.DB_STATEMENT_TIMEOUT_MS } : {}),
    ...(env.DB_CONNECT_TIMEOUT_MS ? { connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS } : {}),
    ...(env.DB_LOCK_TIMEOUT_MS ? { lock_timeout: env.DB_LOCK_TIMEOUT_MS } : {}),
    ...(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
      ? { idle_in_transaction_session_timeout: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS }
      : {}),
  };
}

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  readonly kysely: Kysely<DB>;

  constructor(@Inject(ENV) env: Env) {
    const pool = new pg.Pool(poolConfig(env));
    // An idle pooled connection that dies (Postgres restarted, a failover, a terminated
    // backend) is reported as an 'error' event on the pool; without a listener Node treats
    // it as unhandled and the whole API or worker process exits.
    pool.on('error', (error) => {
      this.logger.warn(`Idle database connection lost: ${error.message}`);
    });
    this.kysely = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  }

  transaction<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.kysely.transaction().execute(fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.kysely.destroy();
  }
}

@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
