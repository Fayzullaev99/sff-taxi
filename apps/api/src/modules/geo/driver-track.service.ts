import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../core/redis/redis.token.js';
import { assessFix, type Fix, type FixVerdict } from '../../lib/geo.js';
import { GeoService } from './geo.service.js';

export interface TrailPoint {
  lat: number;
  lng: number;
  at: string;
  heading: number | null;
  speed: number | null;
}

const TRAIL_LENGTH = 20;
const TRAIL_TTL_SECONDS = 3600;
/** After this many "too fast" rejections in a row the new position is believed. */
const REANCHOR_AFTER = 3;

const trailKey = (driverId: string) => `geo:trail:${driverId}`;
const jumpsKey = (driverId: string) => `geo:jumps:${driverId}`;

/** Driver GPS quality: filters bad fixes and keeps a short trail for smooth map markers. */
@Injectable()
export class DriverTrackService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly geo: GeoService,
  ) {}

  /** Whether to keep a new fix, given the last good one. */
  async check(driverId: string, fix: Fix, lastGood: Fix | null): Promise<FixVerdict> {
    const verdict = assessFix(fix, lastGood, await this.geo.areas());
    if (verdict.ok || verdict.reason !== 'too_fast') return verdict;
    // a phone that really moved (a taxi ride with the app closed, a bad earlier fix)
    // would otherwise be stuck forever: consistent repeated "jumps" win
    const jumps = await this.redis
      .multi()
      .incr(jumpsKey(driverId))
      .expire(jumpsKey(driverId), 600)
      .exec();
    const count = Number(jumps?.[0]?.[1] ?? 0);
    return count >= REANCHOR_AFTER ? { ok: true } : verdict;
  }

  async record(driverId: string, point: Omit<TrailPoint, 'at'> & { at: Date }): Promise<void> {
    const entry: TrailPoint = { ...point, at: point.at.toISOString() };
    await this.redis
      .multi()
      .del(jumpsKey(driverId))
      .lpush(trailKey(driverId), JSON.stringify(entry))
      .ltrim(trailKey(driverId), 0, TRAIL_LENGTH - 1)
      .expire(trailKey(driverId), TRAIL_TTL_SECONDS)
      .exec();
  }

  /** Recent good fixes, oldest first, optionally only those since a moment. */
  async trail(driverId: string, since?: Date | null): Promise<TrailPoint[]> {
    const raw = await this.redis.lrange(trailKey(driverId), 0, TRAIL_LENGTH - 1);
    return raw
      .map((r) => JSON.parse(r) as TrailPoint)
      .filter((p) => !since || new Date(p.at) >= since)
      .reverse();
  }
}
