import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth-context.js';
import { RateLimiter } from '../redis/rate-limiter.js';

export interface RouteLimit {
  /** Bucket name, e.g. "rides:quote". */
  name: string;
  max: number;
  windowSeconds: number;
  /**
   * ip: per client address (scaled by RATE_LIMIT_IP_MULTIPLIER); user: per signed-in
   * account, falling back to the address for anonymous callers.
   */
  by: 'ip' | 'user';
}

const RATE_LIMITS = 'http:rate-limits';

/**
 * Per-route limits, counted in Redis across every API instance. For public and costly
 * routes (quote, tariffs, geo, auth, the trip board); never for provider callbacks
 * (Payme, Click), which come from a few shared addresses and retry on 429.
 */
export const RateLimit = (...limits: RouteLimit[]) => SetMetadata(RATE_LIMITS, limits);

/** Runs after the auth guard, so `by: 'user'` sees who is calling. */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const limits = this.reflector.getAllAndMerge<RouteLimit[]>(RATE_LIMITS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (limits.length && context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      const ip = req.ip ?? 'unknown';
      const hits = limits.map((l) => {
        const userId = l.by === 'user' ? req.user?.userId : undefined;
        return {
          name: `route:${l.name}`,
          subject: userId ?? ip,
          max: l.max,
          windowSeconds: l.windowSeconds,
          perIp: !userId,
        };
      });
      try {
        await this.limiter.consume(...hits);
      } catch (error) {
        // fail open: a Redis hiccup must not take quoting or ordering down with it
        if (error instanceof HttpException) throw error;
        this.logger.warn(`Rate limit not checked: ${(error as Error).message}`);
      }
    }
    return next.handle();
  }
}
