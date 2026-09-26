import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { Database } from '../../core/db/database.js';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { formatPlate } from '../../lib/driver-rules.js';
import { intercityPush, intercitySms, type TripText } from './intercity-messages.js';
import { Notifier } from './notifier.js';

/**
 * Who hears about the trip board when their app may be closed:
 * - drivers: a seat was booked or a booking cancelled;
 * - riders: boarding started (where to come), the trip was cancelled; riders booked by an
 *   operator get the booking, boarding and cancellation by SMS.
 */
@Injectable()
export class IntercityNotificationsHandler implements OutboxHandler {
  readonly name = 'intercity-notifications';

  constructor(
    private readonly db: Database,
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  handles(topic: string): boolean {
    return topic === 'intercity.booking_changed' || topic === 'intercity.trip_changed';
  }

  async handle(event: OutboxEvent): Promise<void> {
    const key = `event:${event.id}`;
    const p = event.payload;
    const trip = await this.trip(String(p.tripId));
    if (!trip) return;
    if (event.topic === 'intercity.booking_changed') {
      return this.bookingChanged(key, trip, String(p.bookingId), String(p.status), String(p.by));
    }
    return this.tripChanged(key, trip, String(p.to));
  }

  private async bookingChanged(
    key: string,
    trip: NonNullable<Awaited<ReturnType<IntercityNotificationsHandler['trip']>>>,
    bookingId: string,
    status: string,
    by: string,
  ) {
    const b = await this.db.kysely
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('id', '=', bookingId)
      .executeTakeFirst();
    if (!b) return;
    const text = trip.text;
    if (status === 'booked') {
      await this.notifier.push({
        key,
        kind: 'intercity_booked',
        rideId: null,
        userId: trip.driverId,
        app: 'driver',
        text: (l) => intercityPush.newBooking(l, text, b.seats, b.price),
        data: { tripId: trip.id, bookingId: b.id },
      });
      if (b.channel === 'phone' && this.env.NOTIFY_SMS_PHONE_ORDERS) {
        await this.notifier.sms({
          key,
          kind: 'intercity_booked',
          rideId: null,
          userId: b.rider_id,
          phone: b.rider_phone,
          text: intercitySms.booked(b.number, text, b.seats, b.price, trip.driverPhone, trip.car),
        });
      }
      return;
    }
    // a rider or an operator gave seats back: the driver's list changed
    if (
      status === 'cancelled' &&
      (by === 'rider' || by === 'operator') &&
      trip.status !== 'cancelled'
    ) {
      await this.notifier.push({
        key,
        kind: 'intercity_booking_cancelled',
        rideId: null,
        userId: trip.driverId,
        app: 'driver',
        text: (l) => intercityPush.bookingCancelled(l, text, b.seats),
        data: { tripId: trip.id, bookingId: b.id },
      });
    }
  }

  private async tripChanged(
    key: string,
    trip: NonNullable<Awaited<ReturnType<IntercityNotificationsHandler['trip']>>>,
    to: string,
  ) {
    if (to !== 'boarding' && to !== 'cancelled') return;
    const bookings = await this.db.kysely
      .selectFrom('intercity_bookings')
      .selectAll()
      .where('trip_id', '=', trip.id)
      .$if(to === 'boarding', (q) => q.where('status', '=', 'booked'))
      .$if(to === 'cancelled', (q) =>
        q.where('status', '=', 'cancelled').where('cancelled_by', 'in', ['driver', 'operator']),
      )
      .execute();
    for (const b of bookings) {
      await this.notifier.push({
        key,
        kind: `intercity_${to}`,
        rideId: null,
        userId: b.rider_id,
        app: 'rider',
        text: (l) =>
          to === 'boarding'
            ? intercityPush.boarding(l, trip.text)
            : intercityPush.tripCancelled(l, trip.text, trip.cancelReason),
        data: { tripId: trip.id, bookingId: b.id },
      });
      if (b.channel === 'phone' && this.env.NOTIFY_SMS_PHONE_ORDERS) {
        await this.notifier.sms({
          key,
          kind: `intercity_${to}`,
          rideId: null,
          userId: b.rider_id,
          phone: b.rider_phone,
          text:
            to === 'boarding'
              ? intercitySms.boarding(b.number, trip.text)
              : intercitySms.cancelled(b.number, trip.text, trip.cancelReason),
        });
      }
    }
  }

  private async trip(tripId: string) {
    const t = await this.db.kysely
      .selectFrom('intercity_trips as t')
      .innerJoin('intercity_points as a', 'a.id', 't.from_point_id')
      .innerJoin('intercity_points as b', 'b.id', 't.to_point_id')
      .innerJoin('users as u', 'u.id', 't.driver_id')
      .select([
        't.id',
        't.number',
        't.status',
        't.driver_id',
        't.departure_at',
        't.meeting_point',
        't.vehicle',
        't.cancel_reason',
        'a.name_uz as from',
        'b.name_uz as to',
        'u.phone as driver_phone',
      ])
      .where('t.id', '=', tripId)
      .executeTakeFirst();
    if (!t) return null;
    const text: TripText = {
      number: t.number,
      from: t.from,
      to: t.to,
      departureAt: t.departure_at,
      meetingPoint: t.meeting_point,
    };
    return {
      id: t.id,
      status: t.status,
      driverId: t.driver_id,
      driverPhone: t.driver_phone,
      cancelReason: t.cancel_reason,
      car: `${t.vehicle.colour} ${t.vehicle.make} ${t.vehicle.model}, ${formatPlate(t.vehicle.plate)}`,
      text,
    };
  }
}
