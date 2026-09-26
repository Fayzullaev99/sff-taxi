import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../core/redis/redis.token.js';
import { etaSeconds, type Point } from '../../lib/geo.js';
import { RoutingService } from './routing.service.js';

/** How often the road ETA of a car on its way is recomputed (GPS fixes come every 3-5 s). */
export const ETA_REFRESH_SECONDS = 15;

export interface PickupEta {
  /** Seconds by road from the car's last position to the pickup. */
  etaS: number;
  distanceM: number;
  /** osrm or estimate */
  source: string;
  at: string;
}

const key = (rideId: string) => `eta:ride:${rideId}`;

/**
 * The assigned car's road ETA to the pickup, for the rider's screen: recomputed with the
 * driver's position at most every ETA_REFRESH_SECONDS (one router call, cached in Redis and
 * shared by every API instance), otherwise the last value.
 */
@Injectable()
export class PickupEtaService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly routing: RoutingService,
  ) {}

  async eta(rideId: string, car: Point, pickup: Point, now = new Date()): Promise<PickupEta> {
    const cached = await this.cached(rideId);
    if (cached) return cached;
    const route = await this.routing.route(car, pickup);
    const eta: PickupEta = {
      etaS: etaSeconds(route),
      distanceM: route.distanceM,
      source: route.source,
      at: now.toISOString(),
    };
    await this.redis.set(key(rideId), JSON.stringify(eta), 'EX', ETA_REFRESH_SECONDS);
    return eta;
  }

  async cached(rideId: string): Promise<PickupEta | null> {
    const raw = await this.redis.get(key(rideId));
    return raw ? (JSON.parse(raw) as PickupEta) : null;
  }
}
