import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import pg from 'pg';
import { ENV, type Env } from '../../config/env.js';
import type { DB } from './schema.js';

export type Tx = Transaction<DB>;

// bigint columns hold so'm amounts and sequence numbers, far below 2^53: read them as numbers
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// numeric is used for percentages only
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

@Injectable()
export class Database implements OnModuleDestroy {
  readonly kysely: Kysely<DB>;

  constructor(@Inject(ENV) env: Env) {
    this.kysely = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          connectionString: env.DATABASE_URL,
          max: env.DB_POOL_MAX,
          ...(env.DB_STATEMENT_TIMEOUT_MS
            ? { statement_timeout: env.DB_STATEMENT_TIMEOUT_MS }
            : {}),
        }),
      }),
    });
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
