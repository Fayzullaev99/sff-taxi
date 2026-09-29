import { ConflictException, Injectable } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { Database, type Tx } from '../../core/db/database.js';
import { ACTIVE_RIDE_STATUSES, type Gender, type RidesTable } from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import type { Point } from '../../lib/geo.js';
import {
  bestInsertion,
  carCapacity,
  deriveStops,
  type Insertion,
  type LegMatrix,
  type PlanStop,
  poolDiscount,
  poolPoints,
  type PoolRules,
  poolSplit,
  seatLayout,
  sharedMetres,
} from '../../lib/pool.js';
import { type RideClass, Tariff } from '../../lib/tariff.js';
import { RoutingService } from '../geo/routing.service.js';
import { SettingsService } from '../settings/settings.module.js';

type Db = Tx | Database['kysely'];
type Ride = Selectable<RidesTable>;

/** An active ride in a car, as the pool logic needs it. */
interface CarRide {
  id: string;
  status: string;
  kind: string;
  class: string;
  passengers: number;
  shareable: boolean;
  womenOnly: boolean;
  riderGender: Gender | null;
  fare: number;
  tripM: number;
  sharedM: number;
  discountable: boolean;
  pickup: Point;
  dropoff: Point;
}

/** A driver's car: where it is, its seats, the driver's settings and what it carries. */
export interface Car {
  driverId: string;
  position: Point | null;
  seats: number;
  extra: number;
  poolEnabled: boolean;
  destination: Point | null;
  gender: Gender | null;
  genderVerified: boolean;
  womenRidersOnly: boolean;
  rides: CarRide[];
  poolId: string | null;
  /** Stops of the rides ahead, in order (without the driver's destination). */
  stops: PlanStop[];
}

/** A car that can take a ride on its way, and how. */
export interface PoolFit {
  driverId: string;
  insertion: Insertion;
  /** Shared metres after the join, per ride (the new one included). */
  shared: Map<string, number>;
  /** People in the car when the new rider gets in. */
  occupied: number;
}

const toCarRide = (r: Ride): CarRide => ({
  id: r.id,
  status: r.status,
  kind: r.kind,
  class: r.class,
  passengers: r.passengers,
  shareable: r.shareable,
  womenOnly: r.women_only,
  riderGender: r.rider_gender,
  fare: r.fare_quoted,
  tripM: r.distance_m,
  sharedM: r.pool_shared_m,
  discountable: r.fare_mode === 'car',
  pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
  dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng },
});

/**
 * Shared rides ("Hamroh bilan", docs/shared-rides.md): which cars can take a rider on their
 * way, joining a rider to a car (the plan of stops, the shared distances and every rider's
 * discount), and keeping the plan right as riders get in, get out or leave. The pure rules
 * are in src/lib/pool.ts; the database backs the seating rule with a trigger.
 */
@Injectable()
export class PoolService {
  constructor(
    private readonly db: Database,
    private readonly routing: RoutingService,
    private readonly settings: SettingsService,
  ) {}

  private carDrivers(db: Db, driverIds: string[]) {
    return db
      .selectFrom('drivers as d')
      .leftJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select([
        'd.user_id',
        'd.lat',
        'd.lng',
        'd.extra_passengers',
        'd.pool_enabled',
        'd.destination_lat',
        'd.destination_lng',
        'd.gender',
        'd.gender_verified_at',
        'd.women_riders_only',
        'v.seats',
      ])
      .where('d.user_id', 'in', driverIds)
      .execute();
  }

  /** The driver's car now; with `lock`, the driver's active rides and pool are locked. */
  async car(db: Db, driverId: string, lock = false): Promise<Car | null> {
    const [d] = await this.carDrivers(db, [driverId]);
    if (!d) return null;
    let q = db
      .selectFrom('rides')
      .selectAll()
      .where('driver_id', '=', driverId)
      .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
      .orderBy('assigned_at');
    if (lock) q = q.forUpdate();
    const rides = await q.execute();
    const poolId = rides.find((r) => r.pool_id)?.pool_id ?? null;
    let plan: PlanStop[] = [];
    if (poolId) {
      let pq = db.selectFrom('ride_pools').select('plan').where('id', '=', poolId);
      if (lock) pq = pq.forUpdate();
      plan = ((await pq.executeTakeFirst())?.plan ?? []) as PlanStop[];
    }
    return this.assemble(d, rides, plan);
  }

