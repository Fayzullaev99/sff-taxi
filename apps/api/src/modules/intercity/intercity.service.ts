import { driverGivenName } from '../../lib/names.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import type {
  BookingStatus,
  IntercityBookingsTable,
  IntercityPointsTable,
  IntercityTripsTable,
  TripStatus,
} from '../../core/db/schema.js';
import { msg } from '../../core/http/messages.js';
import { emit } from '../../core/outbox/outbox.js';
import { tashkentDayStart } from '../../lib/commission.js';
import { depositAmount } from '../../lib/deposit.js';
import { formatPlate, tashkentDate } from '../../lib/driver-rules.js';
import {
  alongStops,
  alongTheWayShare,
  bookingPrice,
  driverSeatPrices,
  MAX_TRIP_SEATS,
  partSeatPrices,
  priceBand,
  referenceSeatPrices,
  type SeatPrices,
  seatingError,
} from '../../lib/intercity.js';
import { estimatedDurationS } from '../../lib/geo.js';
import { priority } from '../../lib/priority.js';
import type { RideClass } from '../../lib/tariff.js';
import { RideChargesService } from '../billing/charges.service.js';
import { LedgerService } from '../billing/ledger.service.js';
import { RoutingService } from '../geo/routing.service.js';
import { IntentsService } from '../payments/intents.service.js';
import {
  type BookingRules,
  type IntercityRules,
  SettingsService,
} from '../settings/settings.module.js';
import { UploadsService } from '../uploads/uploads.service.js';

type Db = Tx | Database['kysely'];
type Trip = Selectable<IntercityTripsTable>;
type Booking = Selectable<IntercityBookingsTable>;
type Point = Selectable<IntercityPointsTable>;

/** Trips of one driver must be this far apart (a round trip Guliston-Tashkent is ~4 h). */
export const TRIP_SPACING_HOURS = 2;
const OPEN_TRIP: TripStatus[] = ['scheduled', 'boarding'];
const LIVE_BOOKING: BookingStatus[] = ['booked', 'boarded'];
/** Bookings holding seats: live ones and those waiting for their deposit. */
const HOLDING: BookingStatus[] = ['awaiting_payment', 'booked', 'boarded'];

export interface PublishInput {
  from: string;
  to: string;
  departureAt: Date;
  seats: number;
  frontSeat: boolean;
  /** Rear seat price; the reference when omitted. */
  priceRear: number | null;
  meetingPoint: string | null;
  comment: string | null;
}

/** What a driver may change on a trip nobody booked yet (leave out what stays). */
export interface EditTripInput {
  departureAt?: Date;
  seats?: number;
  frontSeat?: boolean;
  /** null = back to the reference price. */
  priceRear?: number | null;
  /** null = the town's meeting point. */
  meetingPoint?: string | null;
  comment?: string | null;
}

export interface BookInput {
  seats: number;
  front: boolean;
  pickupNote: string | null;
  clientRequestId: string | null;
  /** The rider's own towns, for a seat along the way; the trip's ends when left out. */
  from?: string | null;
  to?: string | null;
}

export interface PhoneBookInput extends BookInput {
  riderPhone: string;
  riderName: string | null;
}

/**
 * The intercity trip board (market analysis §6.4): drivers publish departures between towns
 * with fixed seat prices, riders (or operators for callers) book seats, the driver boards,
 * departs and arrives. Seats are counted on the trip row under its lock, backed by checks:
 * however many riders tap "book" at once, a trip is never oversold and the front seat is
 * sold once. Seats are paid in cash to the driver; each completed booking is charged the
 * 1% tax and the intercity commission like a ride. A rider booking in the app pays a
 * deposit by card first (admin/settings/booking), the rest in cash; the platform holds the
 * deposit until the trip and then credits it to the driver (or refunds it).
 *
 * Lock order: payment intents, then the trip, then its bookings (the payment callbacks
 * lock an intent, then its booking).
 */
