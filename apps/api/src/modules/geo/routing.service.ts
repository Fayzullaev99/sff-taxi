import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { REDIS } from '../../core/redis/redis.token.js';
import { estimateRoute, type Point, type Route } from '../../lib/geo.js';

/** A road router: distances and driving times from several origins to one destination. */
export interface RoutingProvider {
  readonly name: 'osrm';
  /** One entry per origin, in order; null where no road connects them. Throws on failure. */
  toOne(
    origins: Point[],
    destination: Point,
    signal: AbortSignal,
  ): Promise<({ distanceM: number; durationS: number } | null)[]>;
}

/** OSRM `table` service (https://project-osrm.org/docs/v5.24.0/api/#table-service). */
export class OsrmRouter implements RoutingProvider {
  readonly name = 'osrm' as const;
  constructor(private readonly baseUrl: string) {}

  async toOne(origins: Point[], destination: Point, signal: AbortSignal) {
    const coords = [destination, ...origins].map((p) => `${p.lng},${p.lat}`).join(';');
    const sources = origins.map((_, i) => i + 1).join(';');
    const url = `${this.baseUrl.replace(/\/$/, '')}/table/v1/driving/${coords}?sources=${sources}&destinations=0&annotations=distance,duration`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as {
      code: string;
      distances?: (number | null)[][];
      durations?: (number | null)[][];
    };
    if (body.code !== 'Ok' || !body.distances) throw new Error(`OSRM ${body.code}`);
    return origins.map((_, i) => {
      const d = body.distances![i]?.[0];
      const t = body.durations?.[i]?.[0];
      return d === null || d === undefined ? null : { distanceM: Math.round(d), durationS: t ?? 0 };
    });
  }
}

/** OSRM's default --max-table-size is 100 coordinates. */
const CHUNK = 99;
const CACHE_TTL_SECONDS = 7 * 24 * 3600;
/** ~11 m: the router answers for the rounded points, so the cache key is exact. */
const round = (p: Point): Point => ({ lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4) });
const key = (from: Point, to: Point) =>
  `geo:route:${from.lat.toFixed(4)},${from.lng.toFixed(4)}:${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;

/**
 * Road distance for fares and driver ETAs. Uses the router when configured
 * and falls back to the straight line × detour factor whenever it is not, fails or
 * is slow, so a quote never waits on it.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly provider: RoutingProvider | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.provider = env.ROUTER === 'osrm' && env.OSRM_URL ? new OsrmRouter(env.OSRM_URL) : null;
  }

  estimate(from: Point, to: Point): Route {
    return estimateRoute(from, to, this.env.ROUTER_DETOUR_FACTOR);
  }

  async route(from: Point, to: Point, opts: { estimateOnly?: boolean } = {}): Promise<Route> {
    if (opts.estimateOnly) return this.estimate(from, to);
    return (await this.routes([from], to))[0]!;
  }

  /** Routes from each origin (drivers) to one destination (the pickup). */
  async routes(origins: Point[], destination: Point): Promise<Route[]> {
    const result: Route[] = origins.map((o) => this.estimate(o, destination));
    if (!this.provider || !origins.length) return result;

    const dest = round(destination);
    const keys = origins.map((o) => key(round(o), dest));
    const cached = await this.redis.mget(keys).catch(() => keys.map(() => null));
    const missing: number[] = [];
    cached.forEach((v, i) => {
      if (v) result[i] = { ...(JSON.parse(v) as Omit<Route, 'source'>), source: 'osrm' };
      else missing.push(i);
    });
    if (!missing.length) return result;

    const signal = AbortSignal.timeout(this.env.ROUTER_TIMEOUT_MS);
    try {
      const chunks: number[][] = [];
      for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));
      const answers = await Promise.all(
        chunks.map((c) =>
          this.provider!.toOne(
            c.map((i) => round(origins[i]!)),
            dest,
            signal,
          ),
        ),
      );
      const pipeline = this.redis.pipeline();
      chunks.forEach((c, n) =>
        c.forEach((i, j) => {
          const a = answers[n]![j];
          // unroutable (e.g. across a river without a bridge nearby): keep the estimate
          if (!a) return;
          result[i] = { ...a, source: 'osrm' };
          pipeline.set(keys[i]!, JSON.stringify(a), 'EX', CACHE_TTL_SECONDS);
        }),
      );
      await pipeline.exec().catch(() => undefined);
    } catch (err) {
      // estimates are already in place
      this.logger.warn(`Router unavailable, using the detour estimate: ${(err as Error).message}`);
    }
    return result;
  }
}