  /**
   * Several drivers' cars at once (nothing locked): three queries instead of three per car,
   * for the cars dispatch and the quote's preview check on their way.
   */
  async cars(db: Db, driverIds: string[]): Promise<Map<string, Car>> {
    const cars = new Map<string, Car>();
    if (!driverIds.length) return cars;
    const drivers = await this.carDrivers(db, driverIds);
    if (!drivers.length) return cars;
    const rides = await db
      .selectFrom('rides')
      .selectAll()
      .where(
        'driver_id',
        'in',
        drivers.map((d) => d.user_id),
      )
      .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
      .orderBy('assigned_at')
      .execute();
    const byDriver = new Map<string, Ride[]>();
    for (const r of rides) {
      const list = byDriver.get(r.driver_id!) ?? [];
      list.push(r);
      byDriver.set(r.driver_id!, list);
    }
    // each car's pool is the first of its rides (by assignment) that has one
    const poolOf = new Map<string, string>();
    for (const [driverId, list] of byDriver) {
      const poolId = list.find((r) => r.pool_id)?.pool_id;
      if (poolId) poolOf.set(driverId, poolId);
    }
    const plans = new Map<string, PlanStop[]>();
    if (poolOf.size) {
      const rows = await db
        .selectFrom('ride_pools')
        .select(['id', 'plan'])
        .where('id', 'in', [...new Set(poolOf.values())])
        .execute();
      for (const p of rows) plans.set(p.id, (p.plan ?? []) as PlanStop[]);
    }
    for (const d of drivers) {
      const poolId = poolOf.get(d.user_id);
      cars.set(
        d.user_id,
        this.assemble(d, byDriver.get(d.user_id) ?? [], poolId ? (plans.get(poolId) ?? []) : []),
      );
    }
    return cars;
  }

  private assemble(
    d: Awaited<ReturnType<PoolService['carDrivers']>>[number],
    rides: Ride[],
    plan: PlanStop[],
  ): Car {
    const driverId = d.user_id;
    const poolId = rides.find((r) => r.pool_id)?.pool_id ?? null;
    const carRides = rides.map(toCarRide);
    return {
      driverId,
      position: d.lat !== null && d.lng !== null ? { lat: d.lat, lng: d.lng } : null,
      seats: d.seats ?? 4,
      extra: d.extra_passengers,
      poolEnabled: d.pool_enabled,
      destination:
        d.destination_lat !== null && d.destination_lng !== null
          ? { lat: d.destination_lat, lng: d.destination_lng }
          : null,
      gender: d.gender,
      genderVerified: d.gender_verified_at !== null,
      womenRidersOnly: d.women_riders_only,
      rides: carRides,
      poolId,
      stops: deriveStops(carRides, plan),
    };
  }

  /** The stops ahead with the driver's own destination last (people without the app get out there). */
  private withDestination(car: Car): PlanStop[] {
    return car.destination
      ? [
          ...car.stops,
          { rideId: null, type: 'destination', ...car.destination, passengers: car.extra },
        ]
      : car.stops;
  }

  /** Why a car cannot take the ride at all (before any routing), or null. */
  incompatible(car: Car, ride: Ride, rules: PoolRules): string | null {
    if (car.driverId === ride.rider_id) return 'self';
    if (!car.position) return 'no_position';
    const carries = car.rides.length > 0 || car.extra > 0;
    if (carries) {
      if (!rules.enabled) return 'pool_off';
      if (!ride.shareable || !car.poolEnabled) return 'not_shareable';
      if (car.rides.some((r) => !r.shareable)) return 'car_not_shareable';
      if (car.rides.length + 1 > rules.max_riders) return 'max_riders';
    }
    // a woman driver only: the driver's gender verified, and nobody else but women in the car
    if (ride.women_only) {
      if (car.gender !== 'female' || !car.genderVerified) return 'women_only';
      if (car.extra > 0 || car.rides.some((r) => r.riderGender !== 'female')) return 'women_only';
    }
    if (car.rides.some((r) => r.womenOnly) && ride.rider_gender !== 'female') return 'women_only';
    if (car.womenRidersOnly && ride.rider_gender !== 'female') return 'women_riders_only';
    return null;
  }

