import {
  Controller,
  Get,
  Global,
  Header,
  Headers,
  Inject,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Histogram, Registry } from 'prom-client';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../auth/auth-context.js';
import { createRegistry, httpDurationHistogram } from './metrics.js';

export const METRICS_REGISTRY = Symbol('METRICS_REGISTRY');
export const HTTP_DURATION = Symbol('HTTP_DURATION');

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Prometheus scrape endpoint. Keep it off the public internet (the Caddyfile blocks it). */
  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Headers('authorization') authorization?: string): Promise<string> {
    const token = this.env.METRICS_TOKEN;
    if (token && !safeEqual(authorization ?? '', `Bearer ${token}`)) {
      throw new UnauthorizedException();
    }
    return this.registry.metrics();
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    { provide: METRICS_REGISTRY, useFactory: () => createRegistry('api') },
    { provide: HTTP_DURATION, inject: [METRICS_REGISTRY], useFactory: httpDurationHistogram },
  ],
  exports: [METRICS_REGISTRY, HTTP_DURATION],
})
export class MetricsModule {}

/** Express middleware recording each request's duration once the response is sent. */
export function httpMetrics(histogram: Histogram<'method' | 'route' | 'status'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      histogram.observe({ method: req.method, route, status: String(res.statusCode) }, seconds);
    });
    next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
