import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import { ACTIVE_RIDE_STATUSES, type RidesTable } from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import { etaSeconds, type Point } from '../../lib/geo.js';
import type { PlanStop } from '../../lib/pool.js';
import { priority } from '../../lib/priority.js';
import { RoutingService } from '../geo/routing.service.js';
import { PoolService } from '../rides/pool.service.js';
import { RidesService } from '../rides/rides.service.js';
import { type DispatchRules, SettingsService } from '../settings/settings.module.js';

type Ride = Selectable<RidesTable>;

/** Ride options and the car feature each one needs (a CNG tank often fills the trunk). */
const OPTION_FEATURE: Record<string, string> = {
  child_seat: 'child_seat',
  pets: 'pets',
  luggage: 'big_trunk',
  ac: 'ac',
};

export interface Candidate {
  driverId: string;
  name: string;
  position: Point;
  straightM: number;
  etaS: number;
  distanceM: number;
  score: number;
  /** A car on its way (carrying riders, or its driver heading somewhere): the stops it would follow. */
  plan?: PlanStop[];
  /** How much longer the car's plan gets with this ride. */
  detourS?: number;
  /** People in the car now (a rider joining a shared car sees them). */
  inCar?: number;
}

type Exclude = 'any_offer' | 'declined';
/** free: cars with nothing to do; along: cars carrying riders or heading somewhere. */
type Mode = 'free' | 'along';

