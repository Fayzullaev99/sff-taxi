import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Selectable, sql, type Updateable } from 'kysely';
import { randomBytes, randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { BusinessCalendar } from '../../core/clock/business-calendar.js';
import { Database, type Tx } from '../../core/db/database.js';
import { containsPattern } from '../../core/db/like.js';
import {
  ACTIVE_RIDE_STATUSES,
  OPEN_RIDE_STATUSES,
  type Place,
  type RideActor,
  type RidePaymentStatus,
  type RidesTable,
  type RideStatus,
  UNFINISHED_RIDE_STATUSES,
} from '../../core/db/schema.js';
import { msg } from '../../core/http/messages.js';
import { emit } from '../../core/outbox/outbox.js';
import { distanceM } from '../../lib/distance.js';
import { formatPlate } from '../../lib/driver-rules.js';
import type { Point } from '../../lib/geo.js';
import { priority } from '../../lib/priority.js';
import {
  DECLINE_REASONS,
  DRIVER_CANCEL_REASONS,
  type DriverCancelReason,
  REASON_LABELS,
  reasonLabel,
  RELEASE_REASONS,
} from '../../lib/reasons.js';
import { MAX_PASSENGERS, REAR_SEATS_MAX } from '../../lib/pool.js';
import {
  computeFare,
  type Fare,
  fixedFare,
  freeWaitingOver,
  isNight,
  RIDE_CLASSES,
  type RideClass,
  type RideOption,
  Tariff,
  waitingFee,
} from '../../lib/tariff.js';
import { RideChargesService } from '../billing/charges.service.js';
import { LedgerService } from '../billing/ledger.service.js';
import { GeoService, publicCity } from '../geo/geo.service.js';
import { RoutingService } from '../geo/routing.service.js';
import { FiscalService } from '../fiscal/fiscal.service.js';
import { IntentsService } from '../payments/intents.service.js';
import { type PaymentMethod, PaymentsService } from '../payments/payments.service.js';
import { SettingsService } from '../settings/settings.module.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { DriverTrackService } from '../geo/driver-track.service.js';
import { PickupEtaService } from '../geo/pickup-eta.service.js';
import { RouteFaresService, type RouteQuote } from '../geo/route-fares.service.js';
import { AvailabilityService } from './availability.service.js';
import { PoolService } from './pool.service.js';

type Db = Tx | Database['kysely'];
type Ride = Selectable<RidesTable>;
/** A ride as lists read it (without the tariff snapshot). */
type ListedRide = Omit<Ride, 'tariff'>;

/** How long a quoted price may be ordered. */
export const QUOTE_TTL_SECONDS = 10 * 60;
/** Closer than this, pickup and drop-off are the same place. */
const MIN_TRIP_M = 150;

export interface PlaceInput extends Point {
  address: string | null;
  landmark: string | null;
}

export interface QuoteInput {
  pickup: Point;
  dropoff: Point;
  options: RideOption[];
  /** Ordering for later (30 min to 24 h ahead); null = now. */
  scheduledFor?: Date | null;
}

/** Scheduled rides: how far ahead, when dispatch starts, how many a rider may hold. */
export const SCHEDULE_MIN_AHEAD_MINUTES = 30;
export const SCHEDULE_MAX_AHEAD_HOURS = 24;
export const SCHEDULE_DISPATCH_BEFORE_MINUTES = 15;
export const SCHEDULED_PER_RIDER = 3;

export interface OrderInput {
  quoteId: string;
  class: RideClass;
  paymentMethod: PaymentMethod;
  pickup: { address: string | null; landmark: string | null };
  dropoff: { address: string | null; landmark: string | null };
  comment: string | null;
  clientRequestId: string;
  /** People riding: 1-3 (one in front, at most two in the back). */
  passengers?: number;
  /** "Hamroh bilan": other riders going the same way may share the car (cash only). */
  shareable?: boolean;
  /** A woman driver only (riders who declared themselves women). */
  womenOnly?: boolean;
  /** car: the whole car; seat: the fixed route's per-person price in a shared car. */
  fareMode?: 'car' | 'seat';
}

export interface PhoneOrderInput {
  riderPhone: string;
  riderName: string | null;
  /** Coordinates may be left out when a quote (the operator's) gives them. */
  pickup: Partial<Point> & { address: string | null; landmark: string | null };
  dropoff: Partial<Point> & { address: string | null; landmark: string | null };
  class: RideClass;
  options: RideOption[];
  comment: string | null;
  /** The operator's quote (POST admin/rides/quote): the fare read out to the caller. */
  quoteId: string | null;
  /** The panel's idempotency key: a double click creates one ride. */
  clientRequestId: string | null;
  passengers?: number;
}

const placeText = (p: { address: string | null; landmark: string | null }) => ({
  address: p.address,
  landmark: p.landmark,
});

export { DRIVER_CANCEL_REASONS, type DriverCancelReason };

const isActive = (s: RideStatus) => (ACTIVE_RIDE_STATUSES as readonly string[]).includes(s);
const isOpen = (s: RideStatus) => (OPEN_RIDE_STATUSES as readonly string[]).includes(s);
const isUnfinished = (s: RideStatus) => (UNFINISHED_RIDE_STATUSES as readonly string[]).includes(s);
/** The rider may cancel until the trip starts. */
const RIDER_CANCELLABLE: readonly RideStatus[] = [
  'scheduled',
  'awaiting_payment',
  'searching',
  'driver_assigned',
  'driver_arrived',
];

/**
 * Rides: fixed-price quotes, ordering (by the rider or by an operator for a caller), the
 * state machine with its event history, cancellations with their fees, completion with
 * the driver's charges. Assigning a driver (from an offer or by an operator) locks the ride
 * and the driver rows; partial unique indexes back that up.
 */
@Injectable()
export class RidesService {
  constructor(
    private readonly db: Database,
    private readonly geo: GeoService,
    private readonly routing: RoutingService,
    private readonly settings: SettingsService,
    private readonly charges: RideChargesService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly intents: IntentsService,
    private readonly fiscal: FiscalService,
    private readonly uploads: UploadsService,
    private readonly calendar: BusinessCalendar,
    private readonly availability: AvailabilityService,
    private readonly pickupEta: PickupEtaService,
    private readonly track: DriverTrackService,
    private readonly routes: RouteFaresService,
    private readonly pool: PoolService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // Quotes -----------------------------------------------------------------------------

  /**
   * Prices a trip in every class. The quote is stored so the order uses exactly this price.
   * A rider's quote also shows cancellation fees they still owe from earlier cash rides: a
   * separate line a cash ride collects on top of its fare (operators' quotes do not).
   */
  async quote(user: AuthUser, input: QuoteInput, now = new Date(), opts = { forRider: true }) {
    const scheduledFor = input.scheduledFor ?? null;
    if (scheduledFor) {
      const ahead = (scheduledFor.getTime() - now.getTime()) / 60_000;
      if (ahead < SCHEDULE_MIN_AHEAD_MINUTES || ahead > SCHEDULE_MAX_AHEAD_HOURS * 60) {
        throw new BadRequestException(
          msg(
            'Oldindan buyurtma {0} daqiqadan {1} soatgacha oldin beriladi',
            SCHEDULE_MIN_AHEAD_MINUTES,
            SCHEDULE_MAX_AHEAD_HOURS,
          ),
        );
      }
    }
    // a ride for later is priced for its own time (the night add-on), fixed now
    const priced = await this.price(
      input.pickup,
      input.dropoff,
      input.options,
      scheduledFor ?? now,
    );
    const id = uuidv7();
    const expiresAt = new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000);
    await this.db.kysely
      .insertInto('quotes')
      .values({
        id,
        user_id: user.userId,
        city_id: priced.city.id,
        pickup_lat: input.pickup.lat,
        pickup_lng: input.pickup.lng,
        dropoff_lat: input.dropoff.lat,
        dropoff_lng: input.dropoff.lng,
        options: [...new Set(input.options)],
        distance_m: priced.route.distanceM,
        duration_s: priced.route.durationS === null ? null : Math.round(priced.route.durationS),
        route_source: priced.route.source,
        kind: priced.kind,
        fares: JSON.stringify(priced.fares),
        tariff: JSON.stringify(priced.tariff),
        expires_at: expiresAt,
        scheduled_for: scheduledFor,
        route: priced.fixedRoute ? JSON.stringify(priced.fixedRoute) : null,
      })
      .execute();
    const [poolRules, rider] = await Promise.all([
      this.settings.pool(),
      opts.forRider
        ? this.db.kysely
            .selectFrom('users')
            .select('gender')
            .where('id', '=', user.userId)
            .executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    return {
      quoteId: id,
      expiresAt,
      scheduledFor,
      city: publicCity(priced.city),
      kind: priced.kind,
      distanceM: priced.route.distanceM,
      durationS: priced.route.durationS === null ? null : Math.round(priced.route.durationS),
      routeSource: priced.route.source,
      options: [...new Set(input.options)],
      fares: priced.fares,
      // rides for later are cash only (a card ride is prepaid before dispatch)
      paymentMethods: scheduledFor
        ? this.payments.methods().filter((m) => m === 'cash')
        : this.payments.methods(),
      // which card providers a card payment can go through (Payme, Click)
      cardProviders: scheduledFor ? [] : this.payments.providers(),
      owedFee: opts.forRider ? await this.owedFeeLine(user.userId) : null,
      waiting: priced.tariff.waiting,
      cancellationFee: priced.tariff.cancellation_fee,
      // the nearest free car per class, by road: "~4 min" on the class buttons
      availability: scheduledFor ? null : await this.availability.near(input.pickup, user.userId),
      // the seating rule: one in front, at most two in the back
      seats: { max: MAX_PASSENGERS, front: 1, rearMax: REAR_SEATS_MAX },
      // a fixed price between towns: per seat in a shared car, or the whole car
      route: priced.fixedRoute
        ? {
            from: priced.fixedRoute.from,
            to: priced.fixedRoute.to,
            prices: Object.fromEntries(
              Object.entries(priced.fixedRoute.prices).map(([c, p]) => [
                c,
                { seat: p.seat, car: p.car },
              ]),
            ),
          }
        : null,
      // "Hamroh bilan": the discount when the car is shared, and cars already going that way
      pool: poolRules.enabled
        ? {
            available: true,
            discountPercent: poolRules.discount_percent,
            fullDiscountSharePercent: poolRules.full_discount_share_percent,
            cashOnly: true,
            cars: scheduledFor
              ? []
              : await this.pool.preview({
                  riderId: user.userId,
                  riderGender: rider?.gender ?? null,
                  pickup: input.pickup,
                  dropoff: input.dropoff,
                  kind: priced.kind,
                  fare: priced.fares.economy.total,
                  distanceM: priced.route.distanceM,
                  tariff: priced.tariff,
                }),
          }
        : {
            available: false,
            discountPercent: 0,
            fullDiscountSharePercent: 0,
            cashOnly: true,
            cars: [],
          },
      // a woman driver only: offered to riders who declared themselves women
      womenOnly: opts.forRider
        ? {
            available: rider?.gender === 'female',
            reason: rider?.gender === 'female' ? null : 'profile_gender',
            drivers: scheduledFor
              ? null
              : await this.availability.womenDrivers(input.pickup, user.userId),
          }
        : null,
    };
  }

  /** Prices a trip; `now` is real time, read through the business calendar for the night add-on. */
  private async price(pickup: Point, dropoff: Point, options: RideOption[], now: Date) {
    const at = this.calendar.at(now);
    const [found, route] = await Promise.all([
      this.geo.serviceCity(pickup),
      this.routes.match(pickup, dropoff),
    ]);
    let service = found;
    // a fixed route may start in a town not yet served in the city (Yangiyer -> Guliston)
    const routeCityId = route ? (route.from.cityId ?? route.to.cityId) : null;
    if (!service && routeCityId) {
      const city = await this.geo.city(routeCityId);
      service = { city, tariff: city.tariff ?? (await this.settings.tariff()), outsideM: 0 };
    }
    if (!service) {
      const where = await this.geo.resolve(pickup);
      throw new UnprocessableEntityException({
        message: 'Bu hududda hozircha ishlamaymiz',
        resolved: where,
      });
    }
    if (distanceM(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) < MIN_TRIP_M) {
      throw new BadRequestException('Olib ketish va borish manzillari juda yaqin');
    }
    const roadRoute = await this.routing.route(pickup, dropoff);
    const fares = Object.fromEntries(
      RIDE_CLASSES.map((rideClass) => [
        rideClass,
        computeFare(
          {
            pickup,
            dropoff,
            roadM: roadRoute.distanceM,
            boundary: service.city.boundary,
            rideClass,
            options,
            at,
          },
          service.tariff,
        ),
      ]),
    ) as Record<RideClass, Fare>;
    // a fixed whole-car price replaces the distance price of its class
    for (const rideClass of RIDE_CLASSES) {
      const p = route?.prices[rideClass];
      if (p?.car) {
        fares[rideClass] = fixedFare(fares[rideClass], {
          routeFareId: p.id,
          mode: 'car',
          price: p.car,
          passengers: 1,
        });
      }
    }
    return {
      city: service.city,
      tariff: service.tariff,
      route: roadRoute,
      fares,
      kind: fares.economy.kind,
      fixedRoute: route,
    };
  }

  // Ordering ---------------------------------------------------------------------------

  /** Orders a quoted ride. The same clientRequestId returns the same ride (safe retries). */
  async order(user: AuthUser, input: OrderInput, now = new Date()) {
    const existing = await this.db.kysely
      .selectFrom('rides')
      .select('id')
      .where('rider_id', '=', user.userId)
      .where('client_request_id', '=', input.clientRequestId)
      .executeTakeFirst();
    if (existing) return { created: false, ride: await this.riderView(user, existing.id) };

    this.payments.assertAvailable(input.paymentMethod);
    const quote = await this.db.kysely
      .selectFrom('quotes')
      .selectAll()
      .where('id', '=', input.quoteId)
      .where('user_id', '=', user.userId)
      .executeTakeFirst();
    if (!quote) throw new NotFoundException('Narx topilmadi: qayta hisoblang');
    if (quote.expires_at <= now) throw new GoneException('Narx eskirdi: qayta hisoblang');
    if (quote.scheduled_for && input.paymentMethod !== 'cash') {
      throw new BadRequestException('Oldindan buyurtma hozircha faqat naqd to‘lov bilan');
    }
    const rider = await this.db.kysely
      .selectFrom('users')
      .select(['phone', 'full_name', 'gender'])
      .where('id', '=', user.userId)
      .executeTakeFirstOrThrow();
    const how = await this.rideTerms(quote, input, rider.gender);
    const id = await this.db.transaction(async (trx) => {
      // a double tap racing the check above lands on the unique key: answer with that ride
      await sql`select pg_advisory_xact_lock(hashtext(${user.userId}))`.execute(trx);
      const again = await trx
        .selectFrom('rides')
        .select('id')
        .where('rider_id', '=', user.userId)
        .where('client_request_id', '=', input.clientRequestId)
        .executeTakeFirst();
      if (again) return again.id;
      // a ride for later does not block riding now; a few may wait at once
      if (quote.scheduled_for) await this.assertScheduledRoom(trx, user.userId);
      else await this.assertNoOpenRide(trx, user.userId);
      return this.createRide(trx, {
        riderId: user.userId,
        riderPhone: rider.phone,
        riderName: rider.full_name,
        channel: 'app',
        createdBy: user.userId,
        actor: 'rider',
        clientRequestId: input.clientRequestId,
        quoteId: quote.id,
        cityId: quote.city_id,
        rideClass: input.class,
        pickup: { lat: quote.pickup_lat, lng: quote.pickup_lng, ...input.pickup },
        dropoff: { lat: quote.dropoff_lat, lng: quote.dropoff_lng, ...input.dropoff },
        options: quote.options as RideOption[],
        comment: input.comment,
        distanceM: quote.distance_m,
        durationS: quote.duration_s,
        fare: how.fare,
        tariff: quote.tariff,
        paymentMethod: input.paymentMethod,
        scheduledFor: quote.scheduled_for,
        passengers: how.passengers,
        shareable: how.shareable,
        womenOnly: how.womenOnly,
        riderGender: rider.gender,
        fareMode: how.fareMode,
        routeFareId: how.fare.fixed?.routeFareId ?? null,
        startPin: how.startPin,
      });
    });
    return { created: true, ride: await this.riderView(user, id) };
  }

  /**
   * How a quoted ride is ordered: people, sharing, a woman driver, the whole car or a seat
   * of a fixed route, and whether the rider tells the driver a start code. Validated against
   * the quote and the platform rules; the fare is the quote's (or the route's seat price).
   */
  private async rideTerms(
    quote: { fares: unknown; route: unknown; tariff: unknown; scheduled_for: Date | null },
    input: OrderInput,
    riderGender: 'female' | 'male' | null,
  ) {
    const passengers = input.passengers ?? 1;
    if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_PASSENGERS) {
      throw new BadRequestException(
        msg(
          'Bir mashinada {0} tadan ortiq yo‘lovchi bo‘lmaydi (oldinda 1, orqada 2)',
          MAX_PASSENGERS,
        ),
      );
    }
    const fareMode = input.fareMode ?? 'car';
    // a seat is a place in a shared car
    const shareable = fareMode === 'seat' || Boolean(input.shareable);
    let fare = (quote.fares as Record<RideClass, Fare>)[input.class];
    if (shareable) {
      const rules = await this.settings.pool();
      if (!rules.enabled) throw new BadRequestException('Hamroh bilan safar hozircha o‘chirilgan');
      if (input.paymentMethod !== 'cash') {
        throw new BadRequestException('Hamroh bilan safar hozircha faqat naqd to‘lov bilan');
      }
    }
    if (fareMode === 'seat') {
      const price = (quote.route as RouteQuote | null)?.prices[input.class];
      if (!price?.seat) {
        throw new BadRequestException('Bu yo‘nalishda o‘rindiq narxi belgilanmagan');
      }
      fare = fixedFare(fare, {
        routeFareId: price.id,
        mode: 'seat',
        price: price.seat,
        passengers,
      });
    }
    const womenOnly = Boolean(input.womenOnly);
    if (womenOnly && riderGender !== 'female') {
      throw new ForbiddenException(
        'Ayol haydovchi tanlovi ayollar uchun: profilingizda jinsingizni belgilang',
      );
    }
    const tariff = Tariff.parse(quote.tariff);
    const night = isNight(this.calendar.at(quote.scheduled_for ?? new Date()), tariff.night);
    // the right rider in the right car: at night, with strangers, a woman driver, between towns
    const startPin =
      night || shareable || womenOnly || fare.kind === 'intercity'
        ? String(randomInt(0, 10_000)).padStart(4, '0')
        : null;
    return { passengers, fareMode, shareable, womenOnly, fare, startPin };
  }

  /**
   * An operator orders for a caller without the app (market analysis O1): the caller's
   * account is found or created by phone; the price is computed on the spot and read out.
   */
  async phoneOrder(operator: AuthUser, input: PhoneOrderInput, now = new Date()) {
    // a double click in the panel: the same request id from the same operator is one ride
    const repeat = () =>
      input.clientRequestId
        ? this.db.kysely
            .selectFrom('rides')
            .select('id')
            .where('created_by', '=', operator.userId)
            .where('channel', '=', 'phone')
            .where('client_request_id', '=', input.clientRequestId)
            .executeTakeFirst()
        : Promise.resolve(undefined);
    const existing = await repeat();
    if (existing) return { created: false, ride: await this.adminView(existing.id) };

    // the price the operator read out to the caller (their quote), or priced on the spot
    let priced: {
      cityId: string;
      pickup: PlaceInput;
      dropoff: PlaceInput;
      options: RideOption[];
      distanceM: number;
      durationS: number | null;
      fare: Fare;
      tariff: unknown;
      quoteId: string | null;
      /** A quote for later (POST admin/rides/quote with scheduledFor): a scheduled ride. */
      scheduledFor: Date | null;
    };
    if (input.quoteId) {
      const quote = await this.db.kysely
        .selectFrom('quotes')
        .selectAll()
        .where('id', '=', input.quoteId)
        .where('user_id', '=', operator.userId)
        .executeTakeFirst();
      if (!quote) throw new NotFoundException('Narx topilmadi: qayta hisoblang');
      if (quote.expires_at <= now) throw new GoneException('Narx eskirdi: qayta hisoblang');
      priced = {
        cityId: quote.city_id,
        pickup: { lat: quote.pickup_lat, lng: quote.pickup_lng, ...placeText(input.pickup) },
        dropoff: { lat: quote.dropoff_lat, lng: quote.dropoff_lng, ...placeText(input.dropoff) },
        options: quote.options as RideOption[],
        distanceM: quote.distance_m,
        durationS: quote.duration_s,
        fare: (quote.fares as unknown as Record<RideClass, Fare>)[input.class],
        tariff: quote.tariff,
        quoteId: quote.id,
        scheduledFor: quote.scheduled_for,
      };
    } else {
      if (input.pickup.lat === undefined || input.dropoff.lat === undefined) {
        throw new BadRequestException('Manzillar koordinatasi yoki narx (quoteId) kerak');
      }
      const pickup = input.pickup as PlaceInput;
      const dropoff = input.dropoff as PlaceInput;
      const p = await this.price(pickup, dropoff, input.options, now);
      priced = {
        cityId: p.city.id,
        pickup,
        dropoff,
        options: input.options,
        distanceM: p.route.distanceM,
        durationS: p.route.durationS === null ? null : Math.round(p.route.durationS),
        fare: p.fares[input.class],
        tariff: p.tariff,
        quoteId: null,
        scheduledFor: null,
      };
    }
    const id = await this.db.transaction(async (trx) => {
      if (input.clientRequestId) {
        await sql`select pg_advisory_xact_lock(hashtext(${operator.userId + input.clientRequestId}))`.execute(
          trx,
        );
        const again = await trx
          .selectFrom('rides')
          .select('id')
          .where('created_by', '=', operator.userId)
          .where('channel', '=', 'phone')
          .where('client_request_id', '=', input.clientRequestId)
          .executeTakeFirst();
        if (again) return { id: again.id, created: false };
      }
      await trx
        .insertInto('users')
        .values({ id: uuidv7(), phone: input.riderPhone, full_name: input.riderName })
        .onConflict((oc) => oc.column('phone').doNothing())
        .execute();
      const rider = await trx
        .selectFrom('users')
        .select(['id', 'full_name', 'status'])
        .where('phone', '=', input.riderPhone)
        .executeTakeFirstOrThrow();
      if (rider.status !== 'active') throw new ForbiddenException('Bu mijoz bloklangan');
      await sql`select pg_advisory_xact_lock(hashtext(${rider.id}))`.execute(trx);
      // a ride for later does not block a ride now (nor the other way round)
      if (priced.scheduledFor) await this.assertScheduledRoom(trx, rider.id);
      else await this.assertNoOpenRide(trx, rider.id);
      return this.createRide(trx, {
        riderId: rider.id,
        riderPhone: input.riderPhone,
        riderName: input.riderName ?? rider.full_name,
        channel: 'phone',
        createdBy: operator.userId,
        actor: 'operator',
        clientRequestId: input.clientRequestId,
        quoteId: priced.quoteId,
        cityId: priced.cityId,
        rideClass: input.class,
        pickup: priced.pickup,
        dropoff: priced.dropoff,
        options: priced.options,
        comment: input.comment,
        distanceM: priced.distanceM,
        durationS: priced.durationS,
        fare: priced.fare,
        tariff: priced.tariff,
        paymentMethod: 'cash',
        scheduledFor: priced.scheduledFor,
        passengers: input.passengers ?? 1,
      }).then((rideId) => ({ id: rideId, created: true }));
    });
    return { created: id.created, ride: await this.adminView(id.id) };
  }

  private async assertNoOpenRide(trx: Tx, riderId: string): Promise<void> {
    const open = await trx
      .selectFrom('rides')
      .select(['id', 'number'])
      .where('rider_id', '=', riderId)
      .where('status', 'in', [...UNFINISHED_RIDE_STATUSES])
      .executeTakeFirst();
    if (open) {
      throw new ConflictException({
        ...msg('Tugallanmagan buyurtma bor: #{0}', open.number),
        rideId: open.id,
      });
    }
  }

  private async assertScheduledRoom(trx: Tx, riderId: string): Promise<void> {
    const waiting = await trx
      .selectFrom('rides')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('rider_id', '=', riderId)
      .where('status', '=', 'scheduled')
      .executeTakeFirstOrThrow();
    if (Number(waiting.n) >= SCHEDULED_PER_RIDER) {
      throw new ConflictException(
        msg('Oldindan {0} tadan ortiq buyurtma berib bo‘lmaydi', SCHEDULED_PER_RIDER),
      );
    }
  }

  // Owed cancellation fees ------------------------------------------------------------

  /**
   * Cancellation fees the rider owes from earlier cash rides and no ride is collecting yet,
   * oldest first: the quote's separate "owed" line (collected by the next cash ride).
   */
  async owedFeeLine(riderId: string, db: Db = this.db.kysely) {
    const rows = await db
      .selectFrom('rides')
      .select(['id', 'number', 'cancellation_fee', 'cancelled_at'])
      .where('rider_id', '=', riderId)
      .where('fee_status', '=', 'owed')
      .where('fee_collect_ride_id', 'is', null)
      .orderBy('cancelled_at')
      .execute();
    if (!rows.length) return null;
    return {
      amount: rows.reduce((sum, r) => sum + r.cancellation_fee, 0),
      /** Only a cash ride collects it; a card ride leaves it owed. */
      collectedWith: 'cash' as const,
      label: 'Oldingi bekor qilingan safar uchun to‘lov',
      rides: rows.map((r) => ({
        rideId: r.id,
        number: r.number,
        amount: r.cancellation_fee,
        cancelledAt: r.cancelled_at,
      })),
    };
  }

  /** A new cash ride takes over the rider's owed fees (they are paid with its fare). */
  private async attachOwedFees(trx: Tx, riderId: string, rideId: string): Promise<number> {
    const attached = await trx
      .updateTable('rides')
      .set({ fee_collect_ride_id: rideId })
      .where('rider_id', '=', riderId)
      .where('fee_status', '=', 'owed')
      .where('fee_collect_ride_id', 'is', null)
      .where('id', '!=', rideId)
      .returning(['id', 'cancellation_fee'])
      .execute();
    const total = attached.reduce((sum, r) => sum + r.cancellation_fee, 0);
    if (total > 0) {
      await trx.updateTable('rides').set({ owed_fee: total }).where('id', '=', rideId).execute();
      await this.event(trx, rideId, 'owed_fee_added', 'system', null, {
        amount: total,
        rides: attached.map((r) => r.id),
      });
    }
    return total;
  }

  /**
   * The ride completed: the owed fees it carried were paid in cash to its driver. They are
   * the other drivers' money: debited here, credited to each driver the fee is owed to.
   */
  private async collectOwedFees(trx: Tx, ride: Ride): Promise<number> {
    const owed = await trx
      .selectFrom('rides')
      .select(['id', 'number', 'driver_id', 'cancellation_fee'])
      .where('fee_collect_ride_id', '=', ride.id)
      .where('fee_status', '=', 'owed')
      .orderBy('id')
      .forUpdate()
      .execute();
    let total = 0;
    for (const o of owed) {
      if (o.driver_id) {
        await this.ledger.post(trx, {
          driverId: o.driver_id,
          kind: 'cancel_fee',
          amount: o.cancellation_fee,
          rideId: o.id,
          note: `#${o.number} bekor qilish to‘lovi (#${ride.number} safarida olindi)`,
        });
      }
      total += o.cancellation_fee;
    }
    if (owed.length) {
      await trx
        .updateTable('rides')
        .set({ fee_status: 'collected', updated_at: new Date() })
        .where(
          'id',
          'in',
          owed.map((o) => o.id),
        )
        .execute();
    }
    if (total > 0) {
      await this.ledger.post(trx, {
        driverId: ride.driver_id!,
        kind: 'cancel_fee_collected',
        amount: -total,
        rideId: ride.id,
        note: `Oldingi safarlar uchun olingan bekor qilish to‘lovi`,
      });
    }
    return total;
  }

  /**
   * An operator lets the rider off an owed fee. A ride already carrying it collects that
   * much less. The collecting ride is locked before the owed one, as completion does.
   */
  async waiveFee(operator: AuthUser, rideId: string, note: string) {
    await this.db.transaction(async (trx) => {
      const peek = await this.findRide(rideId, trx);
      const collecting = peek.fee_collect_ride_id
        ? await this.lockRide(trx, peek.fee_collect_ride_id)
        : null;
      const ride = await this.lockRide(trx, rideId);
      if (ride.fee_status !== 'owed') {
        throw new ConflictException('Bu safar uchun qarz yo‘q (to‘langan yoki kechirilgan)');
      }
      if (ride.fee_collect_ride_id !== (collecting?.id ?? null)) {
        throw new ConflictException('Qayta urinib ko‘ring');
      }
      if (collecting?.status === 'completed') {
        throw new ConflictException('To‘lov allaqachon olingan');
      }
      await trx
        .updateTable('rides')
        .set({
          fee_status: 'waived',
          fee_collect_ride_id: null,
          fee_waived_by: operator.userId,
          fee_waive_note: note,
          updated_at: new Date(),
        })
        .where('id', '=', ride.id)
        .execute();
      await this.event(trx, ride.id, 'fee_waived', 'operator', operator.userId, {
        amount: ride.cancellation_fee,
        note,
      });
      if (collecting) {
        await trx
          .updateTable('rides')
          .set({
            owed_fee: Math.max(0, collecting.owed_fee - ride.cancellation_fee),
            updated_at: new Date(),
          })
          .where('id', '=', collecting.id)
          .execute();
        // screens showing that ride refetch (no status change: nobody is notified)
        await emit(trx, 'ride.changed', { rideId: collecting.id });
      }
    });
    return this.adminView(rideId);
  }

  private async createRide(
    trx: Tx,
    r: {
      riderId: string;
      riderPhone: string;
      riderName: string | null;
      channel: 'app' | 'phone';
      createdBy: string;
      actor: RideActor;
      clientRequestId: string | null;
      quoteId: string | null;
      cityId: string;
      rideClass: RideClass;
      pickup: PlaceInput;
      dropoff: PlaceInput;
      options: RideOption[];
      comment: string | null;
      distanceM: number;
      durationS: number | null;
      fare: Fare;
      tariff: unknown;
      paymentMethod: PaymentMethod;
      scheduledFor?: Date | null;
      passengers?: number;
      shareable?: boolean;
      womenOnly?: boolean;
      riderGender?: 'female' | 'male' | null;
      fareMode?: 'car' | 'seat';
      routeFareId?: string | null;
      startPin?: string | null;
    },
  ): Promise<string> {
    const id = uuidv7();
    const place = (p: PlaceInput): Place => ({ address: p.address, landmark: p.landmark });
    // a card ride is dispatched once its fixed fare is prepaid (docs/payments.md)
    // a ride for later waits until 15 minutes before its time
    const status = r.scheduledFor
      ? 'scheduled'
      : r.paymentMethod === 'card'
        ? 'awaiting_payment'
        : 'searching';
    await trx
      .insertInto('rides')
      .values({
        id,
        rider_id: r.riderId,
        rider_phone: r.riderPhone,
        rider_name: r.riderName,
        channel: r.channel,
        created_by: r.createdBy,
        client_request_id: r.clientRequestId,
        quote_id: r.quoteId,
        city_id: r.cityId,
        kind: r.fare.kind,
        class: r.rideClass,
        pickup: JSON.stringify(place(r.pickup)),
        pickup_lat: r.pickup.lat,
        pickup_lng: r.pickup.lng,
        dropoff: JSON.stringify(place(r.dropoff)),
        dropoff_lat: r.dropoff.lat,
        dropoff_lng: r.dropoff.lng,
        options: [...new Set(r.options)],
        comment: r.comment,
        distance_m: r.distanceM,
        duration_s: r.durationS,
        fare: JSON.stringify(r.fare),
        tariff: JSON.stringify(r.tariff),
        fare_quoted: r.fare.total,
        payment_method: r.paymentMethod,
        scheduled_for: r.scheduledFor ?? null,
        passengers: r.passengers ?? 1,
        shareable: r.shareable ?? false,
        women_only: r.womenOnly ?? false,
        rider_gender: r.riderGender ?? null,
        fare_mode: r.fareMode ?? 'car',
        route_fare_id: r.routeFareId ?? null,
        start_pin: r.startPin ?? null,
        status,
        updated_at: new Date(),
      })
      .execute();
    await this.event(trx, id, 'requested', r.actor, r.createdBy, {
      channel: r.channel,
      fare: r.fare.total,
      class: r.rideClass,
      paymentMethod: r.paymentMethod,
      passengers: r.passengers ?? 1,
      ...(r.shareable ? { shareable: true } : {}),
      ...(r.womenOnly ? { womenOnly: true } : {}),
      ...(r.fareMode === 'seat' ? { fareMode: 'seat' } : {}),
    });
    // fees owed from cancelled cash rides are paid with this cash fare (a separate line)
    if (r.paymentMethod === 'cash') await this.attachOwedFees(trx, r.riderId, id);
    if (status === 'awaiting_payment') {
      await this.intents.createForRide(trx, { id, riderId: r.riderId, amount: r.fare.total });
    } else if (status === 'scheduled') {
      await emit(trx, 'ride.status_changed', { rideId: id, from: null, to: 'scheduled' });
    } else {
      await emit(trx, 'ride.requested', { rideId: id });
    }
    return id;
  }

  // Driver assignment ------------------------------------------------------------------

  /** Locks the ride row for a state change. */
  async lockRide(trx: Tx, rideId: string): Promise<Ride> {
    const ride = await trx
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .forUpdate()
      .executeTakeFirst();
    if (!ride) throw new NotFoundException('Buyurtma topilmadi');
    return ride;
  }

  /**
   * Gives a searching ride (or, for operators, an assigned one) to a driver. The caller holds
   * the ride row lock; the driver row is locked here, so two rides cannot take the same free
   * driver at once, and the partial unique index refuses whatever might slip through.
   */
  async assignDriver(
    trx: Tx,
    ride: Ride,
    driverId: string,
    by: {
      actor: RideActor;
      actorId: string | null;
      offerId?: string;
      manual?: boolean;
      /** Joining a car already carrying riders (PoolService.join). */
      poolId?: string;
    },
  ): Promise<void> {
    if (ride.status !== 'searching' && !(by.manual && ride.status === 'driver_assigned')) {
      throw new ConflictException('Buyurtma allaqachon boshqa haydovchiga berilgan');
    }
    if (ride.driver_id === driverId)
      throw new ConflictException('Bu haydovchi allaqachon tayinlangan');
    const driver = await trx
      .selectFrom('drivers as d')
      .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select(['d.user_id', 'd.status', 'v.make', 'v.model', 'v.colour', 'v.plate', 'v.class'])
      .where('d.user_id', '=', driverId)
      .forUpdate('d')
      .executeTakeFirst();
    if (!driver || driver.status !== 'active') throw new ConflictException('Haydovchi faol emas');
    if (driverId === ride.rider_id)
      throw new ConflictException('O‘zingizning buyurtmangizni ololmaysiz');
    const busy = by.poolId
      ? undefined
      : await trx
          .selectFrom('rides')
          .select('number')
          .where('driver_id', '=', driverId)
          .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
          .executeTakeFirst();
    if (busy) throw new ConflictException(msg('Haydovchida faol buyurtma bor: #{0}', busy.number));

    const previousDriverId = ride.driver_id;
    const now = new Date();
    await trx
      .updateTable('rides')
      .set({
        status: 'driver_assigned',
        driver_id: driverId,
        vehicle: JSON.stringify({
          make: driver.make,
          model: driver.model,
          colour: driver.colour,
          plate: driver.plate,
          class: driver.class,
        }),
        assigned_at: now,
        pool_id: by.poolId ?? null,
        updated_at: now,
      })
      .where('id', '=', ride.id)
      .execute();
    // every other offer of this ride is over: those drivers' screens must close it
    const withdrawn = await trx
      .updateTable('ride_offers')
      .set({ status: 'withdrawn', responded_at: now })
      .where('ride_id', '=', ride.id)
      .where('status', '=', 'pending')
      .$if(Boolean(by.offerId), (q) => q.where('id', '!=', by.offerId!))
      .returning(['id', 'driver_id'])
      .execute();
    await this.offersClosed(trx, ride.id, withdrawn);
    if (previousDriverId) {
      await this.event(trx, ride.id, 'driver_released', by.actor, by.actorId, {
        driverId: previousDriverId,
        reason: 'reassigned',
      });
    }
    await this.event(trx, ride.id, 'assigned', by.actor, by.actorId, {
      driverId,
      ...(by.offerId ? { offerId: by.offerId } : {}),
      ...(by.poolId ? { poolId: by.poolId } : {}),
      manual: Boolean(by.manual),
    });
    await emit(trx, 'ride.status_changed', {
      rideId: ride.id,
      from: ride.status,
      to: 'driver_assigned',
      ...(previousDriverId ? { previousDriverId } : {}),
    });
  }

  /**
   * Gives a searching ride to a driver, whatever the car carries: a car with riders who
   * share takes it as one more on its way (checked again under the locks), a driver heading
   * somewhere only if it is still on the way, a free car simply. The caller holds the ride.
   */
  async giveToDriver(
    trx: Tx,
    ride: Ride,
    driverId: string,
    by: { actor: RideActor; actorId: string | null; offerId?: string; manual?: boolean },
  ): Promise<void> {
    const car = await this.pool.car(trx, driverId);
    if (car?.rides.length && ride.status === 'searching' && ride.shareable) {
      await this.pool.join(trx, ride, driverId, (poolId) =>
        this.assignDriver(trx, ride, driverId, { ...by, poolId }),
      );
      return;
    }
    if (car?.destination && !by.manual) {
      const fit = await this.pool.fit(car, ride, await this.settings.pool(trx));
      if (!fit) throw new ConflictException('Bu buyurtma endi yo‘lingizda emas');
    }
    await this.assignDriver(trx, ride, driverId, by);
  }

  // Rider actions ----------------------------------------------------------------------

  /**
   * The rider cancels. Free until the driver has arrived and the free waiting is over;
   * after that the tariff's cancellation fee is owed to the driver.
   */
  async cancelByRider(user: AuthUser, rideId: string, reason: string | null) {
    await this.db.transaction(async (trx) => {
      const ride = await this.lockRide(trx, rideId);
      if (ride.rider_id !== user.userId) throw new NotFoundException('Buyurtma topilmadi');
      if (!RIDER_CANCELLABLE.includes(ride.status)) {
        throw new ConflictException('Bu bosqichda buyurtmani bekor qilib bo‘lmaydi');
      }
      const tariff = this.tariffOf(ride);
      const fee =
        ride.status === 'driver_arrived' &&
        ride.arrived_at &&
        freeWaitingOver(ride.arrived_at, new Date(), tariff)
          ? tariff.cancellation_fee
          : 0;
      await this.cancel(trx, ride, 'rider', user.userId, reason, fee);
    });
    return this.riderView(user, rideId);
  }

  // Driver actions ---------------------------------------------------------------------

  async arrive(user: AuthUser, rideId: string) {
    await this.driverStep(user, rideId, 'driver_assigned', 'driver_arrived', (_trx, _ride, now) =>
      Promise.resolve({ set: { arrived_at: now } }),
    );
    return this.driverView(user, rideId);
  }

  /**
   * The rider is in the car: paid waiting (after the free minutes) is fixed now. A ride with
   * a start code starts only with the code the rider tells the driver.
   */
  async start(user: AuthUser, rideId: string, pin: string | null = null) {
    await this.driverStep(user, rideId, 'driver_arrived', 'in_progress', async (trx, ride, now) => {
      if (ride.start_pin && pin !== ride.start_pin) {
        throw new BadRequestException(
          pin
            ? 'Kod noto‘g‘ri: yo‘lovchidan 4 xonali kodni so‘rang'
            : 'Yo‘lovchidan 4 xonali kodni so‘rang',
        );
      }
      const fee = ride.arrived_at ? waitingFee(ride.arrived_at, now, this.tariffOf(ride)) : 0;
      await this.pool.pickedUp(trx, ride);
      return { set: { started_at: now, waiting_fee: fee }, data: { waitingFee: fee } };
    });
    return this.driverView(user, rideId);
  }

  /**
   * Arrived at the destination: the rider pays the quoted fare plus paid waiting (cash to
   * the driver), and the ride's tax and commission are debited from the driver's balance.
   */
  async complete(user: AuthUser, rideId: string) {
    await this.driverStep(user, rideId, 'in_progress', 'completed', async (trx, ride, now) => {
      // a shared ride's discount (the part of the trip shared with other riders) is off
      const total = ride.fare_quoted - ride.pool_discount + ride.waiting_fee;
      await this.pool.droppedOff(trx, ride);
      if (ride.payment_method === 'card') {
        // the rider prepaid the quoted fare to the platform: it is the driver's money now
        // (paid waiting on a card ride is collected in cash)
        await this.ledger.post(trx, {
          driverId: ride.driver_id!,
          kind: 'card_fare',
          amount: ride.fare_quoted,
          rideId: ride.id,
          note: `Karta orqali to‘langan safar #${ride.number}`,
        });
      }
      await trx
        .updateTable('drivers')
        .set((eb) => ({ rides_completed: eb('rides_completed', '+', 1) }))
        .where('user_id', '=', ride.driver_id!)
        .execute();
      // earlier rides' owed cancellation fees, paid in cash with this fare
      const owedCollected = ride.owed_fee > 0 ? await this.collectOwedFees(trx, ride) : 0;
      const charged = await this.charges.charge(trx, {
        id: ride.id,
        number: ride.number,
        driverId: ride.driver_id!,
        kind: ride.kind,
        fareTotal: total,
        completedAt: now,
      });
      // the electronic fiscal receipt, cash rides too (Resolution 200)
      await emit(trx, 'fiscal.receipt_due', { rideId: ride.id });
      return {
        set: {
          completed_at: now,
          fare_total: total,
          // cash went to the driver; a card fare was prepaid before dispatch
          payment_status: 'paid' as const,
          // fees waived since the order are not collected
          owed_fee: owedCollected,
        },
        data: {
          fare: total,
          commission: charged.commission,
          tax: charged.tax,
          ...(owedCollected ? { owedFee: owedCollected } : {}),
        },
      };
    });
    return this.driverView(user, rideId);
  }

  /**
   * The driver gives the ride up. A rider who did not come out (after the no-show wait)
   * ends the ride with the cancellation fee; any other reason sends the ride back to
   * dispatch and counts against the driver's reliability.
   */
  async cancelByDriver(
    user: AuthUser,
    rideId: string,
    reasonCode: DriverCancelReason,
    note: string | null,
  ) {
    const dispatch = await this.settings.dispatch();
    await this.db.transaction(async (trx) => {
      const ride = await this.lockRide(trx, rideId);
      if (ride.driver_id !== user.userId || !isActive(ride.status)) {
        throw new NotFoundException('Sizda bunday faol buyurtma yo‘q');
      }
      if (ride.status === 'in_progress') {
        throw new ConflictException('Safar boshlangan: muammo bo‘lsa operatorga murojaat qiling');
      }
      const reason = note
        ? `${DRIVER_CANCEL_REASONS[reasonCode]}: ${note}`
        : DRIVER_CANCEL_REASONS[reasonCode];
      if (reasonCode === 'rider_no_show') {
        const waited = ride.arrived_at ? (Date.now() - ride.arrived_at.getTime()) / 60_000 : 0;
        if (ride.status !== 'driver_arrived' || waited < dispatch.no_show_after_minutes) {
          throw new ConflictException(
            msg('Yo‘lovchini kamida {0} daqiqa kuting', dispatch.no_show_after_minutes),
          );
        }
        await trx
          .updateTable('users')
          .set((eb) => ({ no_show_count: eb('no_show_count', '+', 1) }))
          .where('id', '=', ride.rider_id)
          .execute();
        await this.cancel(
          trx,
          ride,
          'driver',
          user.userId,
          reason,
          this.tariffOf(ride).cancellation_fee,
        );
        return;
      }
      await trx
        .updateTable('drivers')
        .set((eb) => ({ rides_cancelled: eb('rides_cancelled', '+', 1) }))
        .where('user_id', '=', user.userId)
        .execute();
      await this.release(trx, ride, 'driver', user.userId, reason, reasonCode);
    });
  }

  // Operator actions -------------------------------------------------------------------

  async assignByOperator(operator: AuthUser, rideId: string, driverId: string) {
    await this.db.transaction(async (trx) => {
      const ride = await this.lockRide(trx, rideId);
      await this.giveToDriver(trx, ride, driverId, {
        actor: 'operator',
        actorId: operator.userId,
        manual: true,
      });
    });
    return this.adminView(rideId);
  }

  async cancelByOperator(operator: AuthUser, rideId: string, reason: string) {
    await this.db.transaction(async (trx) => {
      const ride = await this.lockRide(trx, rideId);
      if (!isUnfinished(ride.status) && ride.status !== 'scheduled') {
        throw new ConflictException('Buyurtma allaqachon yakunlangan');
      }
      await this.cancel(trx, ride, 'operator', operator.userId, reason, 0);
    });
    return this.adminView(rideId);
  }

  // Shared transitions -----------------------------------------------------------------

  /** Ends a ride as cancelled; any pending offers are withdrawn. */
  async cancel(
    trx: Tx,
    ride: Ride,
    by: RideActor,
    actorId: string | null,
    reason: string | null,
    fee: number,
    opts: { paymentStatus?: RidePaymentStatus } = {},
  ): Promise<void> {
    const now = new Date();
    // riders sharing the car: the plan and their shared prices follow without this one
    if (ride.pool_id && isActive(ride.status))
      await this.pool.left(trx, ride, { keepPoolId: true });
    // a card ride's unpaid intent closes; a paid one is queued for a full refund
    const paymentStatus =
      opts.paymentStatus ??
      (ride.payment_method === 'card'
        ? await this.intents.onRideCancelled(trx, ride.id)
        : 'not_charged');
    await trx
      .updateTable('rides')
      .set({
        status: 'cancelled',
        cancelled_by: by,
        cancel_reason: reason,
        cancellation_fee: fee,
        payment_status: paymentStatus,
        cancelled_at: now,
        updated_at: now,
        // a cash ride's fee is owed until the rider's next cash ride collects it
        ...(fee > 0 && ride.payment_method === 'cash' ? { fee_status: 'owed' as const } : {}),
        // fees this ride was to collect stay owed, for the next ride
        owed_fee: 0,
      })
      .where('id', '=', ride.id)
      .execute();
    if (ride.owed_fee > 0) {
      await trx
        .updateTable('rides')
        .set({ fee_collect_ride_id: null })
        .where('fee_collect_ride_id', '=', ride.id)
        .where('fee_status', '=', 'owed')
        .execute();
    }
    const withdrawn = await trx
      .updateTable('ride_offers')
      .set({ status: 'withdrawn', responded_at: now })
      .where('ride_id', '=', ride.id)
      .where('status', '=', 'pending')
      .returning(['id', 'driver_id'])
      .execute();
    await this.offersClosed(trx, ride.id, withdrawn);
    await this.event(trx, ride.id, 'cancelled', by, actorId, {
      reason,
      ...(fee ? { fee } : {}),
      ...(ride.driver_id ? { driverId: ride.driver_id } : {}),
    });
    await emit(trx, 'ride.status_changed', { rideId: ride.id, from: ride.status, to: 'cancelled' });
  }

  /** Takes the driver off a ride that has not started: it goes back to dispatch. */
  async release(
    trx: Tx,
    ride: Ride,
    by: RideActor,
    actorId: string | null,
    reason: string,
    reasonCode: string | null = null,
  ): Promise<void> {
    const now = new Date();
    if (ride.pool_id) await this.pool.left(trx, ride, { keepPoolId: false });
    await trx
      .updateTable('rides')
      .set({
        status: 'searching',
        pool_id: null,
        pool_shared_m: 0,
        pool_discount: 0,
        driver_id: null,
        vehicle: null,
        assigned_at: null,
        arrived_at: null,
        dispatch_stage: 'direct',
        direct_offers: 0,
        broadcast_at: null,
        attention_at: null,
        updated_at: now,
      })
      .where('id', '=', ride.id)
      .execute();
    await this.event(trx, ride.id, 'driver_released', by, actorId, {
      driverId: ride.driver_id,
      reason,
      ...(reasonCode ? { reasonCode } : {}),
    });
    await emit(trx, 'ride.status_changed', {
      rideId: ride.id,
      from: ride.status,
      to: 'searching',
      previousDriverId: ride.driver_id,
    });
    await emit(trx, 'ride.requested', { rideId: ride.id });
  }

  private async driverStep(
    user: AuthUser,
    rideId: string,
    from: RideStatus,
    to: RideStatus,
    apply: (
      trx: Tx,
      ride: Ride,
      now: Date,
    ) => Promise<{ set?: Updateable<RidesTable>; data?: Record<string, unknown> }>,
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const ride = await this.lockRide(trx, rideId);
      if (ride.driver_id !== user.userId)
        throw new NotFoundException('Sizda bunday faol buyurtma yo‘q');
      if (ride.status !== from) {
        throw new ConflictException(msg('Buyurtma holati mos emas: {0}', ride.status));
      }
      const now = new Date();
      // one update: the row's checks (a completed ride has its total) see the whole change
      const { set = {}, data = {} } = await apply(trx, ride, now);
      await trx
        .updateTable('rides')
        .set({ ...set, status: to, updated_at: now })
        .where('id', '=', ride.id)
        .execute();
      await this.event(
        trx,
        ride.id,
        to === 'driver_arrived' ? 'arrived' : to === 'in_progress' ? 'started' : to,
        'driver',
        user.userId,
        data,
      );
      await emit(trx, 'ride.status_changed', { rideId: ride.id, from, to });
    });
  }

  /** Tells drivers whose offers of this ride were withdrawn (realtime offer.closed). */
  private async offersClosed(
    trx: Tx,
    rideId: string,
    offers: { id: string; driver_id: string }[],
  ): Promise<void> {
    for (const o of offers) {
      await emit(trx, 'ride.offer_closed', {
        offerId: o.id,
        rideId,
        driverId: o.driver_id,
        status: 'withdrawn',
      });
    }
  }

  async event(
    trx: Tx,
    rideId: string,
    type: string,
    actor: RideActor,
    actorId: string | null,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await trx
      .insertInto('ride_events')
      .values({
        id: uuidv7(),
        ride_id: rideId,
        type,
        actor,
        actor_id: actorId,
        data: JSON.stringify(data),
      })
      .execute();
  }

  tariffOf(ride: Pick<Ride, 'tariff'>): Tariff {
    return Tariff.parse(ride.tariff);
  }

  // Operators: callers ----------------------------------------------------------------

  /** Who is calling: the account, their open ride, recent rides and places (phone orders). */
  async customerLookup(phone: string) {
    const user = await this.db.kysely
      .selectFrom('users')
      .select([
        'id',
        'full_name',
        'phone',
        'status',
        'rider_rating_sum',
        'rider_rating_count',
        'no_show_count',
        'created_at',
      ])
      .where('phone', '=', phone)
      .executeTakeFirst();
    if (!user) return { found: false as const, phone };
    const [open, recent, places] = await Promise.all([
      this.db.kysely
        .selectFrom('rides')
        .select('id')
        .where('rider_id', '=', user.id)
        .where('status', 'in', [...UNFINISHED_RIDE_STATUSES])
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('rides')
        .select(LIST_COLUMNS)
        .where('rider_id', '=', user.id)
        .orderBy('id', 'desc')
        .limit(10)
        .execute(),
      this.db.kysely
        .selectFrom('rider_places')
        .select(['id', 'kind', 'label', 'address', 'landmark', 'lat', 'lng'])
        .where('user_id', '=', user.id)
        .orderBy('created_at')
        .execute(),
    ]);
    // pickups and drop-offs of recent rides, one per place, newest first
    const seen = new Set<string>();
    const recentPlaces: {
      address: string | null;
      landmark: string | null;
      lat: number;
      lng: number;
    }[] = [];
    for (const r of recent) {
      for (const p of [
        { ...r.pickup, lat: r.pickup_lat, lng: r.pickup_lng },
        { ...r.dropoff, lat: r.dropoff_lat, lng: r.dropoff_lng },
      ]) {
        const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        recentPlaces.push({ address: p.address, landmark: p.landmark, lat: p.lat, lng: p.lng });
      }
    }
    return {
      found: true as const,
      phone,
      user: {
        id: user.id,
        name: user.full_name,
        status: user.status,
        rating:
          Math.round(((user.rider_rating_sum + 5 * 4.8) / (user.rider_rating_count + 5)) * 10) / 10,
        noShows: user.no_show_count,
        since: user.created_at,
      },
      openRide: open ? await this.adminView(open.id) : null,
      // fees from cancelled cash rides the next cash ride collects (operators may waive them)
      owedFee: await this.owedFeeLine(user.id),
      recentRides: recent.map((r) => this.baseView(r)),
      recentPlaces: recentPlaces.slice(0, 10),
      savedPlaces: places,
    };
  }

  // Scheduled rides --------------------------------------------------------------------

  /** The rider's rides for later, soonest first. */
  async riderScheduled(user: AuthUser) {
    const rows = await this.db.kysely
      .selectFrom('rides')
      .select(LIST_COLUMNS)
      .where('rider_id', '=', user.userId)
      .where('status', '=', 'scheduled')
      .orderBy('scheduled_for')
      .execute();
    return rows.map((r) => this.baseView(r));
  }

  /**
   * Starts the search for scheduled rides whose time is near (the dispatch loop calls it
   * every tick). A rider who is on another ride by then gets the scheduled one cancelled
   * with a reason (one open ride per rider).
   */
  async activateScheduled(now = new Date()): Promise<number> {
    const due = await this.db.kysely
      .selectFrom('rides')
      .select('id')
      .where('status', '=', 'scheduled')
      .where(
        'scheduled_for',
        '<=',
        new Date(now.getTime() + SCHEDULE_DISPATCH_BEFORE_MINUTES * 60_000),
      )
      .orderBy('scheduled_for')
      .limit(100)
      .execute();
    let started = 0;
    for (const { id } of due) {
      const done = await this.db.transaction(async (trx) => {
        const ride = await trx
          .selectFrom('rides')
          .selectAll()
          .where('id', '=', id)
          .where('status', '=', 'scheduled')
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!ride) return false;
        await sql`select pg_advisory_xact_lock(hashtext(${ride.rider_id}))`.execute(trx);
        const busy = await trx
          .selectFrom('rides')
          .select('id')
          .where('rider_id', '=', ride.rider_id)
          .where('status', 'in', [...UNFINISHED_RIDE_STATUSES])
          .executeTakeFirst();
        if (busy) {
          await this.cancel(trx, ride, 'system', null, 'Boshqa safaringiz davom etmoqda', 0);
          return false;
        }
        await trx
          .updateTable('rides')
          .set({ status: 'searching', requested_at: now, updated_at: now })
          .where('id', '=', ride.id)
          .execute();
        await this.event(trx, ride.id, 'dispatch_started', 'system', null, {
          scheduledFor: ride.scheduled_for,
        });
        await emit(trx, 'ride.status_changed', {
          rideId: ride.id,
          from: 'scheduled',
          to: 'searching',
        });
        await emit(trx, 'ride.requested', { rideId: ride.id });
        return true;
      });
      if (done) started++;
    }
    return started;
  }

  // Card rides not paid in time -------------------------------------------------------

  /**
   * Cancels card rides whose payment window closed (worker housekeeping); returns how many.
   * Each ride is re-checked under its lock: the payment may have completed since the scan.
   */
  async expireUnpaid(now = new Date(), limit = 100): Promise<number> {
    const due = await this.intents.dueRideIntents(now, limit);
    let expired = 0;
    for (const rideId of due) {
      const done = await this.db.transaction(async (trx) => {
        const ride = await trx
          .selectFrom('rides')
          .selectAll()
          .where('id', '=', rideId)
          .where('status', '=', 'awaiting_payment')
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!ride) return false;
        await this.intents.expireRideIntent(trx, ride.id);
        await this.cancel(trx, ride, 'system', null, 'To‘lov vaqtida amalga oshirilmadi', 0, {
          paymentStatus: 'failed',
        });
        return true;
      });
      if (done) expired++;
    }
    return expired;
  }

  // Share link ---------------------------------------------------------------------------

  /** A link anyone can open to follow the ride live; it stops working when the ride ends. */
  async share(user: AuthUser, rideId: string) {
    const ride = await this.db.kysely
      .selectFrom('rides')
      .select(['id', 'rider_id', 'driver_id', 'status', 'share_token'])
      .where('id', '=', rideId)
      .executeTakeFirst();
    if (!ride || (ride.rider_id !== user.userId && ride.driver_id !== user.userId)) {
      throw new NotFoundException('Buyurtma topilmadi');
    }
    if (!isOpen(ride.status)) throw new GoneException('Safar yakunlangan');
    let token = ride.share_token;
    if (!token) {
      token = randomBytes(18).toString('base64url');
      const set = await this.db.kysely
        .updateTable('rides')
        .set({ share_token: token })
        .where('id', '=', rideId)
        .where('share_token', 'is', null)
        .executeTakeFirst();
      if (!set.numUpdatedRows) {
        token = (
          await this.db.kysely
            .selectFrom('rides')
            .select('share_token')
            .where('id', '=', rideId)
            .executeTakeFirstOrThrow()
        ).share_token!;
      }
    }
    return { token, url: `${this.env.SHARE_BASE_URL.replace(/\/$/, '')}/t/${token}` };
  }

  // Views --------------------------------------------------------------------------------

  async findRide(rideId: string, db: Db = this.db.kysely): Promise<Ride> {
    const ride = await db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .executeTakeFirst();
    if (!ride) throw new NotFoundException('Buyurtma topilmadi');
    return ride;
  }

  /** The rider's view: the ride, the driver and car once assigned, and what cancelling costs now. */
  async riderView(user: AuthUser, rideId: string) {
    const ride = await this.findRide(rideId);
    if (ride.rider_id !== user.userId) throw new NotFoundException('Buyurtma topilmadi');
    const base = this.baseView(ride);
    const driver = ride.driver_id ? await this.driverCard(ride.driver_id) : null;
    const tariff = this.tariffOf(ride);
    const cancelFeeNow =
      ride.status === 'driver_arrived' &&
      ride.arrived_at &&
      freeWaitingOver(ride.arrived_at, new Date(), tariff)
        ? tariff.cancellation_fee
        : 0;
    return {
      ...base,
      driver,
      receipt: ride.status === 'completed' ? await this.fiscal.forRide(ride.id) : null,
      canCancel: RIDER_CANCELLABLE.includes(ride.status),
      cancelFeeNow,
      // card rides: the prepayment, with where to pay while it is pending
      payment: ride.payment_method === 'card' ? await this.intents.forRide(ride.id) : null,
      // this ride's own rules (the tariff it was ordered under), whatever changed since
      rules: {
        freeWaitingMinutes: tariff.waiting.free_minutes,
        waitingPerMinute: tariff.waiting.per_minute,
        cancellationFee: tariff.cancellation_fee,
      },
      rated: await this.rated(ride.id, 'rider'),
      // the code the rider tells the driver before the trip starts
      startPin: isOpen(ride.status) ? ride.start_pin : null,
      // the car: people in it now and free seats (riders sharing see who else rides)
      car:
        ride.driver_id && isActive(ride.status) ? await this.pool.occupancy(ride.driver_id) : null,
      ...(await this.carProgress(ride)),
      events: await this.events(ride.id, RIDER_EVENTS),
    };
  }

  private async rated(rideId: string, role: 'rider' | 'driver'): Promise<boolean> {
    const row = await this.db.kysely
      .selectFrom('ratings')
      .select('id')
      .where('ride_id', '=', rideId)
      .where('author_role', '=', role)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * The car coming: its road ETA to the pickup (refreshed with its position every ~15 s)
   * while the driver is on the way, and its recent trail since the assignment for a smooth
   * marker (like SFF Eats' courier trail).
   */
  private async carProgress(ride: Ride) {
    if (!ride.driver_id || !isActive(ride.status)) {
      return { driverEta: null, destinationEta: null, trail: [] };
    }
    const [trail, car] = await Promise.all([
      this.track.trail(ride.driver_id, ride.assigned_at),
      this.db.kysely
        .selectFrom('drivers')
        .select(['lat', 'lng'])
        .where('user_id', '=', ride.driver_id)
        .executeTakeFirst(),
    ]);
    const driverEta =
      ride.status === 'driver_assigned' && car?.lat != null && car.lng != null
        ? await this.pickupEta.eta(
            ride.id,
            { lat: car.lat, lng: car.lng },
            { lat: ride.pickup_lat, lng: ride.pickup_lng },
          )
        : null;
    // on the trip: the road ETA from the car to the destination, refreshed the same way
    const destinationEta =
      ride.status === 'in_progress' && car?.lat != null && car.lng != null
        ? await this.pickupEta.eta(
            ride.id,
            { lat: car.lat, lng: car.lng },
            { lat: ride.dropoff_lat, lng: ride.dropoff_lng },
            new Date(),
            'dropoff',
          )
        : null;
    return { driverEta, destinationEta, trail };
  }

  /** The driver's view: the rider's name, phone and rating, the fare and deductions. */
  async driverView(user: AuthUser, rideId: string) {
    const ride = await this.findRide(rideId);
    if (ride.driver_id !== user.userId) throw new NotFoundException('Buyurtma topilmadi');
    return {
      ...this.baseView(ride),
      rider: await this.riderCard(ride),
      earnings: this.earnings(ride),
      // what the driver takes from the rider in cash: the fare after the shared discount and
      // the deposit paid in advance (card rides: prepaid, only paid waiting) plus fees the
      // rider owed from earlier rides
      collectCash:
        (ride.payment_method === 'cash'
          ? ride.fare_quoted - ride.pool_discount - ride.deposit_amount
          : 0) +
        ride.waiting_fee +
        ride.owed_fee,
      // riders sharing the car: every stop ahead in order
      pool: ride.driver_id && isActive(ride.status) ? await this.driverStops(ride.driver_id) : null,
    };
  }

  /** The driver's stops ahead when the car carries several riders (null for one ride). */
  async driverStops(driverId: string) {
    const car = await this.pool.car(this.db.kysely, driverId);
    if (!car || car.rides.length < 2) return null;
    const rides = await this.db.kysely
      .selectFrom('rides')
      .select(['id', 'number', 'rider_name', 'passengers', 'pickup', 'dropoff', 'status'])
      .where(
        'id',
        'in',
        car.rides.map((r) => r.id),
      )
      .execute();
    const byId = new Map(rides.map((r) => [r.id, r]));
    return {
      riders: car.rides.length,
      occupancy: await this.pool.occupancy(driverId),
      stops: car.stops.map((s) => {
        const r = byId.get(s.rideId!)!;
        return {
          rideId: s.rideId,
          number: r.number,
          type: s.type,
          lat: s.lat,
          lng: s.lng,
          place: s.type === 'pickup' ? r.pickup : r.dropoff,
          riderName: r.rider_name,
          passengers: s.passengers,
          status: r.status,
        };
      }),
    };
  }

  /** Everything, for operators: offers made, the full event history. */
  async adminView(rideId: string) {
    const ride = await this.findRide(rideId);
    const [driver, offers, events, rider] = await Promise.all([
      ride.driver_id ? this.driverCard(ride.driver_id) : null,
      this.db.kysely
        .selectFrom('ride_offers as o')
        .innerJoin('drivers as d', 'd.user_id', 'o.driver_id')
        .select([
          'o.id',
          'o.driver_id as driverId',
          'd.full_name as driverName',
          'o.kind',
          'o.status',
          'o.eta_s as etaS',
          'o.distance_m as distanceM',
          'o.score',
          'o.created_at as createdAt',
          'o.expires_at as expiresAt',
          'o.responded_at as respondedAt',
          'o.decline_reason as declineReason',
        ])
        .where('o.ride_id', '=', ride.id)
        .orderBy('o.created_at')
        .orderBy('o.id')
        .execute()
        .then((rows) =>
          rows.map((o) => ({
            ...o,
            declineReasonLabel: reasonLabel(DECLINE_REASONS, o.declineReason),
          })),
        ),
      this.events(ride.id).then((rows) => rows.map(labelEvent)),
      this.riderCard(ride),
    ]);
    // fees this ride carries from earlier rides, and this ride's own fee if it is owed
    const collects = ride.owed_fee
      ? await this.db.kysely
          .selectFrom('rides')
          .select(['id as rideId', 'number', 'cancellation_fee as amount', 'fee_status as status'])
          .where('fee_collect_ride_id', '=', ride.id)
          .execute()
      : [];
    return {
      ...this.baseView(ride),
      rider,
      driver,
      createdBy: ride.created_by,
      dispatch: {
        stage: ride.dispatch_stage,
        directOffers: ride.direct_offers,
        broadcastAt: ride.broadcast_at,
        attentionAt: ride.attention_at,
      },
      earnings: this.earnings(ride),
      owedFees: {
        /** This ride's cancellation fee: owed, collected (by a later ride) or waived. */
        own: ride.fee_status
          ? {
              amount: ride.cancellation_fee,
              status: ride.fee_status,
              collectingRideId: ride.fee_collect_ride_id,
              waivedBy: ride.fee_waived_by,
              waiveNote: ride.fee_waive_note,
            }
          : null,
        /** Earlier rides' fees this ride collects in cash on top of its fare. */
        collects,
      },
      offers,
      events,
      reasonLabels: REASON_LABELS,
    };
  }

  baseView(ride: ListedRide) {
    const vehicle = ride.vehicle
      ? { ...ride.vehicle, plateFormatted: formatPlate(ride.vehicle.plate) }
      : null;
    return {
      id: ride.id,
      number: ride.number,
      status: ride.status,
      channel: ride.channel,
      kind: ride.kind,
      class: ride.class,
      cityId: ride.city_id,
      pickup: { ...ride.pickup, lat: ride.pickup_lat, lng: ride.pickup_lng },
      dropoff: { ...ride.dropoff, lat: ride.dropoff_lat, lng: ride.dropoff_lng },
      options: ride.options,
      comment: ride.comment,
      distanceM: ride.distance_m,
      durationS: ride.duration_s,
      fare: {
        quoted: ride.fare_quoted,
        waiting: ride.waiting_fee,
        total: ride.fare_total,
        cancellationFee: ride.cancellation_fee,
        /** A cash ride's cancellation fee: owed (paid with the next cash ride), collected, waived. */
        cancellationFeeStatus: ride.fee_status,
        /** Earlier rides' owed fees this ride collects in cash, a separate line from the fare. */
        owedFee: ride.owed_fee,
        /** The shared-ride discount (the part of the trip shared with other riders). */
        poolDiscount: ride.pool_discount,
        /** Paid by card in advance (a ride booked for later). */
        deposit: ride.deposit_amount,
        /** What the rider pays for the trip now: the fare after the discount, before waiting. */
        pays: ride.fare_quoted - ride.pool_discount,
        breakdown: ride.fare as unknown as Fare,
      },
      service: ride.service,
      passengers: ride.passengers,
      shareable: ride.shareable,
      womenOnly: ride.women_only,
      fareMode: ride.fare_mode,
      pool: ride.pool_id ? { id: ride.pool_id, sharedM: ride.pool_shared_m } : null,
      hasStartPin: ride.start_pin !== null,
      paymentMethod: ride.payment_method,
      paymentStatus: ride.payment_status,
      vehicle,
      cancelledBy: ride.cancelled_by,
      cancelReason: ride.cancel_reason,
      requestedAt: ride.requested_at,
      assignedAt: ride.assigned_at,
      arrivedAt: ride.arrived_at,
      startedAt: ride.started_at,
      completedAt: ride.completed_at,
      cancelledAt: ride.cancelled_at,
      scheduledFor: ride.scheduled_for,
    };
  }

  private earnings(ride: ListedRide) {
    return ride.status === 'completed'
      ? {
          fare: ride.fare_total,
          commission: ride.commission,
          commissionNote: ride.commission_note,
          tax: ride.tax,
          net: (ride.fare_total ?? 0) - ride.commission - ride.tax,
        }
      : null;
  }

  async driverCard(driverId: string) {
    const d = await this.db.kysely
      .selectFrom('drivers as d')
      .innerJoin('users as u', 'u.id', 'd.user_id')
      .leftJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select([
        'd.photo_upload_id',
        'v.photo_upload_id as vehicle_photo_upload_id',
        'd.user_id',
        'd.full_name',
        'u.phone',
        'd.lat',
        'd.lng',
        'd.heading',
        'd.located_at',
        'd.offers_received',
        'd.offers_accepted',
        'd.rides_cancelled',
        'd.rating_sum',
        'd.rating_count',
        'd.rides_completed',
      ])
      .where('d.user_id', '=', driverId)
      .executeTakeFirst();
    if (!d) return null;
    const p = priority({
      offersReceived: d.offers_received,
      offersAccepted: d.offers_accepted,
      ridesCancelled: d.rides_cancelled,
      ratingSum: d.rating_sum,
      ratingCount: d.rating_count,
    });
    return {
      id: d.user_id,
      name: d.full_name,
      phone: d.phone,
      rating: p.stars,
      ridesCompleted: d.rides_completed,
      // short-lived read URLs (private bucket); null until the driver uploaded them
      photoUrl: await this.uploads.readUrl(d.photo_upload_id),
      vehiclePhotoUrl: await this.uploads.readUrl(d.vehicle_photo_upload_id),
      location:
        d.lat !== null && d.lng !== null
          ? { lat: d.lat, lng: d.lng, heading: d.heading, at: d.located_at }
          : null,
    };
  }

  private async riderCard(ride: Ride) {
    const u = await this.db.kysely
      .selectFrom('users')
      .select(['rider_rating_sum', 'rider_rating_count', 'no_show_count'])
      .where('id', '=', ride.rider_id)
      .executeTakeFirstOrThrow();
    return {
      id: ride.rider_id,
      name: ride.rider_name,
      phone: ride.rider_phone,
      rating: Math.round(((u.rider_rating_sum + 5 * 4.8) / (u.rider_rating_count + 5)) * 10) / 10,
      noShows: u.no_show_count,
    };
  }

  async events(rideId: string, only?: readonly string[]) {
    const rows = await this.db.kysely
      .selectFrom('ride_events')
      .select(['id', 'type', 'actor', 'data', 'created_at as at'])
      .where('ride_id', '=', rideId)
      .$if(Boolean(only), (q) => q.where('type', 'in', [...only!]))
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows;
  }

  // Lists ------------------------------------------------------------------------------

  async riderHistory(user: AuthUser, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('rides')
      .select(LIST_COLUMNS)
      .where('rider_id', '=', user.userId)
      .$if(Boolean(cursor), (q) => q.where('id', '<', cursor!))
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return {
      items: rows.map((r) => this.baseView(r)),
      nextCursor: rows.length === 30 ? rows.at(-1)!.id : null,
    };
  }

  async riderCurrent(user: AuthUser) {
    const open = await this.db.kysely
      .selectFrom('rides')
      .select('id')
      .where('rider_id', '=', user.userId)
      .where('status', 'in', [...UNFINISHED_RIDE_STATUSES])
      .executeTakeFirst();
    return open ? this.riderView(user, open.id) : null;
  }

  /** The driver's active ride; with several riders in the car, the one of the next stop. */
  async driverCurrent(user: AuthUser) {
    const car = await this.pool.car(this.db.kysely, user.userId);
    if (!car?.rides.length) return null;
    const next = car.stops[0]?.rideId ?? car.rides[0]!.id;
    return this.driverView(user, next);
  }

  async driverHistory(user: AuthUser, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('rides')
      .select(LIST_COLUMNS)
      .where('driver_id', '=', user.userId)
      .where('status', 'in', ['completed', 'cancelled'])
      .$if(Boolean(cursor), (q) => q.where('id', '<', cursor!))
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return {
      items: rows.map((r) => ({ ...this.baseView(r), earnings: this.earnings(r) })),
      nextCursor: rows.length === 30 ? rows.at(-1)!.id : null,
    };
  }

  /** Operators' list: open rides by default, or by status, newest first. */
  /**
   * Operators' list, newest first: open rides by default, or by status ("all" for any), a
   * driver, a class, Tashkent days (from/to inclusive), a phone or number search; paged by
   * `cursor` = the last id seen (200 per page).
   */
  async adminList(filter: {
    status?: RideStatus | 'open' | 'all';
    q?: string;
    driverId?: string;
    riderId?: string;
    class?: RideClass;
    from?: string;
    to?: string;
    cursor?: string;
  }) {
    const statuses =
      filter.status === 'all'
        ? null
        : !filter.status || filter.status === 'open'
          ? [...UNFINISHED_RIDE_STATUSES]
          : [filter.status];
    const dayStart = (d: string) => new Date(`${d}T00:00:00+05:00`);
    const rows = await this.db.kysely
      .selectFrom('rides')
      .select(LIST_COLUMNS)
      .$if(statuses !== null, (q) => q.where('status', 'in', statuses!))
      .$if(Boolean(filter.driverId), (q) => q.where('driver_id', '=', filter.driverId!))
      .$if(Boolean(filter.riderId), (q) => q.where('rider_id', '=', filter.riderId!))
      .$if(Boolean(filter.class), (q) => q.where('class', '=', filter.class!))
      // ids are time-ordered (uuid v7) and a ride's id never comes after its request time (a
      // ride for later or a card ride is requested at most ~a day after it was created): the
      // id bounds let the newest-first scan start and stop at the right days
      .$if(Boolean(filter.from), (q) =>
        q
          .where('requested_at', '>=', dayStart(filter.from!))
          .where('id', '>=', uuidFloor(new Date(dayStart(filter.from!).getTime() - 26 * 3600_000))),
      )
      .$if(Boolean(filter.to), (q) =>
        q
          .where('requested_at', '<', new Date(dayStart(filter.to!).getTime() + 86_400_000))
          .where('id', '<', uuidFloor(new Date(dayStart(filter.to!).getTime() + 86_400_000))),
      )
      .$if(Boolean(filter.cursor), (q) => q.where('id', '<', filter.cursor!))
      .$if(Boolean(filter.q), (q) =>
        q.where((eb) =>
          eb.or([
            eb('rider_phone', 'like', containsPattern(filter.q!)),
            ...(/^\d+$/.test(filter.q!) ? [eb('number', '=', Number(filter.q))] : []),
          ]),
        ),
      )
      .orderBy('id', 'desc')
      .limit(200)
      .execute();
    return rows.map((r) => ({
      ...this.baseView(r),
      riderPhone: r.rider_phone,
      riderName: r.rider_name,
      driverId: r.driver_id,
      dispatchStage: r.dispatch_stage,
      attentionAt: r.attention_at,
    }));
  }
}

/** The smallest uuid v7 of a moment: ids of rides created from then on are >= it. */
export function uuidFloor(at: Date): string {
  const hex = Math.max(0, at.getTime()).toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-0000-0000-000000000000`;
}

/** Every ride column but the tariff snapshot (2 KB of JSON): lists never show it. */
const LIST_COLUMNS = [
  'id',
  'number',
  'rider_id',
  'rider_phone',
  'rider_name',
  'channel',
  'created_by',
  'client_request_id',
  'quote_id',
  'city_id',
  'kind',
  'class',
  'pickup',
  'pickup_lat',
  'pickup_lng',
  'dropoff',
  'dropoff_lat',
  'dropoff_lng',
  'options',
  'comment',
  'distance_m',
  'duration_s',
  'fare',
  'fare_quoted',
  'waiting_fee',
  'fare_total',
  'cancellation_fee',
  'commission',
  'commission_note',
  'tax',
  'payment_method',
  'payment_status',
  'status',
  'driver_id',
  'vehicle',
  'dispatch_stage',
  'direct_offers',
  'broadcast_at',
  'attention_at',
  'cancelled_by',
  'cancel_reason',
  'share_token',
  'scheduled_for',
  'fee_status',
  'fee_collect_ride_id',
  'fee_waived_by',
  'fee_waive_note',
  'owed_fee',
  'service',
  'passengers',
  'shareable',
  'women_only',
  'rider_gender',
  'fare_mode',
  'route_fare_id',
  'pool_id',
  'pool_shared_m',
  'pool_discount',
  'deposit_amount',
  'start_pin',
  'requested_at',
  'assigned_at',
  'arrived_at',
  'started_at',
  'completed_at',
  'cancelled_at',
  'updated_at',
] as const satisfies readonly Exclude<keyof RidesTable, 'tariff'>[];

/** An event for operators, with the Uzbek label of the reason code it carries. */
function labelEvent<E extends { type: string; data: Record<string, unknown> }>(e: E) {
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  const label =
    e.type === 'offer_declined'
      ? reasonLabel(DECLINE_REASONS, text(e.data.reason))
      : e.type === 'driver_released'
        ? text(e.data.reasonCode)
          ? reasonLabel(DRIVER_CANCEL_REASONS, text(e.data.reasonCode))
          : reasonLabel(RELEASE_REASONS, text(e.data.reason))
        : null;
  return label ? { ...e, reasonLabel: label } : e;
}

/** Event types riders see in their ride's timeline. */
const RIDER_EVENTS = [
  'requested',
  'dispatch_started',
  'paid',
  'refunded',
  'assigned',
  'driver_released',
  'arrived',
  'started',
  'completed',
  'cancelled',
] as const;
