import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../core/db/database.js';
import { ACTIVE_RIDE_STATUSES } from '../../core/db/schema.js';
import { CARGO_CLASSES, type CargoClass, carClassesFor } from '../../lib/cargo.js';
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
    const rows = await this.freeCars(pickup, riderId, false);
    const out = {} as Record<RideClass, ClassAvailability>;
    for (const rideClass of RIDE_CLASSES) {
      // a comfort car can take an economy ride, not the other way round
      out[rideClass] = await this.nearest(
        rows.filter((r) => rideClass === 'economy' || r.class === 'comfort'),
        pickup,
      );
    }
    return out;
  }

  /** The same for cargo cars per cargo class (a medium car takes small loads too). */
  async nearCargo(pickup: Point, riderId: string): Promise<Record<CargoClass, ClassAvailability>> {
    const rows = await this.freeCars(pickup, riderId, true);
    const out = {} as Record<CargoClass, ClassAvailability>;
    for (const rideClass of CARGO_CLASSES) {
      const fits = carClassesFor(rideClass) as (string | null)[];
      out[rideClass] = await this.nearest(
        rows.filter((r) => fits.includes(r.cargo_class)),
        pickup,
      );
    }
    return out;
  }

  private async nearest(
    cars: { lat: number | null; lng: number | null }[],
    pickup: Point,
  ): Promise<ClassAvailability> {
    if (!cars.length) return { etaS: null, cars: 0 };
    const routes = await this.routing.routes(
      cars.slice(0, NEAREST).map((c) => ({ lat: c.lat!, lng: c.lng! })),
      pickup,
    );
    return { etaS: Math.min(...routes.map(etaSeconds)), cars: cars.length };
  }

  /** Free taxi cars (cargo = false) or free cargo cars near the pickup, nearest first. */
  private async freeCars(pickup: Point, riderId: string, cargo: boolean) {
    const rules = await this.settings.dispatch();
    const straight = sql<number>`taxi_distance_m(d.lat, d.lng, ${pickup.lat}, ${pickup.lng})`;
    return (
      this.db.kysely
        .selectFrom('drivers as d')
        .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
        .select(['d.lat', 'd.lng', 'v.class', 'v.cargo_class', straight.as('straight')])
        // a cargo car never takes taxi rides, a taxi car never cargo
        .where('v.cargo_class', cargo ? 'is not' : 'is', null)
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
        .execute()
    );
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
      .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select(['d.lat', 'd.lng'])
      .where('v.cargo_class', 'is', null)
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