  /**
   * Whether the ride fits this car on its way: the best insertion within the detour limits
   * and the seating rule; for a car already carrying app riders, the driver must also earn
   * more than the detour costs once every rider's discount is applied.
   */
  async fit(car: Car, ride: Ride, rules: PoolRules, matrix?: LegMatrix): Promise<PoolFit | null> {
    if (this.incompatible(car, ride, rules) || !car.position) return null;
    const stops = this.withDestination(car);
    const request = {
      rideId: ride.id,
      pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng },
      dropoff: { lat: ride.dropoff_lat, lng: ride.dropoff_lng },
      passengers: ride.passengers,
    };
    const points = poolPoints(car.position, stops, request);
    const m = matrix ?? (await this.routing.matrix(points));
    const intercity = ride.kind === 'intercity' || car.rides.some((r) => r.kind === 'intercity');
    const insertion = bestInsertion({
      driver: car.position,
      stops,
      extraOnboard: car.extra,
      capacity: carCapacity(car.seats),
      request,
      maxDetourS: intercity ? rules.max_detour_seconds_intercity : rules.max_detour_seconds_city,
      maxDetourPercent: rules.max_detour_percent,
      maxPickupEtaS: rules.max_pickup_eta_seconds,
      matrix: m,
    });
    if (!insertion) return null;

    // shared metres before and after, over the same legs
    const before = sharedMetres(stops, (a, b) => m[a]![b]!.distanceM);
    const order = [0, ...insertion.order];
    const after = sharedMetres(insertion.stops, (a, b) => m[order[a]!]![order[b]!]!.distanceM);
    const shared = new Map<string, number>();
    for (const r of car.rides) {
      shared.set(r.id, Math.max(0, r.sharedM + (after.get(r.id) ?? 0) - (before.get(r.id) ?? 0)));
    }
    shared.set(ride.id, after.get(ride.id) ?? 0);

