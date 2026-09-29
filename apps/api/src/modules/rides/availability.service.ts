import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../core/db/database.js';
import { ACTIVE_RIDE_STATUSES } from '../../core/db/schema.js';
import { etaSeconds, type Point } from '../../lib/geo.js';
import { RIDE_CLASSES, type RideClass } from '../../lib/tariff.js';
import { RoutingService } from '../geo/routing.service.js';
import { SettingsService } from '../settings/settings.module.js';

/** How many of the nearest free cars per class are compared by road. */
const NEAREST = 5;

export interface ClassAvailability {
  /** Road seconds of the nearest free car to the pickup, or null: none free nearby. */
  etaS: number | null;
  /** Free cars of the class within the search radius. */
  cars: number;
}

/**
 * "The nearest car is ~4 min away" before ordering: free online cars per class near the
 * pickup (the same eligibility as dispatch: active, fresh GPS, no ride, no pending offer),
 * the nearest few compared by road. An estimate for the quote screen, not a promise.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly db: Database,
    private readonly routing: RoutingService,
    private readonly settings: SettingsService,
  ) {}

  async near(pickup: Point, riderId: string): Promise<Record<RideClass, ClassAvailability>> {
    const rules = await this.settings.dispatch();
    const straight = sql<number>`taxi_distance_m(d.lat, d.lng, ${pickup.lat}, ${pickup.lng})`;
    const rows = await this.db.kysely
      .selectFrom('drivers as d')
      .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select(['d.lat', 'd.lng', 'v.class', straight.as('straight')])
      .where('d.is_online', '=', true)
      .where('d.status', '=', 'active')
      .where('d.lat', 'is not', null)
      .where('d.located_at', '>=', new Date(Date.now() - rules.location_max_age_seconds * 1000))
      .where('d.user_id', '!=', riderId)
      .where(straight, '<=', rules.search_radius_m)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('rides as r')
              .select('r.id')
              .whereRef('r.driver_id', '=', 'd.user_id')
              .where('r.status', 'in', [...ACTIVE_RIDE_STATUSES]),
          ),
        ),
      )
      .orderBy(straight)
      .limit(50)
      .execute();
    const out = {} as Record<RideClass, ClassAvailability>;
    for (const rideClass of RIDE_CLASSES) {
      // a comfort car can take an economy ride, not the other way round
      const cars = rows.filter((r) => rideClass === 'economy' || r.class === 'comfort');
      if (!cars.length) {
        out[rideClass] = { etaS: null, cars: 0 };
        continue;
      }
      const nearest = cars.slice(0, NEAREST);
      const routes = await this.routing.routes(
        nearest.map((c) => ({ lat: c.lat!, lng: c.lng! })),
        pickup,
      );
      out[rideClass] = { etaS: Math.min(...routes.map(etaSeconds)), cars: cars.length };
    }
    return out;
  }

  /**
   * Women drivers free near the pickup (for the "a woman driver" option): how many, and the
   * nearest one's road ETA. Only drivers whose gender an operator verified count.
   */
  async womenDrivers(pickup: Point, riderId: string) {
    const rules = await this.settings.dispatch();
    const straight = sql<number>`taxi_distance_m(d.lat, d.lng, ${pickup.lat}, ${pickup.lng})`;
    const rows = await this.db.kysely
      .selectFrom('drivers as d')
      .select(['d.lat', 'd.lng'])
      .where('d.is_online', '=', true)
      .where('d.status', '=', 'active')
      .where('d.gender', '=', 'female')
      .where('d.gender_verified_at', 'is not', null)
      .where('d.extra_passengers', '=', 0)
      .where('d.lat', 'is not', null)
      .where('d.located_at', '>=', new Date(Date.now() - rules.location_max_age_seconds * 1000))
      .where('d.user_id', '!=', riderId)
      .where(straight, '<=', rules.search_radius_m)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('rides as r')
              .select('r.id')
              .whereRef('r.driver_id', '=', 'd.user_id')
              .where('r.status', 'in', [...ACTIVE_RIDE_STATUSES]),
          ),
        ),
      )
      .orderBy(straight)
      .limit(20)
      .execute();
    if (!rows.length) return { cars: 0, etaS: null };
    const [route] = await this.routing.routes([{ lat: rows[0]!.lat!, lng: rows[0]!.lng! }], pickup);
    return { cars: rows.length, etaS: etaSeconds(route!) };
  }
}