@Injectable()
export class IntercityService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly routing: RoutingService,
    private readonly charges: RideChargesService,
    private readonly ledger: LedgerService,
    private readonly uploads: UploadsService,
    private readonly intents: IntentsService,
  ) {}

  // Towns and prices -------------------------------------------------------------------

  async points() {
    const rows = await this.db.kysely
      .selectFrom('intercity_points')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('sort')
      .orderBy('name_uz')
      .execute();
    return rows.map(pointView);
  }

  /** A town by id or slug. */
  async point(ref: string, db: Db = this.db.kysely): Promise<Point> {
    const row = await db
      .selectFrom('intercity_points')
      .selectAll()
      .where(/^[0-9a-f-]{36}$/.test(ref) ? 'id' : 'slug', '=', ref)
      .executeTakeFirst();
    if (!row || !row.is_active) throw new NotFoundException('Bunday shahar yo‘q');
    return row;
  }

  /**
   * A route's reference seat prices for a car class: the operators' route price, else the
   * tariff's share of the whole-car fare by road distance. Also the band drivers may ask in.
   */
  async fare(fromRef: string, toRef: string, rideClass: RideClass = 'economy') {
    const [from, to] = await Promise.all([this.point(fromRef), this.point(toRef)]);
    if (from.id === to.id) throw new BadRequestException('Jo‘nash va borish shahri bir xil');
    const [tariff, rules, route, fixed] = await Promise.all([
      this.settings.tariff(),
      this.settings.intercity(),
      this.routing.route({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }),
      this.db.kysely
        .selectFrom('intercity_fares')
        .select(['price_rear', 'price_front'])
        .where('from_point_id', '=', from.id)
        .where('to_point_id', '=', to.id)
        .executeTakeFirst(),
    ]);
    const reference = referenceSeatPrices(
      route.distanceM,
      tariff,
      rideClass,
      fixed ? { rear: fixed.price_rear, front: fixed.price_front } : null,
    );
    return {
      from: pointView(from),
      to: pointView(to),
      class: rideClass,
      distanceM: route.distanceM,
      durationS: route.durationS === null ? null : Math.round(route.durationS),
      source: fixed ? ('route' as const) : ('tariff' as const),
      reference,
      band: priceBand(reference.rear, rules.price_band_percent),
    };
  }

  // Drivers publish --------------------------------------------------------------------

  async publish(user: AuthUser, input: PublishInput, now = new Date()) {
    const rules = await this.settings.intercity();
    const driver = await this.db.kysely
      .selectFrom('drivers as d')
      .innerJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select([
        'd.status',
        'd.licence_card_expires_on',
        'v.make',
        'v.model',
        'v.colour',
        'v.plate',
        'v.class',
        'v.seats',
        'v.cargo_class',
      ])
      .where('d.user_id', '=', user.userId)
      .executeTakeFirst();
    if (!driver) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
    // a cargo car carries loads, not passengers for seats (Resolution 200)
    if (driver.cargo_class) {
      throw new ForbiddenException('Yuk mashinasida yo‘lovchi qatnovi e’lon qilinmaydi');
    }
    if (driver.status !== 'active') {
      throw new ForbiddenException('Faqat tasdiqlangan haydovchi qatnov e’lon qiladi');
    }
    if (driver.licence_card_expires_on < tashkentDate(input.departureAt)) {
      throw new ForbiddenException('Qatnov kuni litsenziya kartochkasi amal qilmaydi');
    }
    const standing = await this.ledger.standing(user.userId);
    if (!standing.canWork) {
      throw new ForbiddenException('Balans juda past: qatnov e’lon qilish uchun to‘ldiring');
    }
    const seating = seatingError(input.seats, input.frontSeat);
    if (seating) throw new BadRequestException(seating);
    if (input.seats > driver.seats) {
      throw new BadRequestException(msg('Avtomobilda {0} ta yo‘lovchi o‘rni bor', driver.seats));
    }
    const minutesAhead = (input.departureAt.getTime() - now.getTime()) / 60_000;
    if (minutesAhead < rules.publish_min_minutes_ahead) {
      throw new BadRequestException(
        msg('Jo‘nash vaqti kamida {0} daqiqadan keyin bo‘lsin', rules.publish_min_minutes_ahead),
      );
    }
    if (minutesAhead > rules.publish_max_days_ahead * 1440) {
      throw new BadRequestException(
        msg('Qatnovni {0} kundan uzoqqa e’lon qilib bo‘lmaydi', rules.publish_max_days_ahead),
      );
    }
    const fare = await this.fare(input.from, input.to, driver.class);
    const rear = input.priceRear ?? fare.reference.rear;
    if (rear < fare.band.min || rear > fare.band.max || rear % 100 !== 0) {
      throw new UnprocessableEntityException({
        message: msg(
          'Narx {0}–{1} so‘m oralig‘ida, 100 so‘mga karrali bo‘lsin',
          fare.band.min,
          fare.band.max,
        ).message,
        band: fare.band,
        reference: fare.reference,
      });
    }
    const prices = driverSeatPrices(fare.reference, rear);
    const id = uuidv7();
    await this.db.transaction(async (trx) => {
      // one publication at a time per driver: the spacing check below cannot race
      await sql`select pg_advisory_xact_lock(hashtext(${'intercity:' + user.userId}))`.execute(trx);
      const spacing = TRIP_SPACING_HOURS * 3_600_000;
      const clash = await trx
        .selectFrom('intercity_trips')
        .select(['number', 'departure_at'])
        .where('driver_id', '=', user.userId)
        .where('status', 'in', ['scheduled', 'boarding', 'departed'])
        .where('departure_at', '>', new Date(input.departureAt.getTime() - spacing))
        .where('departure_at', '<', new Date(input.departureAt.getTime() + spacing))
        .executeTakeFirst();
      if (clash) {
        throw new ConflictException(msg('Shu vaqtga yaqin qatnovingiz bor: #{0}', clash.number));
      }
      await trx
        .insertInto('intercity_trips')
        .values({
          id,
          driver_id: user.userId,
          from_point_id: fare.from.id,
          to_point_id: fare.to.id,
          departure_at: input.departureAt,
          meeting_point: input.meetingPoint ?? fare.from.meetingPoint,
          comment: input.comment,
          class: driver.class,
          vehicle: JSON.stringify({
            make: driver.make,
            model: driver.model,
            colour: driver.colour,
            plate: driver.plate,
            class: driver.class,
          }),
          distance_m: fare.distanceM,
          seats_total: input.seats,
          front_seat: input.frontSeat,
          price_rear: prices.rear,
          price_front: prices.front,
          reference_rear: fare.reference.rear,
          updated_at: now,
        })
        .execute();
      await emit(trx, 'intercity.trip_changed', { tripId: id, from: null, to: 'scheduled' });
    });
    return this.driverTrip(user, id);
  }

  /** Driver steps: boarding opens, the car leaves, the car arrives. */
  async boarding(user: AuthUser, tripId: string, now = new Date()) {
    const rules = await this.settings.intercity();
    await this.db.transaction(async (trx) => {
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (trip.status !== 'scheduled') throw this.wrongStatus(trip.status);
      if (trip.departure_at.getTime() - now.getTime() > rules.boarding_opens_minutes * 60_000) {
        throw new ConflictException(
          msg(
            'Yo‘lovchilarni jo‘nashdan {0} daqiqa oldin yig‘ish mumkin',
            rules.boarding_opens_minutes,
          ),
        );
      }
      await this.setTripStatus(trx, trip, 'boarding', { boarding_at: now });
    });
    return this.driverTrip(user, tripId);
  }

  async board(user: AuthUser, tripId: string, bookingId: string) {
    await this.db.transaction(async (trx) => {
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (!OPEN_TRIP.includes(trip.status)) throw this.wrongStatus(trip.status);
      const b = await this.lockBooking(trx, bookingId, trip.id);
      if (b.status === 'boarded') return;
      if (b.status !== 'booked') throw new ConflictException('Bu bron faol emas');
      await this.setBookingStatus(trx, b, 'boarded', 'driver', { boarded_at: new Date() });
    });
    return this.driverTrip(user, tripId);
  }

  /**
   * The car leaves. Booked riders who did not board are no-shows (their seats go with the
   * car); the trip needs at least one passenger aboard.
   */
  async depart(user: AuthUser, tripId: string) {
    await this.db.transaction(async (trx) => {
      await this.lockDeposits(trx, { tripId });
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (trip.status !== 'boarding') throw this.wrongStatus(trip.status);
      const bookings = await this.liveBookings(trx, trip.id, HOLDING);
      if (!bookings.some((b) => b.status === 'boarded')) {
        throw new ConflictException('Hech kim o‘tirmagan: yo‘lovchini belgilang yoki bekor qiling');
      }
      for (const b of bookings.filter((x) => x.status === 'booked')) {
        await this.setBookingStatus(trx, b, 'no_show', 'driver', {});
        await trx
          .updateTable('users')
          .set((eb) => ({ no_show_count: eb('no_show_count', '+', 1) }))
          .where('id', '=', b.rider_id)
          .execute();
        // the driver kept the seat: the deposit is theirs
        await this.creditDeposit(trx, trip, b, 'kelmagan yo‘lovchi');
      }
      // never paid: the seats were only held
      for (const b of bookings.filter((x) => x.status === 'awaiting_payment')) {
        await this.release(trx, trip, b, 'system', 'Oldindan to‘lov qilinmadi', 0);
        await this.intents.onBookingCancelled(trx, b.id, { refund: false, expired: true });
      }
      await this.setTripStatus(trx, trip, 'departed', { departed_at: new Date() });
    });
    return this.driverTrip(user, tripId);
  }

  /**
   * Arrived: every passenger aboard paid the rest in cash; a deposit the platform held is
   * credited to the driver; each booking's tax and commission are charged on the full price.
   */
  async arrive(user: AuthUser, tripId: string) {
    await this.db.transaction(async (trx) => {
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (trip.status !== 'departed') throw this.wrongStatus(trip.status);
      const now = new Date();
      for (const b of await this.liveBookings(trx, trip.id)) {
        await this.setBookingStatus(trx, b, 'completed', 'driver', { completed_at: now });
        await emit(trx, 'fiscal.receipt_due', { bookingId: b.id });
        await this.creditDeposit(trx, trip, b, 'yo‘lovchi yetkazildi');
        await this.charges.chargeBooking(trx, {
          id: b.id,
          number: b.number,
          driverId: trip.driver_id,
          fare: b.price,
          completedAt: now,
        });
      }
      await this.setTripStatus(trx, trip, 'arrived', { arrived_at: now });
    });
    return this.driverTrip(user, tripId);
  }

  /** The driver calls a trip off before it leaves: every booking is cancelled, riders told. */
  async cancelByDriver(user: AuthUser, tripId: string, reason: string) {
    await this.db.transaction(async (trx) => {
      await this.lockDeposits(trx, { tripId });
      const trip = await this.lockOwnTrip(trx, user, tripId);
      await this.cancelTrip(trx, trip, 'driver', reason);
    });
    return this.driverTrip(user, tripId);
  }

  async cancelByOperator(tripId: string, reason: string) {
    await this.db.transaction(async (trx) => {
      await this.lockDeposits(trx, { tripId });
      const trip = await this.lockTrip(trx, tripId);
      await this.cancelTrip(trx, trip, 'operator', reason);
    });
    return this.adminTrip(tripId);
  }

  /** Every booking is cancelled; deposits paid go back to the riders' cards. */
  private async cancelTrip(trx: Tx, trip: Trip, by: 'driver' | 'operator', reason: string) {
    if (!OPEN_TRIP.includes(trip.status)) throw this.wrongStatus(trip.status);
    const bookings = await this.liveBookings(trx, trip.id, HOLDING);
    for (const b of bookings) {
      await this.setBookingStatus(trx, b, 'cancelled', by, {
        cancelled_at: new Date(),
        cancelled_by: by,
        cancel_reason: reason,
      });
      await this.intents.onBookingCancelled(trx, b.id, { refund: true });
    }
    if (by === 'driver' && bookings.some((b) => b.status !== 'awaiting_payment')) {
      // riders were counting on it: it counts against the driver's reliability
      await trx
        .updateTable('drivers')
        .set((eb) => ({ rides_cancelled: eb('rides_cancelled', '+', 1) }))
        .where('user_id', '=', trip.driver_id)
        .execute();
    }
    await this.setTripStatus(trx, trip, 'cancelled', {
      cancelled_at: new Date(),
      cancelled_by: by,
      cancel_reason: reason,
      seats_booked: 0,
      front_booked: false,
    });
  }

  // Riders book ------------------------------------------------------------------------

  /**
   * Open departures of a route on a Tashkent date (today: from now on), soonest first; then
   * trips between other towns passing the rider's towns ("along the way", `alongTheWay`:
   * the seat priced for the rider's part, `pickup`/`dropoff` the rider's towns), unless
   * `along` is false.
   */
  async search(
    q: { from: string; to: string; date?: string; seats: number; along?: boolean },
    now = new Date(),
  ) {
    const [from, to] = await Promise.all([this.point(q.from), this.point(q.to)]);
    const day = q.date ? new Date(`${q.date}T00:00:00+05:00`) : tashkentDayStart(now);
    const start = new Date(Math.max(day.getTime(), now.getTime()));
    const end = new Date(day.getTime() + 86_400_000);
    const open = () =>
      this.db.kysely
        .selectFrom('intercity_trips')
        .selectAll()
        .where('status', 'in', OPEN_TRIP)
        .where('departure_at', '>=', start)
        .where('departure_at', '<', end)
        .where(sql<boolean>`seats_total - seats_booked >= ${q.seats}`)
        .orderBy('departure_at');
    const rows = await open()
      .where('from_point_id', '=', from.id)
      .where('to_point_id', '=', to.id)
      .limit(100)
      .execute();
    const points = new Map([
      [from.id, from],
      [to.id, to],
    ]);
    const direct = await Promise.all(
      rows.map(async (t) => ({ ...(await this.publicTrip(t, points)), alongTheWay: false })),
    );
    if (q.along === false || from.id === to.id) return direct;

    const [rules, all] = await Promise.all([
      this.settings.intercity(),
      this.db.kysely.selectFrom('intercity_points').selectAll().execute(),
    ]);
    const byId = new Map(all.map((p) => [p.id, p]));
    const others = await open()
      .where((eb) => eb.or([eb('from_point_id', '!=', from.id), eb('to_point_id', '!=', to.id)]))
      .limit(300)
      .execute();
    const along = [];
    for (const t of others) {
      const share = alongTheWayShare(
        byId.get(t.from_point_id)!,
        byId.get(t.to_point_id)!,
        from,
        to,
        rules.along_route_max_km,
      );
      if (share === null) continue;
      const view = await this.publicTrip(t, byId);
      along.push({
        ...view,
        alongTheWay: true,
        pickup: pointView(from),
        dropoff: pointView(to),
        ...this.stops(t, byId, from.id, to.id),
        // the rider's part of the trip, and what their seats cost; fullPrice: the whole trip
        share: Math.round(share * 100) / 100,
        price: partSeatPrices(view.price, share),
        fullPrice: view.price,
      });
    }
    return [...direct, ...along];
  }

  async trip(user: AuthUser, tripId: string) {
    const trip = await this.findTrip(tripId);
    const [view, rules, booking] = await Promise.all([
      this.publicTrip(trip),
      this.settings.intercity(),
      this.settings.booking(),
    ]);
    const mine = await this.db.kysely
      .selectFrom('intercity_bookings')
      .select('id')
      .where('trip_id', '=', trip.id)
      .where('rider_id', '=', user.userId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return {
      ...view,
      myBookingId: mine?.id ?? null,
      // what cancelling a booking of this trip would cost, and until when it is free
      cancelRules: {
        freeCancelMinutes: rules.free_cancel_minutes,
        lateCancelFeePercent: rules.late_cancel_fee_percent,
        freeUntil: new Date(trip.departure_at.getTime() - rules.free_cancel_minutes * 60_000),
      },
      // booking in the app: this share of the price is paid by card first, the rest in cash
      depositRules: {
        percent: booking.deposit_percent,
        min: booking.deposit_min,
        paymentMinutes: booking.payment_minutes,
      },
    };
  }

  /**
   * Books seats; the same clientRequestId returns the same booking (safe retries). With
   * deposits on, the booking waits for its deposit (awaiting_payment, `payment.checkout`)
   * holding its seats; unpaid in time it is cancelled.
   */
  async book(user: AuthUser, tripId: string, input: BookInput) {
    if (input.clientRequestId) {
      const existing = await this.db.kysely
        .selectFrom('intercity_bookings')
        .select('id')
        .where('rider_id', '=', user.userId)
        .where('client_request_id', '=', input.clientRequestId)
        .executeTakeFirst();
      if (existing) return { created: false, booking: await this.riderBooking(user, existing.id) };
    }
    const [rider, deposits] = await Promise.all([
      this.db.kysely
        .selectFrom('users')
        .select(['phone', 'full_name'])
        .where('id', '=', user.userId)
        .executeTakeFirstOrThrow(),
      this.settings.booking(),
    ]);
    if (deposits.deposit_percent > 0 && !this.intents.cardAvailable()) {
      throw new BadRequestException('Oldindan bron uchun karta orqali to‘lov hali ulanmagan');
    }
    const done = await this.db.transaction(async (trx) => {
      // a double tap racing the check above waits here and gets the first booking
      if (input.clientRequestId) {
        await sql`select pg_advisory_xact_lock(hashtext(${'booking:' + user.userId + input.clientRequestId}))`.execute(
          trx,
        );
        const again = await trx
          .selectFrom('intercity_bookings')
          .select('id')
          .where('rider_id', '=', user.userId)
          .where('client_request_id', '=', input.clientRequestId)
          .executeTakeFirst();
        if (again) return { id: again.id, created: false };
      }
      const id = await this.reserve(trx, tripId, {
        ...input,
        riderId: user.userId,
        riderPhone: rider.phone,
        riderName: rider.full_name,
        channel: 'app',
        createdBy: user.userId,
        deposits,
      });
      return { id, created: true };
    });
    return { created: done.created, booking: await this.riderBooking(user, done.id) };
  }

  /**
   * An operator books seats for a caller without the app; the caller gets an SMS. The
   * panel's clientRequestId makes a double click one booking (201, then 200 with it).
   * No deposit: the operator vouches for the caller.
   */
  async bookByPhone(operator: AuthUser, tripId: string, input: PhoneBookInput) {
    const repeat = (db: Db) =>
      input.clientRequestId
        ? db
            .selectFrom('intercity_bookings')
            .select('id')
            .where('created_by', '=', operator.userId)
            .where('channel', '=', 'phone')
            .where('client_request_id', '=', input.clientRequestId)
            .executeTakeFirst()
        : Promise.resolve(undefined);
    const existing = await repeat(this.db.kysely);
    if (existing) return { created: false, booking: await this.adminBooking(existing.id) };
    const done = await this.db.transaction(async (trx) => {
      if (input.clientRequestId) {
        await sql`select pg_advisory_xact_lock(hashtext(${'booking:' + operator.userId + input.clientRequestId}))`.execute(
          trx,
        );
        const again = await repeat(trx);
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
      const id = await this.reserve(trx, tripId, {
        ...input,
        riderId: rider.id,
        riderName: input.riderName ?? rider.full_name,
        channel: 'phone',
        createdBy: operator.userId,
        deposits: null,
      });
      return { id, created: true };
    });
    return { created: done.created, booking: await this.adminBooking(done.id) };
  }

  /**
   * Takes the seats under the trip's row lock: the seat count and the front seat are
   * checked and updated in the same transaction, and the table's checks refuse an oversold
   * trip whatever happens here.
   */
  private async reserve(
    trx: Tx,
    tripId: string,
    b: BookInput & {
      riderId: string;
      riderPhone: string;
      riderName: string | null;
      channel: 'app' | 'phone';
      createdBy: string;
      /** Deposit rules for app bookings; null: no deposit (operators' bookings). */
      deposits: BookingRules | null;
    },
  ): Promise<string> {
    if (b.seats > MAX_TRIP_SEATS) {
      throw new BadRequestException(
        'Bir mashinaga ko‘pi bilan 3 yo‘lovchi: oldinda 1, orqada 2 kishi',
      );
    }
    const trip = await this.lockTrip(trx, tripId);
    const now = new Date();
    if (!OPEN_TRIP.includes(trip.status) || trip.departure_at <= now) {
      throw new ConflictException('Bu qatnovga bron yopilgan');
    }
    if (trip.driver_id === b.riderId) {
      throw new ConflictException('O‘z qatnovingizga joy band qilolmaysiz');
    }
    const free = trip.seats_total - trip.seats_booked;
    if (b.seats > free) {
      throw new ConflictException(
        free > 0 ? msg('Faqat {0} ta joy qoldi', free) : 'Bo‘sh joy qolmadi',
      );
    }
    if (b.front && (!trip.front_seat || trip.front_booked)) {
      throw new ConflictException('Old o‘rindiq band yoki taklif qilinmagan');
    }
    const already = await trx
      .selectFrom('intercity_bookings')
      .select('number')
      .where('trip_id', '=', trip.id)
      .where('rider_id', '=', b.riderId)
      .where('status', 'in', HOLDING)
      .executeTakeFirst();
    if (already) {
      throw new ConflictException(msg('Bu qatnovda broningiz bor: #{0}', already.number));
    }
    let prices: SeatPrices = { rear: trip.price_rear, front: trip.price_front };
    const part = await this.partOf(trx, trip, b.from ?? null, b.to ?? null);
    if (part) prices = partSeatPrices(prices, part.share);
    const price = bookingPrice(b.seats, b.front, prices);
    const deposit = b.deposits ? depositAmount(price, b.deposits) : 0;
    const status: BookingStatus = deposit > 0 ? 'awaiting_payment' : 'booked';
    const id = uuidv7();
    await trx
      .insertInto('intercity_bookings')
      .values({
        id,
        trip_id: trip.id,
        rider_id: b.riderId,
        rider_phone: b.riderPhone,
        rider_name: b.riderName,
        channel: b.channel,
        created_by: b.createdBy,
        client_request_id: b.clientRequestId,
        seats: b.seats,
        front: b.front,
        price,
        deposit_amount: deposit,
        status,
        pickup_note: b.pickupNote,
        pickup_point_id: part?.pickup.id ?? null,
        dropoff_point_id: part?.dropoff.id ?? null,
        updated_at: now,
      })
      .execute();
    if (deposit > 0) {
      // the seats are held while the rider pays, never past departure
      const window = new Date(now.getTime() + b.deposits!.payment_minutes * 60_000);
      await this.intents.createForBooking(trx, {
        id,
        riderId: b.riderId,
        amount: deposit,
        expiresAt: window < trip.departure_at ? window : trip.departure_at,
      });
    }
    await trx
      .updateTable('intercity_trips')
      .set((eb) => ({
        seats_booked: eb('seats_booked', '+', b.seats),
        ...(b.front ? { front_booked: true } : {}),
        updated_at: now,
      }))
      .where('id', '=', trip.id)
      .execute();
    await emit(trx, 'intercity.booking_changed', {
      bookingId: id,
      tripId: trip.id,
      status,
      by: b.channel === 'phone' ? 'operator' : 'rider',
    });
    return id;
  }

  /**
   * The rider's part of a trip when they book between other towns it passes (along the
   * way); null for the whole trip. Refused when the trip does not pass their towns.
   */
  private async partOf(trx: Tx, trip: Trip, fromRef: string | null, toRef: string | null) {
    if (!fromRef && !toRef) return null;
    const [pickup, dropoff] = await Promise.all([
      fromRef ? this.point(fromRef, trx) : this.pointById(trip.from_point_id),
      toRef ? this.point(toRef, trx) : this.pointById(trip.to_point_id),
    ]);
    if (pickup.id === trip.from_point_id && dropoff.id === trip.to_point_id) return null;
    const [start, end, rules] = await Promise.all([
      this.pointById(trip.from_point_id),
      this.pointById(trip.to_point_id),
      this.settings.intercity(trx),
    ]);
    const share =
      pickup.id === dropoff.id
        ? null
        : alongTheWayShare(start, end, pickup, dropoff, rules.along_route_max_km);
    if (share === null) {
      throw new ConflictException(
        msg('Bu qatnov {0} → {1} yo‘lidan o‘tmaydi', pickup.name_uz, dropoff.name_uz),
      );
    }
    return { pickup, dropoff, share };
  }

  /**
   * The rider cancels: free until `free_cancel_minutes` before departure, later a share of
   * the price is owed (recorded). Not once the car has left or the rider is aboard.
   */
  /**
   * The rider cancels: free until `free_cancel_minutes` before departure (a deposit paid
   * goes back to the card), later a share of the price is owed (recorded) — or, with a
   * deposit, the deposit is kept as the driver's compensation instead. Not once the car has
   * left or the rider is aboard. A booking still waiting for its deposit is just dropped.
   */
  async cancelByRider(user: AuthUser, bookingId: string, reason: string | null, now = new Date()) {
    const rules = await this.settings.intercity();
    await this.db.transaction(async (trx) => {
      const seen = await this.findBooking(bookingId, trx);
      if (seen.rider_id !== user.userId) throw new NotFoundException('Bron topilmadi');
      await this.lockDeposits(trx, { bookingId });
      const trip = await this.lockTrip(trx, seen.trip_id);
      const b = await this.lockBooking(trx, bookingId, trip.id);
      if (b.status !== 'booked' && b.status !== 'awaiting_payment') {
        throw new ConflictException('Bu bronni bekor qilib bo‘lmaydi');
      }
      if (!OPEN_TRIP.includes(trip.status)) throw new ConflictException('Mashina jo‘nab ketgan');
      if (b.status === 'awaiting_payment') {
        await this.release(trx, trip, b, 'rider', reason, 0);
        await this.intents.onBookingCancelled(trx, b.id, { refund: true });
        return;
      }
      const late = isLate(trip.departure_at, rules, now);
      if (b.deposit_amount > 0) {
        await this.release(trx, trip, b, 'rider', reason, late ? b.deposit_amount : 0);
        await this.intents.onBookingCancelled(trx, b.id, { refund: !late });
        if (late) await this.creditDeposit(trx, trip, b, 'kech bekor qilingan bron');
        return;
      }
      const fee = lateCancelFee(b.price, trip.departure_at, rules, now);
      await this.release(trx, trip, b, 'rider', reason, fee);
    });
    return this.riderBooking(user, bookingId);
  }

  /** An operator cancels a booking: its deposit, if paid, goes back to the rider's card. */
  async cancelBookingByOperator(bookingId: string, reason: string) {
    await this.db.transaction(async (trx) => {
      const seen = await this.findBooking(bookingId, trx);
      await this.lockDeposits(trx, { bookingId });
      const trip = await this.lockTrip(trx, seen.trip_id);
      const b = await this.lockBooking(trx, bookingId, trip.id);
      if (!HOLDING.includes(b.status)) throw new ConflictException('Bu bron faol emas');
      if (!OPEN_TRIP.includes(trip.status)) throw new ConflictException('Mashina jo‘nab ketgan');
      await this.release(trx, trip, b, 'operator', reason, 0);
      await this.intents.onBookingCancelled(trx, b.id, { refund: true });
    });
    return this.adminBooking(bookingId);
  }

  /**
   * Bookings whose deposit was not paid in time are cancelled and their seats released
   * (the worker's housekeeping). Returns how many.
   */
  async expireUnpaidBookings(now = new Date(), limit = 100): Promise<number> {
    const due = await this.intents.dueBookingIntents(now, limit);
    let expired = 0;
    for (const bookingId of due) {
      const done = await this.db.transaction(async (trx) => {
        // another worker (or the payment itself) has it: leave it to them
        const intent = await trx
          .selectFrom('payment_intents')
          .select('id')
          .where('booking_id', '=', bookingId)
          .where('status', '=', 'pending')
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!intent) return false;
        const seen = await this.findBooking(bookingId, trx);
        const trip = await this.lockTrip(trx, seen.trip_id);
        const b = await this.lockBooking(trx, bookingId, trip.id);
        if (b.status !== 'awaiting_payment') return false;
        await this.release(trx, trip, b, 'system', 'Oldindan to‘lov vaqtida qilinmadi', 0);
        await this.intents.onBookingCancelled(trx, b.id, { refund: false, expired: true });
        return true;
      });
      if (done) expired++;
    }
    return expired;
  }

  /** Gives a cancelled booking's seats back to the trip. */
  private async release(
    trx: Tx,
    trip: Trip,
    b: Booking,
    by: 'rider' | 'operator' | 'system',
    reason: string | null,
    fee: number,
  ) {
    const now = new Date();
    await this.setBookingStatus(trx, b, 'cancelled', by, {
      cancelled_at: now,
      cancelled_by: by,
      cancel_reason: reason,
      cancellation_fee: fee,
    });
    await trx
      .updateTable('intercity_trips')
      .set((eb) => ({
        seats_booked: eb('seats_booked', '-', b.seats),
        ...(b.front ? { front_booked: false } : {}),
        updated_at: now,
      }))
      .where('id', '=', trip.id)
      .execute();
  }

  // Views --------------------------------------------------------------------------------

  /** A trip as riders browse it: no phone numbers until they have booked. */
  async publicTrip(trip: Trip, points?: Map<string, Point>) {
    const [from, to] = await Promise.all([
      points?.get(trip.from_point_id) ?? this.pointById(trip.from_point_id),
      points?.get(trip.to_point_id) ?? this.pointById(trip.to_point_id),
    ]);
    const driver = await this.db.kysely
      .selectFrom('drivers as d')
      .leftJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select([
        'd.full_name',
        'd.offers_received',
        'd.offers_accepted',
        'd.rides_cancelled',
        'd.rating_sum',
        'd.rating_count',
        'd.rides_completed',
        'd.photo_upload_id',
        'v.photo_upload_id as vehicle_photo',
      ])
      .where('d.user_id', '=', trip.driver_id)
      .executeTakeFirstOrThrow();
    const stars = priority({
      offersReceived: driver.offers_received,
      offersAccepted: driver.offers_accepted,
      ridesCancelled: driver.rides_cancelled,
      ratingSum: driver.rating_sum,
      ratingCount: driver.rating_count,
    }).stars;
    return {
      id: trip.id,
      number: trip.number,
      status: trip.status,
      from: pointView(from),
      to: pointView(to),
      departureAt: trip.departure_at,
      meetingPoint: trip.meeting_point,
      comment: trip.comment,
      class: trip.class,
      distanceM: trip.distance_m,
      seats: {
        total: trip.seats_total,
        free: trip.seats_total - trip.seats_booked,
        frontOffered: trip.front_seat,
        frontFree: trip.front_seat && !trip.front_booked,
      },
      price: { rear: trip.price_rear, front: trip.price_front },
      driver: {
        // the first name only, until a seat is booked
        name: driverGivenName(driver.full_name),
        rating: stars,
        ridesCompleted: driver.rides_completed,
        photoUrl: await this.uploads.readUrl(driver.photo_upload_id),
      },
      vehicle: {
        make: trip.vehicle.make,
        model: trip.vehicle.model,
        colour: trip.vehicle.colour,
        class: trip.vehicle.class,
        photoUrl: await this.uploads.readUrl(driver.vehicle_photo),
      },
    };
  }

  /**
   * Where a rider gets in and out of a trip: their towns' meeting points for a seat along the
   * way ("Sirdaryo markazi, bozor yonida"), with about when the car passes (departure + the
   * share of the driving time, to 5 min), else the trip's own meeting point at departure.
   * `partDistanceM`: the rider's part of the trip's road metres.
   */
  private stops(
    trip: Trip,
    points: Map<string, Point>,
    fromId: string | null,
    toId: string | null,
  ) {
    const start = points.get(trip.from_point_id)!;
    const end = points.get(trip.to_point_id)!;
    const from = (fromId && points.get(fromId)) || start;
    const to = (toId && points.get(toId)) || end;
    const part = alongStops(
      {
        start,
        end,
        departureAt: trip.departure_at,
        distanceM: trip.distance_m,
        durationS: estimatedDurationS(trip.distance_m),
      },
      from,
      to,
    );
    return {
      boardingPoint: {
        name: from.name_uz,
        meetingPoint: from.id === start.id ? trip.meeting_point : from.meeting_point,
        estimatedAt: from.id === start.id ? trip.departure_at : part.boardingAt,
      },
      alightingPoint: { name: to.name_uz, meetingPoint: to.meeting_point },
      partDistanceM: part.partDistanceM,
    };
  }

  private bookingBase(b: Booking, points: Map<string, Point>, trip: Trip) {
    const town = (id: string | null) => {
      const p = id ? points.get(id) : undefined;
      return p ? { id: p.id, slug: p.slug, nameUz: p.name_uz, nameRu: p.name_ru } : null;
    };
    return {
      id: b.id,
      number: b.number,
      tripId: b.trip_id,
      status: b.status,
      channel: b.channel,
      seats: b.seats,
      front: b.front,
      price: b.price,
      // paid by card in advance (held by the platform, the driver's once the trip is done);
      // the rest, payCash, is paid to the driver in cash
      depositAmount: b.deposit_amount,
      payCash: b.price - b.deposit_amount,
      // a seat along the way: where the driver picks the rider up and drops them off
      alongTheWay: b.pickup_point_id !== null,
      pickup: town(b.pickup_point_id),
      dropoff: town(b.dropoff_point_id),
      // where and about when the rider gets in and out, and how far they ride
      ...this.stops(trip, points, b.pickup_point_id, b.dropoff_point_id),
      pickupNote: b.pickup_note,
      cancelledBy: b.cancelled_by,
      cancelReason: b.cancel_reason,
      cancellationFee: b.cancellation_fee,
      createdAt: b.created_at,
      boardedAt: b.boarded_at,
      completedAt: b.completed_at,
      cancelledAt: b.cancelled_at,
    };
  }

  /** The rider's booking: once booked, the driver's name, phone and the plate are theirs. */
  async riderBooking(user: AuthUser, bookingId: string) {
    const b = await this.findBooking(bookingId);
    if (b.rider_id !== user.userId) throw new NotFoundException('Bron topilmadi');
    const trip = await this.findTrip(b.trip_id);
    const contact = await this.db.kysely
      .selectFrom('drivers as d')
      .innerJoin('users as u', 'u.id', 'd.user_id')
      .select(['d.full_name', 'u.phone'])
      .where('d.user_id', '=', trip.driver_id)
      .executeTakeFirstOrThrow();
    const active = LIVE_BOOKING.includes(b.status) || b.status === 'completed';
    const [rules, points, payment] = await Promise.all([
      this.settings.intercity(),
      this.allPoints(),
      b.deposit_amount > 0 ? this.intents.forBooking(b.id) : null,
    ]);
    const canCancel =
      (b.status === 'booked' || b.status === 'awaiting_payment') && OPEN_TRIP.includes(trip.status);
    const now = new Date();
    // with a deposit, a late cancellation keeps the deposit instead of the recorded fee
    const feeNow =
      b.status !== 'booked'
        ? 0
        : b.deposit_amount > 0
          ? isLate(trip.departure_at, rules, now)
            ? b.deposit_amount
            : 0
          : lateCancelFee(b.price, trip.departure_at, rules, now);
    return {
      ...this.bookingBase(b, points, trip),
      // the deposit's card payment: checkout links while it waits, refund status later
      payment,
      // the cancellation rules this booking is under: free until then, later a share is owed
      cancelRules: {
        freeCancelMinutes: rules.free_cancel_minutes,
        lateCancelFeePercent: rules.late_cancel_fee_percent,
      },
      cancelFreeUntil: new Date(trip.departure_at.getTime() - rules.free_cancel_minutes * 60_000),
      cancelFeeNow: canCancel ? feeNow : 0,
      trip: await this.publicTrip(trip, points),
      contact: active
        ? {
            driverName: contact.full_name,
            driverPhone: contact.phone,
            plate: trip.vehicle.plate,
            plateFormatted: formatPlate(trip.vehicle.plate),
          }
        : null,
      canCancel,
    };
  }

  async riderBookings(user: AuthUser, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('intercity_bookings')
      .select('id')
      .where('rider_id', '=', user.userId)
      .$if(Boolean(cursor), (q) => q.where('id', '<', cursor!))
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return {
      items: await Promise.all(rows.map((r) => this.riderBooking(user, r.id))),
      nextCursor: rows.length === 30 ? rows.at(-1)!.id : null,
    };
  }

  /** The driver's trip with the passenger list (names, phones, seats, pickup notes). */
  async driverTrip(user: AuthUser, tripId: string) {
    const trip = await this.findTrip(tripId);
    if (trip.driver_id !== user.userId) throw new NotFoundException('Qatnov topilmadi');
    return this.fullTrip(trip);
  }

  /**
   * The driver's trips by departure: `upcoming` = not yet arrived or cancelled, soonest
   * first (all of them); otherwise every trip, latest departure first, paged by `cursor`
   * (the last trip id seen).
   */
  async driverTrips(user: AuthUser, cursor?: string, scope: 'all' | 'upcoming' = 'all') {
    if (scope === 'upcoming') {
      const rows = await this.db.kysely
        .selectFrom('intercity_trips')
        .selectAll()
        .where('driver_id', '=', user.userId)
        .where('status', 'in', ['scheduled', 'boarding', 'departed'])
        .orderBy('departure_at')
        .orderBy('id')
        .limit(100)
        .execute();
      return { items: await Promise.all(rows.map((t) => this.fullTrip(t))), nextCursor: null };
    }
    const after = cursor
      ? await this.db.kysely
          .selectFrom('intercity_trips')
          .select(['id', 'departure_at'])
          .where('id', '=', cursor)
          .where('driver_id', '=', user.userId)
          .executeTakeFirst()
      : undefined;
    const rows = await this.db.kysely
      .selectFrom('intercity_trips')
      .selectAll()
      .where('driver_id', '=', user.userId)
      .$if(Boolean(after), (q) =>
        q.where(sql<boolean>`(departure_at, id) < (${after!.departure_at}, ${after!.id}::uuid)`),
      )
      .orderBy('departure_at', 'desc')
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return {
      items: await Promise.all(rows.map((t) => this.fullTrip(t))),
      nextCursor: rows.length === 30 ? rows.at(-1)!.id : null,
    };
  }

  /**
   * The driver changes a published trip (time, seats, price, front seat, meeting point,
   * comment) while nobody has booked it: riders who booked rely on what they saw. The same
   * rules as publishing apply (time window, spacing, the car's seats, the price band).
   */
  async editTrip(user: AuthUser, tripId: string, input: EditTripInput, now = new Date()) {
    const rules = await this.settings.intercity();
    const car = await this.db.kysely
      .selectFrom('vehicles')
      .select(['seats'])
      .where('driver_id', '=', user.userId)
      .executeTakeFirst();
    await this.db.transaction(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'intercity:' + user.userId}))`.execute(trx);
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (trip.status !== 'scheduled') throw this.wrongStatus(trip.status);
      const booked = await trx
        .selectFrom('intercity_bookings')
        .select('id')
        .where('trip_id', '=', trip.id)
        .where('status', 'in', HOLDING)
        .executeTakeFirst();
      if (booked || trip.seats_booked > 0) {
        throw new ConflictException(
          'Qatnovga bron bor: o‘zgartirib bo‘lmaydi (bekor qilish mumkin)',
        );
      }
      const departureAt = input.departureAt ?? trip.departure_at;
      if (input.departureAt) {
        const minutesAhead = (departureAt.getTime() - now.getTime()) / 60_000;
        if (minutesAhead < rules.publish_min_minutes_ahead) {
          throw new BadRequestException(
            msg(
              'Jo‘nash vaqti kamida {0} daqiqadan keyin bo‘lsin',
              rules.publish_min_minutes_ahead,
            ),
          );
        }
        if (minutesAhead > rules.publish_max_days_ahead * 1440) {
          throw new BadRequestException(
            msg('Qatnovni {0} kundan uzoqqa e’lon qilib bo‘lmaydi', rules.publish_max_days_ahead),
          );
        }
        const spacing = TRIP_SPACING_HOURS * 3_600_000;
        const clash = await trx
          .selectFrom('intercity_trips')
          .select('number')
          .where('driver_id', '=', user.userId)
          .where('id', '!=', trip.id)
          .where('status', 'in', ['scheduled', 'boarding', 'departed'])
          .where('departure_at', '>', new Date(departureAt.getTime() - spacing))
          .where('departure_at', '<', new Date(departureAt.getTime() + spacing))
          .executeTakeFirst();
        if (clash) {
          throw new ConflictException(msg('Shu vaqtga yaqin qatnovingiz bor: #{0}', clash.number));
        }
      }
      // the seating rule on what the trip would offer (trips published before it included)
      const seating = seatingError(
        input.seats ?? trip.seats_total,
        input.frontSeat ?? trip.front_seat,
      );
      if (seating) throw new BadRequestException(seating);
      if (input.seats !== undefined && car && input.seats > car.seats) {
        throw new BadRequestException(msg('Avtomobilda {0} ta yo‘lovchi o‘rni bor', car.seats));
      }
      let prices: SeatPrices | null = null;
      if (input.priceRear !== undefined) {
        const fare = await this.fare(trip.from_point_id, trip.to_point_id, trip.class);
        const rear = input.priceRear ?? fare.reference.rear;
        if (rear < fare.band.min || rear > fare.band.max || rear % 100 !== 0) {
          throw new UnprocessableEntityException({
            message: msg(
              'Narx {0}–{1} so‘m oralig‘ida, 100 so‘mga karrali bo‘lsin',
              fare.band.min,
              fare.band.max,
            ).message,
            band: fare.band,
            reference: fare.reference,
          });
        }
        prices = driverSeatPrices(fare.reference, rear);
      }
      await trx
        .updateTable('intercity_trips')
        .set({
          departure_at: departureAt,
          ...(input.seats !== undefined ? { seats_total: input.seats } : {}),
          ...(input.frontSeat !== undefined ? { front_seat: input.frontSeat } : {}),
          ...(prices ? { price_rear: prices.rear, price_front: prices.front } : {}),
          ...(input.meetingPoint !== undefined
            ? {
                meeting_point:
                  input.meetingPoint ?? (await this.pointById(trip.from_point_id)).meeting_point,
              }
            : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          updated_at: now,
        })
        .where('id', '=', trip.id)
        .execute();
      await emit(trx, 'intercity.trip_changed', {
        tripId: trip.id,
        from: trip.status,
        to: trip.status,
        edited: true,
      });
    });
    return this.driverTrip(user, tripId);
  }

  async adminTrip(tripId: string) {
    return this.fullTrip(await this.findTrip(tripId));
  }

  async adminTrips(q: { status?: TripStatus; date?: string; from?: string; to?: string }) {
    const day = q.date ? new Date(`${q.date}T00:00:00+05:00`) : null;
    const [from, to] = await Promise.all([
      q.from ? this.point(q.from) : null,
      q.to ? this.point(q.to) : null,
    ]);
    const rows = await this.db.kysely
      .selectFrom('intercity_trips')
      .selectAll()
      .$if(Boolean(q.status), (x) => x.where('status', '=', q.status!))
      .$if(Boolean(day), (x) =>
        x
          .where('departure_at', '>=', day!)
          .where('departure_at', '<', new Date(day!.getTime() + 86_400_000)),
      )
      .$if(Boolean(from), (x) => x.where('from_point_id', '=', from!.id))
      .$if(Boolean(to), (x) => x.where('to_point_id', '=', to!.id))
      .orderBy('departure_at', 'desc')
      .limit(200)
      .execute();
    return Promise.all(rows.map((t) => this.fullTrip(t)));
  }

  async adminBooking(bookingId: string) {
    const b = await this.findBooking(bookingId);
    const [points, payment, trip] = await Promise.all([
      this.allPoints(),
      b.deposit_amount > 0 ? this.intents.forBooking(b.id) : null,
      this.findTrip(b.trip_id),
    ]);
    return {
      ...this.bookingBase(b, points, trip),
      payment,
      riderId: b.rider_id,
      riderPhone: b.rider_phone,
      riderName: b.rider_name,
    };
  }

  private async fullTrip(trip: Trip) {
    const points = await this.allPoints();
    const [base, bookings, driver] = await Promise.all([
      this.publicTrip(trip, points),
      this.db.kysely
        .selectFrom('intercity_bookings')
        .selectAll()
        .where('trip_id', '=', trip.id)
        .orderBy('created_at')
        .execute(),
      this.db.kysely
        .selectFrom('drivers as d')
        .innerJoin('users as u', 'u.id', 'd.user_id')
        .select(['d.user_id', 'd.full_name', 'u.phone'])
        .where('d.user_id', '=', trip.driver_id)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      ...base,
      driver: { ...base.driver, id: driver.user_id, name: driver.full_name, phone: driver.phone },
      vehicle: {
        ...base.vehicle,
        plate: trip.vehicle.plate,
        plateFormatted: formatPlate(trip.vehicle.plate),
      },
      referenceRear: trip.reference_rear,
      cancelledBy: trip.cancelled_by,
      cancelReason: trip.cancel_reason,
      boardingAt: trip.boarding_at,
      departedAt: trip.departed_at,
      arrivedAt: trip.arrived_at,
      cancelledAt: trip.cancelled_at,
      bookings: bookings.map((b) => ({
        ...this.bookingBase(b, points, trip),
        riderId: b.rider_id,
        riderName: b.rider_name,
        riderPhone: b.rider_phone,
        commission: b.commission,
        tax: b.tax,
      })),
    };
  }

  // Operators: route prices -----------------------------------------------------------------

  async routePrices() {
    return this.db.kysely
      .selectFrom('intercity_fares as f')
      .innerJoin('intercity_points as a', 'a.id', 'f.from_point_id')
      .innerJoin('intercity_points as b', 'b.id', 'f.to_point_id')
      .select([
        'a.slug as from',
        'b.slug as to',
        'f.price_rear as rear',
        'f.price_front as front',
        'f.updated_at as updatedAt',
      ])
      .orderBy('a.slug')
      .orderBy('b.slug')
      .execute();
  }

  /** Sets (or with null prices removes) a route's seat prices; new trips use them. */
  async setRoutePrice(fromRef: string, toRef: string, prices: SeatPrices | null) {
    const [from, to] = await Promise.all([this.point(fromRef), this.point(toRef)]);
    if (from.id === to.id) throw new BadRequestException('Jo‘nash va borish shahri bir xil');
    if (!prices) {
      await this.db.kysely
        .deleteFrom('intercity_fares')
        .where('from_point_id', '=', from.id)
        .where('to_point_id', '=', to.id)
        .execute();
    } else {
      if (prices.front < prices.rear) {
        throw new BadRequestException('Old o‘rindiq orqadagidan arzon bo‘lmasin');
      }
      const values = { price_rear: prices.rear, price_front: prices.front, updated_at: new Date() };
      await this.db.kysely
        .insertInto('intercity_fares')
        .values({ from_point_id: from.id, to_point_id: to.id, ...values })
        .onConflict((oc) => oc.columns(['from_point_id', 'to_point_id']).doUpdateSet(values))
        .execute();
    }
    return this.fare(from.id, to.id);
  }

  // Shared ----------------------------------------------------------------------------------

  private async setTripStatus(
    trx: Tx,
    trip: Trip,
    to: TripStatus,
    set: Partial<{
      boarding_at: Date;
      departed_at: Date;
      arrived_at: Date;
      cancelled_at: Date;
      cancelled_by: 'driver' | 'operator';
      cancel_reason: string;
      seats_booked: number;
      front_booked: boolean;
    }>,
  ) {
    await trx
      .updateTable('intercity_trips')
      .set({ ...set, status: to, updated_at: new Date() })
      .where('id', '=', trip.id)
      .execute();
    await emit(trx, 'intercity.trip_changed', { tripId: trip.id, from: trip.status, to });
  }

  private async setBookingStatus(
    trx: Tx,
    b: Booking,
    to: BookingStatus,
    by: 'rider' | 'driver' | 'operator' | 'system',
    set: Partial<{
      boarded_at: Date;
      completed_at: Date;
      cancelled_at: Date;
      cancelled_by: 'rider' | 'driver' | 'operator' | 'system';
      cancel_reason: string | null;
      cancellation_fee: number;
    }>,
  ) {
    await trx
      .updateTable('intercity_bookings')
      .set({ ...set, status: to, updated_at: new Date() })
      .where('id', '=', b.id)
      .execute();
    await emit(trx, 'intercity.booking_changed', {
      bookingId: b.id,
      tripId: b.trip_id,
      status: to,
      by,
    });
  }

  private liveBookings(trx: Tx, tripId: string, statuses: BookingStatus[] = LIVE_BOOKING) {
    return trx
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where('status', 'in', statuses)
      .orderBy('created_at')
      .forUpdate()
      .execute();
  }

  /**
   * Locks the deposit payment intents of a booking or of every booking of a trip, before the
   * trip and its bookings: the payment callbacks lock an intent, then its booking, so this
   * keeps one lock order.
   */
  private async lockDeposits(trx: Tx, of: { bookingId: string } | { tripId: string }) {
    await trx
      .selectFrom('payment_intents')
      .select('id')
      .$if('bookingId' in of, (q) =>
        q.where('booking_id', '=', (of as { bookingId: string }).bookingId),
      )
      .$if('tripId' in of, (q) =>
        q.where(
          'booking_id',
          'in',
          trx
            .selectFrom('intercity_bookings')
            .select('id')
            .where('trip_id', '=', (of as { tripId: string }).tripId),
        ),
      )
      .orderBy('id')
      .forUpdate()
      .execute();
  }

  /**
   * A deposit the platform held becomes the driver's (the trip was made, the rider did not
   * come or cancelled late): credited to the balance once per booking (unique ledger index).
   */
  private async creditDeposit(trx: Tx, trip: Trip, b: Booking, why: string) {
    if (b.deposit_amount <= 0) return;
    await this.ledger.post(trx, {
      driverId: trip.driver_id,
      kind: 'deposit',
      amount: b.deposit_amount,
      bookingId: b.id,
      note: `Oldindan to‘lov — shaharlararo bron #${b.number} (${why})`,
    });
  }

  private async lockTrip(trx: Tx, tripId: string): Promise<Trip> {
    const trip = await trx
      .selectFrom('intercity_trips')
      .selectAll()
      .where('id', '=', tripId)
      .forUpdate()
      .executeTakeFirst();
    if (!trip) throw new NotFoundException('Qatnov topilmadi');
    return trip;
  }

  private async lockOwnTrip(trx: Tx, user: AuthUser, tripId: string): Promise<Trip> {
    const trip = await this.lockTrip(trx, tripId);
    if (trip.driver_id !== user.userId) throw new NotFoundException('Qatnov topilmadi');
    return trip;
  }

  /** Locks a booking; always after its trip where both are locked (one lock order). */
  private async lockBooking(trx: Tx, bookingId: string, tripId?: string): Promise<Booking> {
    const b = await trx
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('id', '=', bookingId)
      .$if(Boolean(tripId), (q) => q.where('trip_id', '=', tripId!))
      .forUpdate()
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Bron topilmadi');
    return b;
  }

  private async findTrip(tripId: string): Promise<Trip> {
    const trip = await this.db.kysely
      .selectFrom('intercity_trips')
      .selectAll()
      .where('id', '=', tripId)
      .executeTakeFirst();
    if (!trip) throw new NotFoundException('Qatnov topilmadi');
    return trip;
  }

  private async findBooking(bookingId: string, db: Db = this.db.kysely): Promise<Booking> {
    const b = await db
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('id', '=', bookingId)
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Bron topilmadi');
    return b;
  }

  /** Every town by id (a dozen rows), for views naming several. */
  private async allPoints(): Promise<Map<string, Point>> {
    const rows = await this.db.kysely.selectFrom('intercity_points').selectAll().execute();
    return new Map(rows.map((p) => [p.id, p]));
  }

  private pointById(id: string) {
    return this.db.kysely
      .selectFrom('intercity_points')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  private wrongStatus(status: TripStatus) {
    return new ConflictException(msg('Qatnov holati mos emas: {0}', status));
  }
}

/** Whether a rider cancelling now is past the free window (`free_cancel_minutes` before). */
export function isLate(
  departureAt: Date,
  rules: Pick<IntercityRules, 'free_cancel_minutes'>,
  now: Date,
): boolean {
  return departureAt.getTime() - now.getTime() < rules.free_cancel_minutes * 60_000;
}

/** A rider's cancellation fee now: free until `free_cancel_minutes` before departure. */
export function lateCancelFee(
  price: number,
  departureAt: Date,
  rules: Pick<IntercityRules, 'free_cancel_minutes' | 'late_cancel_fee_percent'>,
  now: Date,
): number {
  return isLate(departureAt, rules, now)
    ? Math.round((price * rules.late_cancel_fee_percent) / 100 / 100) * 100
    : 0;
}

export function pointView(p: Point) {
  return {
    id: p.id,
    slug: p.slug,
    nameUz: p.name_uz,
    nameRu: p.name_ru,
    lat: p.lat,
    lng: p.lng,
    meetingPoint: p.meeting_point,
  };
}