    if (car.rides.length) {
      const old = poolSplit(
        car.rides.map((r) => ({ ...r, rideId: r.id })),
        rules,
      ).driverTotal;
      const next = poolSplit(
        [
          ...car.rides.map((r) => ({ ...r, rideId: r.id, sharedM: shared.get(r.id)! })),
          {
            rideId: ride.id,
            fare: ride.fare_quoted,
            tripM: ride.distance_m,
            sharedM: shared.get(ride.id)!,
            discountable: ride.fare_mode === 'car',
          },
        ],
        rules,
      ).driverTotal;
      // shared rides are taxi rides (cargo and deliveries are never shared)
      const perKm = Tariff.parse(ride.tariff).classes[ride.class as RideClass].beyond_per_km;
      if (next - old < Math.ceil(insertion.addedM / 1000) * perKm) return null;
    }
    const occupied =
      car.extra +
      car.rides.filter((r) => r.status === 'in_progress').reduce((s, r) => s + r.passengers, 0);
    return { driverId: car.driverId, insertion, shared, occupied };
  }

  /**
   * Gives a ride to a car already carrying riders (the caller holds the ride's lock and has
   * checked it is searching). The fit is computed again under the locks: the car moved and
   * others may have joined since the offer. The ride's own assignment is left to the caller
   * (`assign`), which sets the pool id.
   */
  async join(
    trx: Tx,
    ride: Ride,
    driverId: string,
    assign: (poolId: string) => Promise<void>,
  ): Promise<void> {
    const rules = await this.settings.pool(trx);
    const car = await this.car(trx, driverId, true);
    if (!car) throw new ConflictException('Haydovchi topilmadi');
    const fit = await this.fit(car, ride, rules);
    if (!fit) {
      throw new ConflictException('Bu buyurtma endi yo‘lingizda emas yoki mashinada joy yo‘q');
    }
    let poolId = car.poolId;
    const now = new Date();
    if (!poolId) {
      poolId = uuidv7();
      await trx
        .insertInto('ride_pools')
        .values({ id: poolId, driver_id: driverId, plan: '[]', updated_at: now })
        .execute();
      await trx
        .updateTable('rides')
        .set({ pool_id: poolId, updated_at: now })
        .where(
          'id',
          'in',
          car.rides.map((r) => r.id),
        )
        .execute();
    }
    await assign(poolId);
    await this.savePlan(trx, poolId, fit.insertion.stops);
    await this.applyShares(trx, fit.shared, rules, {
      type: 'pool_joined',
      rideId: ride.id,
      detourS: fit.insertion.addedS,
    });
  }

  /** The driver picked the rider up: their pickup stop is done. */
  async pickedUp(trx: Tx, ride: Ride): Promise<void> {
    if (!ride.pool_id) return;
    await this.dropStop(trx, ride.pool_id, (s) => s.rideId === ride.id && s.type === 'pickup');
  }

  /** The rider got out at the destination: their stop is done; an empty pool closes. */
  async droppedOff(trx: Tx, ride: Ride): Promise<void> {
    if (!ride.pool_id) return;
    await this.dropStop(trx, ride.pool_id, (s) => s.rideId === ride.id);
    await this.closeIfEmpty(trx, ride.pool_id, ride.id);
  }

  /**
   * A rider left the car's plan before being carried to the end (cancelled, no-show, or the
   * driver gave the ride back): the others' shared distances and discounts follow the plan
   * without them. `keepPoolId`: a cancelled ride keeps its pool id for the record.
   */
  async left(trx: Tx, ride: Ride, opts: { keepPoolId: boolean }): Promise<void> {
    if (!ride.pool_id || !ride.driver_id) return;
    const poolId = ride.pool_id;
    const rules = await this.settings.pool(trx);
    const car = await this.car(trx, ride.driver_id, true);
    if (car?.position) {
      const stops = this.withDestination(car);
      const without = stops.filter((s) => s.rideId !== ride.id);
      const m = await this.routing.matrix([car.position, ...stops]);
      const index = new Map(stops.map((s, i) => [s, i + 1]));
      const before = sharedMetres(stops, (a, b) => m[a]![b]!.distanceM);
      const idx = [0, ...without.map((s) => index.get(s)!)];
      const after = sharedMetres(without, (a, b) => m[idx[a]!]![idx[b]!]!.distanceM);
      const shared = new Map<string, number>();
      for (const r of car.rides) {
        if (r.id === ride.id) continue;
        shared.set(r.id, Math.max(0, r.sharedM + (after.get(r.id) ?? 0) - (before.get(r.id) ?? 0)));
      }
      await this.savePlan(trx, poolId, without);
      await this.applyShares(trx, shared, rules, { type: 'pool_left', rideId: ride.id });
    } else {
      await this.dropStop(trx, poolId, (s) => s.rideId === ride.id);
    }
    // a rider who did not ride with anyone pays no shared price
    await trx
      .updateTable('rides')
      .set({
        pool_shared_m: 0,
        pool_discount: 0,
        ...(opts.keepPoolId ? {} : { pool_id: null }),
        updated_at: new Date(),
      })
      .where('id', '=', ride.id)
      .execute();
    await this.closeIfEmpty(trx, poolId, ride.id);
  }

  /**
   * Cars already carrying riders that could take this trip on their way, before ordering:
   * "a car with 1 person, 2 free seats, ~3 min" (a rider joining a shared car sees how many
   * people are in it). The nearest few are checked with the same rules as dispatch.
   */
  async preview(trip: {
    riderId: string;
    riderGender: Gender | null;
    pickup: Point;
    dropoff: Point;
    kind: 'city' | 'intercity';
    fare: number;
    distanceM: number;
    tariff: Tariff;
  }) {
    const [rules, dispatch] = await Promise.all([this.settings.pool(), this.settings.dispatch()]);
    if (!rules.enabled) return [];
    const straight = sql<number>`taxi_distance_m(d.lat, d.lng, ${trip.pickup.lat}, ${trip.pickup.lng})`;
    const rows = await this.db.kysely
      .selectFrom('drivers as d')
      .select('d.user_id')
      .where('d.is_online', '=', true)
      .where('d.status', '=', 'active')
      .where('d.pool_enabled', '=', true)
      .where('d.lat', 'is not', null)
      .where('d.located_at', '>=', new Date(Date.now() - dispatch.location_max_age_seconds * 1000))
      .where('d.user_id', '!=', trip.riderId)
      .where(straight, '<=', rules.search_radius_m)
      .where((eb) =>
        eb.or([
          eb('d.extra_passengers', '>', 0),
          eb.exists(
            eb
              .selectFrom('rides as r')
              .select('r.id')
              .whereRef('r.driver_id', '=', 'd.user_id')
              .where('r.status', 'in', [...ACTIVE_RIDE_STATUSES]),
          ),
        ]),
      )
      .orderBy(straight)
      .limit(3)
      .execute();
    const probe = {
      id: '00000000-0000-7000-8000-000000000000',
      rider_id: trip.riderId,
      rider_gender: trip.riderGender,
      shareable: true,
      women_only: false,
      passengers: 1,
      pickup_lat: trip.pickup.lat,
      pickup_lng: trip.pickup.lng,
      dropoff_lat: trip.dropoff.lat,
      dropoff_lng: trip.dropoff.lng,
      kind: trip.kind,
      class: 'economy',
      fare_quoted: trip.fare,
      distance_m: trip.distanceM,
      fare_mode: 'car',
      tariff: trip.tariff,
    } as unknown as Ride;
    const cars = await this.cars(
      this.db.kysely,
      rows.map((r) => r.user_id),
    );
    const found = await Promise.all(
      rows.map(async ({ user_id }) => {
        const car = cars.get(user_id) ?? null;
        const fit = car ? await this.fit(car, probe, rules).catch(() => null) : null;
        if (!car || !fit) return null;
        const booked = car.extra + car.rides.reduce((s, r) => s + r.passengers, 0);
        return {
          etaS: fit.insertion.pickupEtaS,
          detourS: fit.insertion.addedS,
          /** People in the car now (picked-up riders and people without the app). */
          inCar: fit.occupied,
          ...seatLayout(booked, car.seats),
        };
      }),
    );
    return found
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.etaS - b.etaS);
  }

  /** What riders of a car see about it: people in it and free seats. */
  async occupancy(driverId: string, db: Db = this.db.kysely) {
    const car = await this.car(db, driverId);
    return car ? this.occupancyOf(car) : null;
  }

  occupancyOf(car: Car) {
    const riding = car.rides
      .filter((r) => r.status === 'in_progress')
      .reduce((s, r) => s + r.passengers, 0);
    const booked = car.rides.reduce((s, r) => s + r.passengers, 0);
    return {
      /** People in the car now (riders picked up and people without the app). */
      inCar: car.extra + riding,
      /** Seats taken once every rider of the car is picked up. */
      ...seatLayout(car.extra + booked, car.seats),
      riders: car.rides.length,
    };
  }

  private async savePlan(trx: Tx, poolId: string, stops: PlanStop[]): Promise<void> {
    await trx
      .updateTable('ride_pools')
      .set({
        plan: JSON.stringify(stops.filter((s) => s.type !== 'destination')),
        updated_at: new Date(),
      })
      .where('id', '=', poolId)
      .execute();
  }

  private async dropStop(trx: Tx, poolId: string, done: (s: PlanStop) => boolean) {
    const pool = await trx
      .selectFrom('ride_pools')
      .select('plan')
      .where('id', '=', poolId)
      .forUpdate()
      .executeTakeFirst();
    if (!pool) return;
    await this.savePlan(
      trx,
      poolId,
      (pool.plan as PlanStop[]).filter((s) => !done(s)),
    );
  }

  /** Closes the pool when no ride but `leaving` (changing status in this transaction) is active. */
  private async closeIfEmpty(trx: Tx, poolId: string, leaving: string): Promise<void> {
    const active = await trx
      .selectFrom('rides')
      .select('id')
      .where('pool_id', '=', poolId)
      .where('id', '!=', leaving)
      .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
      .executeTakeFirst();
    if (active) return;
    await trx
      .updateTable('ride_pools')
      .set({ status: 'closed', closed_at: new Date(), updated_at: new Date(), plan: '[]' })
      .where('id', '=', poolId)
      .where('status', '=', 'open')
      .execute();
  }

  /**
   * Stores every rider's shared metres and the discount they earn, and tells those whose
   * price changed (their screens refetch; a push says the new price).
   */
  private async applyShares(
    trx: Tx,
    shared: Map<string, number>,
    rules: PoolRules,
    cause: { type: 'pool_joined' | 'pool_left'; rideId: string; detourS?: number },
  ): Promise<void> {
    if (!shared.size) return;
    const rows = await trx
      .selectFrom('rides')
      .select(['id', 'fare_quoted', 'distance_m', 'fare_mode', 'pool_discount'])
      .where('id', 'in', [...shared.keys()])
      .execute();
    for (const r of rows) {
      const sharedM = Math.round(shared.get(r.id) ?? 0);
      const discount =
        r.fare_mode === 'car' ? poolDiscount(r.fare_quoted, r.distance_m, sharedM, rules) : 0;
      await trx
        .updateTable('rides')
        .set({ pool_shared_m: sharedM, pool_discount: discount, updated_at: new Date() })
        .where('id', '=', r.id)
        .execute();
      await trx
        .insertInto('ride_events')
        .values({
          id: uuidv7(),
          ride_id: r.id,
          type: cause.type,
          actor: 'system',
          actor_id: null,
          data: JSON.stringify({
            ...(r.id !== cause.rideId ? { otherRideId: cause.rideId } : {}),
            sharedM,
            discount,
            pays: r.fare_quoted - discount,
            ...(cause.detourS !== undefined ? { detourS: cause.detourS } : {}),
          }),
        })
        .execute();
      if (r.id !== cause.rideId) {
        await emit(trx, 'ride.changed', { rideId: r.id });
        if (discount !== r.pool_discount) {
          await emit(trx, 'ride.pool_changed', {
            rideId: r.id,
            cause: cause.type,
            discount,
            pays: r.fare_quoted - discount,
          });
        }
      }
    }
  }
}
