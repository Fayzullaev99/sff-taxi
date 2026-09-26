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
import { randomBytes } from 'node:crypto';
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
  computeFare,
  type Fare,
  freeWaitingOver,
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
import { AvailabilityService } from './availability.service.js';

type Db = Tx | Database['kysely'];
type Ride = Selectable<RidesTable>;

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
}

export interface OrderInput {
  quoteId: string;
  class: RideClass;
  paymentMethod: PaymentMethod;
  pickup: { address: string | null; landmark: string | null };
  dropoff: { address: string | null; landmark: string | null };
  comment: string | null;
  clientRequestId: string;
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
}

const placeText = (p: { address: string | null; landmark: string | null }) => ({
  address: p.address,
  landmark: p.landmark,
});

export const DRIVER_CANCEL_REASONS = {
  rider_no_show: 'Yo‘lovchi chiqmadi',
  car_problem: 'Avtomobil nosoz',
  cannot_reach: 'Manzilga yetib borolmayman',
  rider_asked: 'Yo‘lovchi bekor qilishni so‘radi',
  other: 'Boshqa sabab',
} as const;
export type DriverCancelReason = keyof typeof DRIVER_CANCEL_REASONS;

const isActive = (s: RideStatus) => (ACTIVE_RIDE_STATUSES as readonly string[]).includes(s);
const isOpen = (s: RideStatus) => (OPEN_RIDE_STATUSES as readonly string[]).includes(s);
const isUnfinished = (s: RideStatus) => (UNFINISHED_RIDE_STATUSES as readonly string[]).includes(s);
/** The rider may cancel until the trip starts. */
const RIDER_CANCELLABLE: readonly RideStatus[] = [
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
    @Inject(ENV) private readonly env: Env,
  ) {}

  // Quotes -----------------------------------------------------------------------------

  /** Prices a trip in every class. The quote is stored so the order uses exactly this price. */
  async quote(user: AuthUser, input: QuoteInput, now = new Date()) {
    const priced = await this.price(input.pickup, input.dropoff, input.options, now);
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
      })
      .execute();
    return {
      quoteId: id,
      expiresAt,
      city: publicCity(priced.city),
      kind: priced.kind,
      distanceM: priced.route.distanceM,
      durationS: priced.route.durationS === null ? null : Math.round(priced.route.durationS),
      routeSource: priced.route.source,
      options: [...new Set(input.options)],
      fares: priced.fares,
      paymentMethods: this.payments.methods(),
      waiting: priced.tariff.waiting,
      cancellationFee: priced.tariff.cancellation_fee,
      // the nearest free car per class, by road: "~4 min" on the class buttons
      availability: await this.availability.near(input.pickup, user.userId),
    };
  }

  /** Prices a trip; `now` is real time, read through the business calendar for the night add-on. */
  private async price(pickup: Point, dropoff: Point, options: RideOption[], now: Date) {
    const at = this.calendar.at(now);
    const service = await this.geo.serviceCity(pickup);
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
    const route = await this.routing.route(pickup, dropoff);
    const fares = Object.fromEntries(
      RIDE_CLASSES.map((rideClass) => [
        rideClass,
        computeFare(
          {
            pickup,
            dropoff,
            roadM: route.distanceM,
            boundary: service.city.boundary,
            rideClass,
            options,
            at,
          },
          service.tariff,
        ),
      ]),
    ) as Record<RideClass, Fare>;
    return { city: service.city, tariff: service.tariff, route, fares, kind: fares.economy.kind };
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
    const fare = (quote.fares as unknown as Record<RideClass, Fare>)[input.class];

    const rider = await this.db.kysely
      .selectFrom('users')
      .select(['phone', 'full_name'])
      .where('id', '=', user.userId)
      .executeTakeFirstOrThrow();
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
      await this.assertNoOpenRide(trx, user.userId);
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
        fare,
        tariff: quote.tariff,
        paymentMethod: input.paymentMethod,
      });
    });
    return { created: true, ride: await this.riderView(user, id) };
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
      await this.assertNoOpenRide(trx, rider.id);
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
    },
  ): Promise<string> {
    const id = uuidv7();
    const place = (p: PlaceInput): Place => ({ address: p.address, landmark: p.landmark });
    // a card ride is dispatched once its fixed fare is prepaid (docs/payments.md)
    const status = r.paymentMethod === 'card' ? 'awaiting_payment' : 'searching';
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
        status,
        updated_at: new Date(),
      })
      .execute();
    await this.event(trx, id, 'requested', r.actor, r.createdBy, {
      channel: r.channel,
      fare: r.fare.total,
      class: r.rideClass,
      paymentMethod: r.paymentMethod,
    });
    if (status === 'awaiting_payment') {
      await this.intents.createForRide(trx, { id, riderId: r.riderId, amount: r.fare.total });
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
    by: { actor: RideActor; actorId: string | null; offerId?: string; manual?: boolean },
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
    const busy = await trx
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
      manual: Boolean(by.manual),
    });
    await emit(trx, 'ride.status_changed', {
      rideId: ride.id,
      from: ride.status,
      to: 'driver_assigned',
      ...(previousDriverId ? { previousDriverId } : {}),
    });
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

  /** The rider is in the car: paid waiting (after the free minutes) is fixed now. */
  async start(user: AuthUser, rideId: string) {
    await this.driverStep(
      user,
      rideId,
      'driver_arrived',
      'in_progress',
      async (_trx, ride, now) => {
        const fee = ride.arrived_at ? waitingFee(ride.arrived_at, now, this.tariffOf(ride)) : 0;
        return { set: { started_at: now, waiting_fee: fee }, data: { waitingFee: fee } };
      },
    );
    return this.driverView(user, rideId);
  }

  /**
   * Arrived at the destination: the rider pays the quoted fare plus paid waiting (cash to
   * the driver), and the ride's tax and commission are debited from the driver's balance.
   */
  async complete(user: AuthUser, rideId: string) {
    await this.driverStep(user, rideId, 'in_progress', 'completed', async (trx, ride, now) => {
      const total = ride.fare_quoted + ride.waiting_fee;
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
        },
        data: { fare: total, commission: charged.commission, tax: charged.tax },
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
      await this.release(trx, ride, 'driver', user.userId, reason);
    });
  }

  // Operator actions -------------------------------------------------------------------

  async assignByOperator(operator: AuthUser, rideId: string, driverId: string) {
    await this.db.transaction(async (trx) => {
      const ride = await this.lockRide(trx, rideId);
      await this.assignDriver(trx, ride, driverId, {
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
      if (!isUnfinished(ride.status)) {
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
      })
      .where('id', '=', ride.id)
      .execute();
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
  ): Promise<void> {
    const now = new Date();
    await trx
      .updateTable('rides')
      .set({
        status: 'searching',
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
        .selectAll()
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
      recentRides: recent.map((r) => this.baseView(r)),
      recentPlaces: recentPlaces.slice(0, 10),
      savedPlaces: places,
    };
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
    if (!ride.driver_id || !isActive(ride.status)) return { driverEta: null, trail: [] };
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
    return { driverEta, trail };
  }

  /** The driver's view: the rider's name, phone and rating, the fare and deductions. */
  async driverView(user: AuthUser, rideId: string) {
    const ride = await this.findRide(rideId);
    if (ride.driver_id !== user.userId) throw new NotFoundException('Buyurtma topilmadi');
    return {
      ...this.baseView(ride),
      rider: await this.riderCard(ride),
      earnings: this.earnings(ride),
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
        .execute(),
      this.events(ride.id),
      this.riderCard(ride),
    ]);
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
      offers,
      events,
    };
  }

  baseView(ride: Ride) {
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
        breakdown: ride.fare as unknown as Fare,
      },
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
    };
  }

  private earnings(ride: Ride) {
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
      .selectAll()
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

  async driverCurrent(user: AuthUser) {
    const active = await this.db.kysely
      .selectFrom('rides')
      .select('id')
      .where('driver_id', '=', user.userId)
      .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
      .executeTakeFirst();
    return active ? this.driverView(user, active.id) : null;
  }

  async driverHistory(user: AuthUser, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('rides')
      .selectAll()
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
      .selectAll()
      .$if(statuses !== null, (q) => q.where('status', 'in', statuses!))
      .$if(Boolean(filter.driverId), (q) => q.where('driver_id', '=', filter.driverId!))
      .$if(Boolean(filter.riderId), (q) => q.where('rider_id', '=', filter.riderId!))
      .$if(Boolean(filter.class), (q) => q.where('class', '=', filter.class!))
      .$if(Boolean(filter.from), (q) => q.where('requested_at', '>=', dayStart(filter.from!)))
      .$if(Boolean(filter.to), (q) =>
        q.where('requested_at', '<', new Date(dayStart(filter.to!).getTime() + 86_400_000)),
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

/** Event types riders see in their ride's timeline. */
const RIDER_EVENTS = [
  'requested',
  'paid',
  'refunded',
  'assigned',
  'driver_released',
  'arrived',
  'started',
  'completed',
  'cancelled',
] as const;
