import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { Public } from '../core/auth/auth-context.js';
import { Database } from '../core/db/database.js';
import { REDIS } from '../core/redis/redis.token.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      sql`select 1`.execute(this.db.kysely).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      this.redis.ping().then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);
    const body = { status: database === 'up' && redis === 'up' ? 'ok' : 'error', database, redis };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