/**
 * Finds drivers for waiting rides (market analysis §6.4):
 * 1. direct offers, one driver at a time, to the best road ETA (OSRM, else the straight
 *    line × detour at city speed) among the nearest free drivers; the transparent priority
 *    score only breaks ties between ETAs within the tie window; each offer waits 15 s;
 * 2. after 3 direct offers (or when nobody came free for as long as they would have
 *    taken): a broadcast to every free driver within 3 km — the first to accept wins;
 * 3. when the broadcast times out, operators are alerted (they can assign by hand) while
 *    drivers who come free are still offered the ride, until the search timeout cancels it.
 *
 * Every step runs in a transaction holding the ride row; candidate drivers are locked with
 * SKIP LOCKED so two rides dispatched at once never pick the same driver, and a partial
 * unique index keeps a driver to one pending offer. Time comes in as `now`, so tests (and
 * the worker) control the clock.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly db: Database,
    private readonly rides: RidesService,
    private readonly routing: RoutingService,
    private readonly settings: SettingsService,
    private readonly pool: PoolService,
  ) {}

  /** One dispatcher cycle: expire answered-too-late offers, then move every waiting ride on. */
  async tick(now = new Date()): Promise<void> {
    await this.expireOffers(now);
    // rides ordered for later whose search is due join the queue below
    await this.rides.activateScheduled(now);
    const waiting = await this.db.kysely
      .selectFrom('rides')
      .select('id')
      .where('status', '=', 'searching')
      .orderBy('requested_at')
      .limit(200)
      .execute();
    for (const { id } of waiting) {
      try {
        await this.processRide(id, now);
      } catch (error) {
        this.logger.error(`Dispatch of ride ${id} failed: ${(error as Error).message}`);
      }
    }
  }

  async expireOffers(now: Date): Promise<number> {
    return this.db.transaction(async (trx) => {
      const expired = await trx
        .updateTable('ride_offers')
        .set({ status: 'expired', responded_at: now })
        .where('status', '=', 'pending')
        .where('expires_at', '<=', now)
        .returning(['id', 'ride_id', 'driver_id', 'kind'])
        .execute();
      for (const o of expired) {
        await this.rides.event(trx, o.ride_id, 'offer_expired', 'system', null, {
          offerId: o.id,
          driverId: o.driver_id,
          kind: o.kind,
        });
        await emit(trx, 'ride.offer_closed', {
          offerId: o.id,
          rideId: o.ride_id,
          driverId: o.driver_id,
          status: 'expired',
        });
      }
      return expired.length;
    });
  }

  /** Moves one waiting ride to its next dispatch step, if it is due. */
  async processRide(rideId: string, now = new Date()): Promise<void> {
    const rules = await this.settings.dispatch();
    await this.db.transaction(async (trx) => {
      // another worker (or an accepting driver) holds it: they move it on
      const ride = await trx
        .selectFrom('rides')
        .selectAll()
        .where('id', '=', rideId)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!ride || ride.status !== 'searching') return;

      if (now.getTime() - ride.requested_at.getTime() >= rules.search_timeout_seconds * 1000) {
        await this.rides.cancel(trx, ride, 'system', null, 'Haydovchi topilmadi', 0);
        return;
      }
      const pending = await trx
        .selectFrom('ride_offers')
        .select('id')
        .where('ride_id', '=', ride.id)
        .where('status', '=', 'pending')
        .where('expires_at', '>', now)
        .executeTakeFirst();
      if (pending) return;

      if (ride.dispatch_stage === 'direct') {
        if (ride.direct_offers < rules.direct_offers) {
          const [best] = await this.rank(trx, ride, rules, rules.search_radius_m, 'any_offer', 1);
          if (best) {
            const expiresAt = new Date(now.getTime() + rules.offer_timeout_seconds * 1000);
            await this.offer(trx, ride, best, 'direct', expiresAt);
            return;
          }
          // nobody free near yet: wait as long as the direct offers would have taken
          const directWindowMs = rules.direct_offers * rules.offer_timeout_seconds * 1000;
          if (now.getTime() - ride.requested_at.getTime() < directWindowMs) return;
        }
        // the drivers asked let it pass (or nobody came free): tell everyone around
        await trx
          .updateTable('rides')
          .set({ dispatch_stage: 'broadcast', updated_at: now })
          .where('id', '=', ride.id)
          .execute();
        ride.dispatch_stage = 'broadcast';
      }

      if (ride.dispatch_stage === 'broadcast') {
        if (!ride.broadcast_at) {
          const offered = await this.broadcast(trx, ride, rules, 'declined', now);
          await trx
            .updateTable('rides')
            .set({ broadcast_at: now, updated_at: now })
            .where('id', '=', ride.id)
            .execute();
          await this.rides.event(trx, ride.id, 'broadcast', 'system', null, { drivers: offered });
          return;
        }
        if (now.getTime() - ride.broadcast_at.getTime() < rules.broadcast_timeout_seconds * 1000) {
          // drivers who came free meanwhile see it too
          await this.broadcast(trx, ride, rules, 'any_offer', now);
          return;
        }
        // nobody took it: operators take over (and can assign by hand)
        await trx
          .updateTable('rides')
          .set({ dispatch_stage: 'operator', attention_at: now, updated_at: now })
          .where('id', '=', ride.id)
          .execute();
        await this.rides.event(trx, ride.id, 'attention', 'system', null, { reason: 'no_driver' });
        await emit(trx, 'ride.attention', { rideId: ride.id, reason: 'no_driver' });
      }

      // operators are on it; drivers who come free still see the ride
      await this.broadcast(trx, ride, rules, 'any_offer', now);
    });
  }

  private async broadcast(
    trx: Tx,
    ride: Ride,
    rules: DispatchRules,
    exclude: Exclude,
    now: Date,
  ): Promise<number> {
    const everyone = await this.rank(trx, ride, rules, rules.broadcast_radius_m, exclude, 50);
    const expiresAt = new Date(now.getTime() + rules.broadcast_timeout_seconds * 1000);
    for (const c of everyone) await this.offer(trx, ride, c, 'broadcast', expiresAt);
    return everyone.length;
  }

  private async offer(
    trx: Tx,
    ride: Ride,
    c: Candidate,
    kind: 'direct' | 'broadcast',
    expiresAt: Date,
  ): Promise<void> {
    const id = uuidv7();
    await trx
      .insertInto('ride_offers')
      .values({
        id,
        ride_id: ride.id,
        driver_id: c.driverId,
        kind,
        eta_s: c.etaS,
        distance_m: c.distanceM,
        score: c.score,
        expires_at: expiresAt,
        pool_plan: c.plan ? JSON.stringify(c.plan) : null,
        detour_s: c.detourS ?? null,
      })
      .execute();
    if (kind === 'direct') {
      // only offers made to this driver alone count in the acceptance rate: a broadcast
      // another driver took first, or one the driver let pass, says nothing about them
      await trx
        .updateTable('drivers')
        .set((eb) => ({ offers_received: eb('offers_received', '+', 1) }))
        .where('user_id', '=', c.driverId)
        .execute();
      await trx
        .updateTable('rides')
        .set((eb) => ({ direct_offers: eb('direct_offers', '+', 1), updated_at: new Date() }))
        .where('id', '=', ride.id)
        .execute();
    }
    await this.rides.event(trx, ride.id, 'offered', 'system', null, {
      offerId: id,
      driverId: c.driverId,
      kind,
      etaS: c.etaS,
      score: c.score,
      ...(c.plan ? { along: true, detourS: c.detourS } : {}),
    });
    await emit(trx, 'ride.offer_created', { offerId: id, rideId: ride.id, driverId: c.driverId });
  }

  /**
   * Free drivers who can take the ride, best first. Direct offers pick the best road ETA;
   * the priority score decides only between ETAs within the tie window.
   */
  async rank(
    trx: Tx | Database['kysely'],
    ride: Ride,
    rules: DispatchRules,
    radiusM: number,
    exclude: Exclude,
    limit: number,
    lock = true,
  ): Promise<Candidate[]> {
    const nearest = await this.eligible(
      trx,
      ride,
      rules,
      radiusM,
      exclude,
      Math.max(limit, rules.candidates),
      lock,
      'free',
    );
    const pickup = { lat: ride.pickup_lat, lng: ride.pickup_lng };
    const routes = nearest.length
      ? await this.routing.routes(
          nearest.map((d) => d.position),
          pickup,
        )
      : [];
    const ranked: (Candidate & { rankS: number })[] = nearest.map((d, i) => ({
      ...d,
      etaS: etaSeconds(routes[i]!),
      distanceM: routes[i]!.distanceM,
      rankS: etaSeconds(routes[i]!),
    }));

    // cars already going that way (shared rides, drivers heading home): each checked
    // with the detour limits and the seating rule; a car carrying riders is preferred
    // (it fills a seat instead of taking another car off the street)
    const poolRules = await this.settings.pool(trx);
    const along = await this.eligible(
      trx,
      ride,
      rules,
      poolRules.search_radius_m,
      exclude,
      6,
      lock,
      'along',
    );
    for (const d of along) {
      const car = await this.pool.car(trx, d.driverId);
      const fit = car ? await this.pool.fit(car, ride, poolRules) : null;
      if (!car || !fit) continue;
      const carries = car.rides.length > 0 || car.extra > 0;
      ranked.push({
        ...d,
        etaS: fit.insertion.pickupEtaS,
        distanceM: 0,
        plan: fit.insertion.stops,
        detourS: fit.insertion.addedS,
        inCar: fit.occupied,
        rankS: fit.insertion.pickupEtaS - (carries ? poolRules.pool_preference_seconds : 0),
      });
    }
    if (!ranked.length) return [];
    ranked.sort((a, b) => a.rankS - b.rankS);
    const best = ranked[0]!.rankS;
    const tied = ranked.filter((c) => c.rankS - best <= rules.tie_window_seconds);
    tied.sort((a, b) => b.score - a.score || a.rankS - b.rankS);
    const rest = ranked.filter((c) => !tied.includes(c));
    return [...tied, ...rest].slice(0, limit).map(({ rankS: _rankS, ...c }) => c);
  }

  private async eligible(
    db: Tx | Database['kysely'],
    ride: Ride,
    rules: DispatchRules,
    radiusM: number,
    exclude: Exclude,
    limit: number,
    lock: boolean,
    mode: Mode,
  ): Promise<Omit<Candidate, 'etaS' | 'distanceM'>[]> {
    const billing = await this.settings.billing(db);
    const poolOn = mode === 'along' && ride.shareable && (await this.settings.pool(db)).enabled;
    const features = [
      ...new Set(ride.options.map((o) => OPTION_FEATURE[o]).filter(Boolean)),
    ] as string[];
    const straight = sql<number>`taxi_distance_m(d.lat, d.lng, ${ride.pickup_lat}, ${ride.pickup_lng})`;
    const freshSince = new Date(Date.now() - rules.location_max_age_seconds * 1000);
    let q = db
      .selectFrom('drivers as d')
      .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select([
        'd.user_id',
        'd.full_name',
        'd.lat',
        'd.lng',
        'd.offers_received',
        'd.offers_accepted',
        'd.rides_cancelled',
        'd.rating_sum',
        'd.rating_count',
        straight.as('straight'),
      ])
      .where('d.is_online', '=', true)
      .where('d.status', '=', 'active')
      .where('d.lat', 'is not', null)
      .where('d.located_at', '>=', freshSince)
      .where('d.user_id', '!=', ride.rider_id)
      .where(straight, '<=', radiusM)
      .$if(ride.class === 'comfort', (q) => q.where('v.class', '=', 'comfort'))
      .$if(features.length > 0, (q) =>
        q.where(sql<boolean>`v.features @> ${sql.val(features)}::text[]`),
      )
      // a big trunk with the CNG tank in it has no room for luggage
      .$if(ride.options.includes('luggage'), (q) => q.where('v.cng_in_trunk', '=', false))
      // a woman driver only: an operator verified her gender
      .$if(ride.women_only, (q) =>
        q.where('d.gender', '=', 'female').where('d.gender_verified_at', 'is not', null),
      )
      // women drivers who take women riders only
      .$if(ride.rider_gender !== 'female', (q) => q.where('d.women_riders_only', '=', false))
      .where((eb) => {
        const busy = eb.exists(
          eb
            .selectFrom('rides as r')
            .select('r.id')
            .whereRef('r.driver_id', '=', 'd.user_id')
            .where('r.status', 'in', [...ACTIVE_RIDE_STATUSES]),
        );
        if (mode === 'free') {
          // heading somewhere: only rides on the way (the along list)
          return eb.and([eb.not(busy), eb('d.destination_lat', 'is', null)]);
        }
        return eb.or([
          eb.and([eb.not(busy), eb('d.destination_lat', 'is not', null)]),
          ...(poolOn ? [eb.and([busy, eb('d.pool_enabled', '=', true)])] : []),
        ]);
      })
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('ride_offers as o')
              .select('o.id')
              .whereRef('o.driver_id', '=', 'd.user_id')
              .where((eb) =>
                eb.or([
                  eb('o.status', '=', 'pending'),
                  eb.and([
                    eb('o.ride_id', '=', ride.id),
                    exclude === 'declined' ? eb('o.status', '=', 'declined') : eb.lit(true),
                  ]),
                ]),
              ),
          ),
        ),
      )
      // a driver who dropped this ride is not asked again
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('ride_events as e')
              .select('e.id')
              .where('e.ride_id', '=', ride.id)
              .where('e.type', '=', 'driver_released')
              .where(sql<boolean>`e.data->>'driverId' = d.user_id::text`),
          ),
        ),
      )
      .where(
        sql<number>`(select coalesce(sum(l.amount), 0) from driver_ledger l where l.driver_id = d.user_id)`,
        '>=',
        billing.min_balance,
      )
      .orderBy(straight)
      .limit(limit);
    if (lock) q = q.forUpdate('d').skipLocked();
    const rows = await q.execute();
    return rows.map((r) => ({
      driverId: r.user_id,
      name: r.full_name,
      position: { lat: r.lat!, lng: r.lng! },
      straightM: Math.round(r.straight),
      score: priority({
        offersReceived: r.offers_received,
        offersAccepted: r.offers_accepted,
        ridesCancelled: r.rides_cancelled,
        ratingSum: r.rating_sum,
        ratingCount: r.rating_count,
      }).score,
    }));
  }

  // Drivers answering ---------------------------------------------------------------------

  /** The driver's open offers (normally at most one), with what the ride is. */
  async offers(user: AuthUser, now = new Date()) {
    const rows = await this.db.kysely
      .selectFrom('ride_offers as o')
      .innerJoin('rides as r', 'r.id', 'o.ride_id')
      .innerJoin('users as u', 'u.id', 'r.rider_id')
      .select([
        'o.id',
        'o.kind',
        'o.expires_at as expiresAt',
        'o.eta_s as etaS',
        'o.distance_m as distanceM',
        'r.id as rideId',
        'r.number',
        'r.class',
        'r.kind as rideKind',
        'r.pickup',
        'r.pickup_lat',
        'r.pickup_lng',
        'r.dropoff',
        'r.dropoff_lat',
        'r.dropoff_lng',
        'r.distance_m as rideDistanceM',
        'r.fare_quoted as fare',
        'r.options',
        'r.comment',
        'r.payment_method as paymentMethod',
        'r.scheduled_for as scheduledFor',
        'r.owed_fee as owedFee',
        'r.passengers',
        'r.shareable',
        'r.women_only as womenOnly',
        'r.fare_mode as fareMode',
        'o.detour_s as detourS',
        'o.pool_plan as poolPlan',
        'u.rider_rating_sum',
        'u.rider_rating_count',
      ])
      .where('o.driver_id', '=', user.userId)
      .where('o.status', '=', 'pending')
      .where('o.expires_at', '>', now)
      .orderBy('o.created_at')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      expiresAt: r.expiresAt,
      etaS: r.etaS,
      distanceM: r.distanceM,
      // a ride on the car's way: how much longer the trip gets, and the stops in order
      along: r.poolPlan ? { detourS: r.detourS, stops: r.poolPlan } : null,
      ride: {
        id: r.rideId,
        number: r.number,
        class: r.class,
        kind: r.rideKind,
        pickup: { ...r.pickup, lat: r.pickup_lat, lng: r.pickup_lng },
        dropoff: { ...r.dropoff, lat: r.dropoff_lat, lng: r.dropoff_lng },
        distanceM: r.rideDistanceM,
        fare: r.fare,
        options: r.options,
        comment: r.comment,
        paymentMethod: r.paymentMethod,
        // a ride ordered for later: when the rider wants the car (null = now)
        scheduledFor: r.scheduledFor,
        // fees the rider owes from earlier rides, collected in cash with this fare
        owedFee: r.owedFee,
        passengers: r.passengers,
        shareable: r.shareable,
        womenOnly: r.womenOnly,
        fareMode: r.fareMode,
        riderRating: Math.round(((r.rider_rating_sum + 24) / (r.rider_rating_count + 5)) * 10) / 10,
      },
    }));
  }

  /**
   * Takes the ride. The offer, the ride and the driver are locked in one transaction:
   * of two drivers accepting a broadcast at once, exactly one wins.
   */
  async accept(user: AuthUser, offerId: string) {
    const found = await this.db.kysely
      .selectFrom('ride_offers')
      .select(['ride_id', 'driver_id'])
      .where('id', '=', offerId)
      .executeTakeFirst();
    if (!found || found.driver_id !== user.userId) throw new NotFoundException('Taklif topilmadi');
    const rideId = await this.db.transaction(async (trx) => {
      // always the ride first, then its offers (as assignment does): no lock-order deadlocks
      const ride = await this.rides.lockRide(trx, found.ride_id);
      const offer = await trx
        .selectFrom('ride_offers')
        .selectAll()
        .where('id', '=', offerId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      // an accept repeated after a lost answer: the ride is already this driver's
      if (offer.status === 'accepted' && ride.driver_id === user.userId) return ride.id;
      if (offer.status !== 'pending' || offer.expires_at <= new Date()) {
        throw new ConflictException('Taklif endi amal qilmaydi');
      }
      if (ride.status !== 'searching') {
        await trx
          .updateTable('ride_offers')
          .set({ status: 'withdrawn', responded_at: new Date() })
          .where('id', '=', offer.id)
          .execute();
        throw new ConflictException('Buyurtma boshqa haydovchiga berildi');
      }
      const driver = await trx
        .selectFrom('drivers')
        .select(['is_online'])
        .where('user_id', '=', user.userId)
        .executeTakeFirstOrThrow();
      if (!driver.is_online) throw new ConflictException('Avval liniyaga chiqing');
      await this.rides.giveToDriver(trx, ride, user.userId, {
        actor: 'driver',
        actorId: user.userId,
        offerId: offer.id,
      });
      await trx
        .updateTable('ride_offers')
        .set({ status: 'accepted', responded_at: new Date() })
        .where('id', '=', offer.id)
        .execute();
      // an accepted broadcast counts as received and accepted (it was not counted when made)
      await trx
        .updateTable('drivers')
        .set((eb) => ({
          offers_accepted: eb('offers_accepted', '+', 1),
          ...(offer.kind === 'broadcast' ? { offers_received: eb('offers_received', '+', 1) } : {}),
        }))
        .where('user_id', '=', user.userId)
        .execute();
      return ride.id;
    });
    return this.rides.driverView(user, rideId);
  }

  /** Lets the ride pass: the next driver is asked at once. */
  async decline(user: AuthUser, offerId: string, reason: string | null = null): Promise<void> {
    await this.db.transaction(async (trx) => {
      const offer = await trx
        .selectFrom('ride_offers')
        .selectAll()
        .where('id', '=', offerId)
        .forUpdate()
        .executeTakeFirst();
      if (!offer || offer.driver_id !== user.userId)
        throw new NotFoundException('Taklif topilmadi');
      if (offer.status !== 'pending') return;
      await trx
        .updateTable('ride_offers')
        .set({ status: 'declined', responded_at: new Date(), decline_reason: reason })
        .where('id', '=', offer.id)
        .execute();
      await this.rides.event(trx, offer.ride_id, 'offer_declined', 'driver', user.userId, {
        offerId: offer.id,
        kind: offer.kind,
        ...(reason ? { reason } : {}),
      });
      await emit(trx, 'ride.offer_closed', {
        offerId: offer.id,
        rideId: offer.ride_id,
        driverId: user.userId,
        status: 'declined',
      });
    });
  }

  // Operators ------------------------------------------------------------------------------

  /** Drivers an operator could give a waiting ride to, best first (nothing is locked). */
  async candidates(rideId: string) {
    const ride = await this.rides.findRide(rideId);
    const rules = await this.settings.dispatch();
    return this.rank(
      this.db.kysely,
      ride,
      rules,
      Math.max(rules.search_radius_m, 20_000),
      'declined',
      20,
      false,
    );
  }

  /** The dispatcher's map: every online driver (free, offered or busy) and every open ride. */
  async live() {
    const [drivers, rides] = await Promise.all([
      this.db.kysely
        .selectFrom('drivers as d')
        .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
        .leftJoin('rides as r', (j) =>
          j.onRef('r.driver_id', '=', 'd.user_id').on('r.status', 'in', [...ACTIVE_RIDE_STATUSES]),
        )
        .leftJoin('ride_offers as o', (j) =>
          j.onRef('o.driver_id', '=', 'd.user_id').on('o.status', '=', 'pending'),
        )
        .select([
          'd.user_id as id',
          'd.full_name as name',
          'd.lat',
          'd.lng',
          'd.heading',
          'd.located_at as locatedAt',
          'd.online_since as onlineSince',
          'v.plate',
          'v.class',
          'r.id as rideId',
          'r.status as rideStatus',
          'o.ride_id as offeredRideId',
        ])
        .where('d.is_online', '=', true)
        .orderBy('d.full_name')
        .execute(),
      this.rides.adminList({ status: 'open' }),
    ]);
    return {
      drivers: drivers.map((d) => ({
        ...d,
        state: d.rideId ? 'busy' : d.offeredRideId ? 'offered' : 'free',
      })),
      rides,
    };
  }
}
