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
import { formatPlate, tashkentDate } from '../../lib/driver-rules.js';
import {
  bookingPrice,
  driverSeatPrices,
  priceBand,
  referenceSeatPrices,
  type SeatPrices,
} from '../../lib/intercity.js';
import { priority } from '../../lib/priority.js';
import type { RideClass } from '../../lib/tariff.js';
import { RideChargesService } from '../billing/charges.service.js';
import { LedgerService } from '../billing/ledger.service.js';
import { RoutingService } from '../geo/routing.service.js';
import { SettingsService } from '../settings/settings.module.js';
import { UploadsService } from '../uploads/uploads.service.js';

type Db = Tx | Database['kysely'];
type Trip = Selectable<IntercityTripsTable>;
type Booking = Selectable<IntercityBookingsTable>;
type Point = Selectable<IntercityPointsTable>;

/** Trips of one driver must be this far apart (a round trip Guliston-Tashkent is ~4 h). */
const TRIP_SPACING_HOURS = 2;
const OPEN_TRIP: TripStatus[] = ['scheduled', 'boarding'];
const LIVE_BOOKING: BookingStatus[] = ['booked', 'boarded'];

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

export interface BookInput {
  seats: number;
  front: boolean;
  pickupNote: string | null;
  clientRequestId: string | null;
}

export interface PhoneBookInput extends Omit<BookInput, 'clientRequestId'> {
  riderPhone: string;
  riderName: string | null;
}

