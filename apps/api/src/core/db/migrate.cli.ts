import { migrate } from './migrate.js';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}

try {
  const applied = await migrate(url);
  console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
