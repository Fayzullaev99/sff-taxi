import { Redis } from 'ioredis';
import pg from 'pg';
import { migrate } from '../src/core/db/migrate.js';

/** Rebuilds the test database from the real migrations and clears test Redis before the suite runs. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!/\/taxi_test\w*$/.test(url ?? ''))
    throw new Error('Refusing to reset a database that is not taxi_test*');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('DROP SCHEMA IF EXISTS taxi_meta CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await migrate(url!, () => undefined);

  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
}