/**
 * The intercity trip board (market analysis §6.4): drivers publish departures between towns
 * with fixed seat prices, riders (or operators for callers) book seats, the driver boards,
 * departs and arrives. Seats are counted on the trip row under its lock, backed by checks:
 * however many riders tap "book" at once, a trip is never oversold and the front seat is
 * sold once. Seats are paid in cash to the driver; each completed booking is charged the
 * 1% tax and the intercity commission like a ride.
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
      ])
      .where('d.user_id', '=', user.userId)
      .executeTakeFirst();
    if (!driver) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
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
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (trip.status !== 'boarding') throw this.wrongStatus(trip.status);
      const bookings = await this.liveBookings(trx, trip.id);
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
      }
      await this.setTripStatus(trx, trip, 'departed', { departed_at: new Date() });
    });
    return this.driverTrip(user, tripId);
  }

  /** Arrived: every passenger aboard paid in cash; each booking's tax and commission are charged. */
  async arrive(user: AuthUser, tripId: string) {
    await this.db.transaction(async (trx) => {
      const trip = await this.lockOwnTrip(trx, user, tripId);
      if (trip.status !== 'departed') throw this.wrongStatus(trip.status);
      const now = new Date();
      for (const b of await this.liveBookings(trx, trip.id)) {
        await this.setBookingStatus(trx, b, 'completed', 'driver', { completed_at: now });
        await emit(trx, 'fiscal.receipt_due', { bookingId: b.id });
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
      const trip = await this.lockOwnTrip(trx, user, tripId);
      await this.cancelTrip(trx, trip, 'driver', reason);
    });
    return this.driverTrip(user, tripId);
  }

  async cancelByOperator(tripId: string, reason: string) {
    await this.db.transaction(async (trx) => {
      const trip = await this.lockTrip(trx, tripId);
      await this.cancelTrip(trx, trip, 'operator', reason);
    });
    return this.adminTrip(tripId);
  }

  private async cancelTrip(trx: Tx, trip: Trip, by: 'driver' | 'operator', reason: string) {
    if (!OPEN_TRIP.includes(trip.status)) throw this.wrongStatus(trip.status);
    const bookings = await this.liveBookings(trx, trip.id);
    for (const b of bookings) {
      await this.setBookingStatus(trx, b, 'cancelled', by, {
        cancelled_at: new Date(),
        cancelled_by: by,
        cancel_reason: reason,
      });
    }
    if (by === 'driver' && bookings.length) {
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

  /** Open departures of a route on a Tashkent date (today: from now on), soonest first. */
  async search(q: { from: string; to: string; date?: string; seats: number }, now = new Date()) {
    const [from, to] = await Promise.all([this.point(q.from), this.point(q.to)]);
    const day = q.date ? new Date(`${q.date}T00:00:00+05:00`) : tashkentDayStart(now);
    const start = new Date(Math.max(day.getTime(), now.getTime()));
    const end = new Date(day.getTime() + 86_400_000);
    const rows = await this.db.kysely
      .selectFrom('intercity_trips')
      .selectAll()
      .where('from_point_id', '=', from.id)
      .where('to_point_id', '=', to.id)
      .where('status', 'in', OPEN_TRIP)
      .where('departure_at', '>=', start)
      .where('departure_at', '<', end)
      .where(sql<boolean>`seats_total - seats_booked >= ${q.seats}`)
      .orderBy('departure_at')
      .limit(100)
      .execute();
    const points = new Map([
      [from.id, from],
      [to.id, to],
    ]);
    return Promise.all(rows.map((t) => this.publicTrip(t, points)));
  }

  async trip(user: AuthUser, tripId: string) {
    const trip = await this.findTrip(tripId);
    const view = await this.publicTrip(trip);
    const mine = await this.db.kysely
      .selectFrom('intercity_bookings')
      .select('id')
      .where('trip_id', '=', trip.id)
      .where('rider_id', '=', user.userId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return { ...view, myBookingId: mine?.id ?? null };
  }

  /** Books seats; the same clientRequestId returns the same booking (safe retries). */
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
    const rider = await this.db.kysely
      .selectFrom('users')
      .select(['phone', 'full_name'])
      .where('id', '=', user.userId)
      .executeTakeFirstOrThrow();
    const id = await this.db.transaction((trx) =>
      this.reserve(trx, tripId, {
        ...input,
        riderId: user.userId,
        riderPhone: rider.phone,
        riderName: rider.full_name,
        channel: 'app',
        createdBy: user.userId,
      }),
    );
    return { created: true, booking: await this.riderBooking(user, id) };
  }

  /** An operator books seats for a caller without the app; the caller gets an SMS. */
  async bookByPhone(operator: AuthUser, tripId: string, input: PhoneBookInput) {
    const id = await this.db.transaction(async (trx) => {
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
      return this.reserve(trx, tripId, {
        ...input,
        clientRequestId: null,
        riderId: rider.id,
        riderName: input.riderName ?? rider.full_name,
        channel: 'phone',
        createdBy: operator.userId,
      });
    });
    return this.adminBooking(id);
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
    },
  ): Promise<string> {
    const trip = await this.lockTrip(trx, tripId);
    if (!OPEN_TRIP.includes(trip.status) || trip.departure_at <= new Date()) {
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
      .where('status', 'in', LIVE_BOOKING)
      .executeTakeFirst();
    if (already) {
      throw new ConflictException(msg('Bu qatnovda broningiz bor: #{0}', already.number));
    }
    const prices: SeatPrices = { rear: trip.price_rear, front: trip.price_front };
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
        price: bookingPrice(b.seats, b.front, prices),
        pickup_note: b.pickupNote,
        updated_at: new Date(),
      })
      .execute();
    await trx
      .updateTable('intercity_trips')
      .set((eb) => ({
        seats_booked: eb('seats_booked', '+', b.seats),
        ...(b.front ? { front_booked: true } : {}),
        updated_at: new Date(),
      }))
      .where('id', '=', trip.id)
      .execute();
    await emit(trx, 'intercity.booking_changed', {
      bookingId: id,
      tripId: trip.id,
      status: 'booked',
      by: b.channel === 'phone' ? 'operator' : 'rider',
    });
    return id;
  }

  /**
   * The rider cancels: free until `free_cancel_minutes` before departure, later a share of
   * the price is owed (recorded). Not once the car has left or the rider is aboard.
   */
  async cancelByRider(user: AuthUser, bookingId: string, reason: string | null, now = new Date()) {
    const rules = await this.settings.intercity();
    await this.db.transaction(async (trx) => {
      const b = await this.lockBooking(trx, bookingId);
      if (b.rider_id !== user.userId) throw new NotFoundException('Bron topilmadi');
      if (b.status !== 'booked') throw new ConflictException('Bu bronni bekor qilib bo‘lmaydi');
      const trip = await this.lockTrip(trx, b.trip_id);
      if (!OPEN_TRIP.includes(trip.status)) throw new ConflictException('Mashina jo‘nab ketgan');
      const late = trip.departure_at.getTime() - now.getTime() < rules.free_cancel_minutes * 60_000;
      const fee = late
        ? Math.round((b.price * rules.late_cancel_fee_percent) / 100 / 100) * 100
        : 0;
      await this.release(trx, trip, b, 'rider', reason, fee);
    });
    return this.riderBooking(user, bookingId);
  }

  async cancelBookingByOperator(bookingId: string, reason: string) {
    await this.db.transaction(async (trx) => {
      const b = await this.lockBooking(trx, bookingId);
      if (!LIVE_BOOKING.includes(b.status)) throw new ConflictException('Bu bron faol emas');
      const trip = await this.lockTrip(trx, b.trip_id);
      if (!OPEN_TRIP.includes(trip.status)) throw new ConflictException('Mashina jo‘nab ketgan');
      await this.release(trx, trip, b, 'operator', reason, 0);
    });
    return this.adminBooking(bookingId);
  }

  /** Gives a cancelled booking's seats back to the trip. */
  private async release(
    trx: Tx,
    trip: Trip,
    b: Booking,
    by: 'rider' | 'operator',
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
        name: driver.full_name.split(' ')[0],
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

  private bookingBase(b: Booking) {
    return {
      id: b.id,
      number: b.number,
      tripId: b.trip_id,
      status: b.status,
      channel: b.channel,
      seats: b.seats,
      front: b.front,
      price: b.price,
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
    return {
      ...this.bookingBase(b),
      trip: await this.publicTrip(trip),
      contact: active
        ? {
            driverName: contact.full_name,
            driverPhone: contact.phone,
            plate: trip.vehicle.plate,
            plateFormatted: formatPlate(trip.vehicle.plate),
          }
        : null,
      canCancel: b.status === 'booked' && OPEN_TRIP.includes(trip.status),
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

  async driverTrips(user: AuthUser, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('intercity_trips')
      .selectAll()
      .where('driver_id', '=', user.userId)
      .$if(Boolean(cursor), (q) => q.where('id', '<', cursor!))
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return {
      items: await Promise.all(rows.map((t) => this.fullTrip(t))),
      nextCursor: rows.length === 30 ? rows.at(-1)!.id : null,
    };
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
    return {
      ...this.bookingBase(b),
      riderId: b.rider_id,
      riderPhone: b.rider_phone,
      riderName: b.rider_name,
    };
  }

  private async fullTrip(trip: Trip) {
    const [base, bookings, driver] = await Promise.all([
      this.publicTrip(trip),
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
        ...this.bookingBase(b),
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
    by: 'rider' | 'driver' | 'operator',
    set: Partial<{
      boarded_at: Date;
      completed_at: Date;
      cancelled_at: Date;
      cancelled_by: 'rider' | 'driver' | 'operator';
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

  private liveBookings(trx: Tx, tripId: string) {
    return trx
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where('status', 'in', LIVE_BOOKING)
      .orderBy('created_at')
      .forUpdate()
      .execute();
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

  private async findBooking(bookingId: string): Promise<Booking> {
    const b = await this.db.kysely
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('id', '=', bookingId)
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Bron topilmadi');
    return b;
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
