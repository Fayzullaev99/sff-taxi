import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { RateLimiter } from './rate-limiter.js';
import { REDIS } from './redis.token.js';

export { REDIS };

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
    RateLimiter,
  ],
  exports: [REDIS, RateLimiter],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
