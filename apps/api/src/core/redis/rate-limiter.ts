import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { REDIS } from './redis.token.js';

export interface Limit {
  /** Logical bucket name, e.g. "otp:phone". */
  name: string;
  /** What is being limited: a phone number, an IP, a member id. */
  subject: string;
  max: number;
  windowSeconds: number;
  /** IP-keyed limits are scaled by RATE_LIMIT_IP_MULTIPLIER. */
  perIp?: boolean;
  /** What the 429 says instead of the generic "too many attempts". */
  message?: string;
}

export class TooManyRequestsException extends HttpException {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Juda ko‘p urinish',
  ) {
    super({ statusCode: 429, message, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** Fixed-window counters in Redis, shared by every API instance. */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Counts one hit against every limit; throws 429 if any is exceeded. */
  async consume(...limits: Limit[]): Promise<void> {
    const results = await Promise.all(limits.map((l) => this.hit(l)));
    const blocked = results.filter((r) => !r.allowed);
    if (blocked.length) {
      throw new TooManyRequestsException(
        Math.max(...blocked.map((r) => r.retryAfterSeconds)),
        blocked.some((r) => r.message) ? blocked.find((r) => r.message)!.message : undefined,
      );
    }
  }

  // Failure-only counting, for secrets people enter all day (PINs): successful
  // attempts are free, failed ones count, and a success clears the count.

  /** Throws 429 if the failure budget is already spent; does not count this attempt. */
  async assertNotBlocked(limit: Limit): Promise<void> {
    const key = this.key(limit);
    const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    if (Number(count ?? 0) >= this.max(limit)) {
      throw new TooManyRequestsException(Math.max(ttl, 1), limit.message);
    }
  }

  async recordFailure(limit: Limit): Promise<void> {
    await this.hit(limit);
  }

  async reset(limit: Limit): Promise<void> {
    await this.redis.del(this.key(limit));
  }

  private key(limit: Limit): string {
    return `rl:${limit.name}:${limit.subject}`;
  }

  private max(limit: Limit): number {
    return limit.perIp ? Math.ceil(limit.max * this.env.RATE_LIMIT_IP_MULTIPLIER) : limit.max;
  }

  private async hit(
    limit: Limit,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number; message?: string }> {
    const key = this.key(limit);
    const max = this.max(limit);
    // INCR and EXPIRE NX in one transaction: the window starts at the first hit
    const result = await this.redis
      .multi()
      .incr(key)
      .expire(key, limit.windowSeconds, 'NX')
      .ttl(key)
      .exec();
    if (!result) throw new Error('Redis transaction aborted');
    const count = Number(result[0]?.[1]);
    const ttl = Number(result[2]?.[1]);
    return { allowed: count <= max, retryAfterSeconds: Math.max(ttl, 1), message: limit.message };
  }
}
