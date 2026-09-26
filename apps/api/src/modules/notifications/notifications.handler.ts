import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { Database } from '../../core/db/database.js';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { formatPlate } from '../../lib/driver-rules.js';
import { type CarText, push, sms } from './messages.js';
import { Notifier } from './notifier.js';

/**
 * Who hears about what, when their app may be closed:
 * - riders: driver found (car, plate, ETA), driver arrived, ride completed, cancelled by
 *   someone else, driver replaced; riders who ordered by phone get the same by SMS;
 * - drivers: a new offer (urgent, expires with the offer), the rider cancelled, the ride
 *   was given to someone else, the application was decided or the account blocked;
 * - operators: an SMS for every SOS (the panel also shows it in realtime).
 */
@Injectable()
export class NotificationsHandler implements OutboxHandler {
  readonly name = 'notifications';

  constructor(
    private readonly db: Database,
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  handles(topic: string): boolean {
    return (
      topic === 'ride.status_changed' ||
      topic === 'ride.offer_created' ||
      topic === 'ride.sos' ||
      topic === 'driver.status_changed'
    );
  }

  async handle(event: OutboxEvent): Promise<void> {
    const key = `event:${event.id}`;
    const p = event.payload;
    if (event.topic === 'ride.offer_created') return this.offer(key, String(p.offerId));
    if (event.topic === 'driver.status_changed') {
      const reason = typeof p.reason === 'string' ? p.reason : null;
      return this.driverStatus(key, String(p.driverId), String(p.from), String(p.to), reason);
    }
    if (event.topic === 'ride.sos') return this.sos(key, String(p.sosId));
    return this.rideChanged(
      key,
      String(p.rideId),
      String(p.from),
      String(p.to),
      p.previousDriverId,
    );
  }

  private async rideChanged(
    key: string,
    rideId: string,
    from: string,
    to: string,
    previousDriverId: unknown,
  ) {
    const ride = await this.db.kysely
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .executeTakeFirst();
    if (!ride) return;
    const byPhone = ride.channel === 'phone' && this.env.NOTIFY_SMS_PHONE_ORDERS;
    const car: CarText | null = ride.vehicle
      ? { ...ride.vehicle, plate: formatPlate(ride.vehicle.plate) }
      : null;
    const toRider = (kind: string, text: Parameters<Notifier['push']>[0]['text']) =>
      this.notifier.push({ key, kind, rideId, userId: ride.rider_id, app: 'rider', text });
    const toDriver = (
      driverId: string,
      kind: string,
      text: Parameters<Notifier['push']>[0]['text'],
    ) => this.notifier.push({ key, kind, rideId, userId: driverId, app: 'driver', text });

    switch (to) {
      case 'driver_assigned': {
        if (!car || !ride.driver_id) return;
        const offer = await this.db.kysely
          .selectFrom('ride_offers')
          .select('eta_s')
          .where('ride_id', '=', ride.id)
          .where('driver_id', '=', ride.driver_id)
          .where('status', '=', 'accepted')
          .executeTakeFirst();
        const minutes = offer?.eta_s != null ? Math.max(1, Math.round(offer.eta_s / 60)) : null;
        await toRider('driver_assigned', (l) => push.driverAssigned(l, car, minutes));
        if (byPhone) {
          const driver = await this.db.kysely
            .selectFrom('users')
            .select('phone')
            .where('id', '=', ride.driver_id)
            .executeTakeFirstOrThrow();
          await this.notifier.sms({
            key,
            kind: 'driver_assigned',
            rideId,
            userId: ride.rider_id,
            phone: ride.rider_phone,
            text: sms.driverAssigned(ride.number, car, minutes, driver.phone),
          });
        }
        if (typeof previousDriverId === 'string') {
          await toDriver(previousDriverId, 'ride_taken_away', (l) =>
            push.rideTakenAway(l, ride.number),
          );
        }
        return;
      }
      case 'driver_arrived':
        if (!car) return;
        await toRider('driver_arrived', (l) => push.driverArrived(l, car));
        if (byPhone) {
          await this.notifier.sms({
            key,
            kind: 'driver_arrived',
            rideId,
            userId: ride.rider_id,
            phone: ride.rider_phone,
            text: sms.driverArrived(ride.number, car),
          });
        }
        return;
      case 'completed':
        await toRider('completed', (l) => push.completed(l, ride.fare_total ?? ride.fare_quoted));
        return;
      case 'searching':
        // a card ride just paid starts its first search: nothing to tell
        if (from === 'awaiting_payment') return;
        await toRider('searching_again', (l) => push.searchingAgain(l));
        return;
      case 'cancelled':
        if (ride.cancelled_by !== 'rider') {
          await toRider('cancelled', (l) => push.cancelledForRider(l, ride.cancel_reason));
          if (byPhone) {
            await this.notifier.sms({
              key,
              kind: 'cancelled',
              rideId,
              userId: ride.rider_id,
              phone: ride.rider_phone,
              text: sms.cancelled(ride.number, ride.cancel_reason),
            });
          }
        }
        if (ride.driver_id && ride.cancelled_by !== 'driver') {
          await toDriver(ride.driver_id, 'rider_cancelled', (l) =>
            push.riderCancelled(l, ride.number),
          );
        }
        return;
    }
  }

  private async offer(key: string, offerId: string) {
    const offer = await this.db.kysely
      .selectFrom('ride_offers as o')
      .innerJoin('rides as r', 'r.id', 'o.ride_id')
      .select([
        'o.driver_id',
        'o.status',
        'o.expires_at',
        'o.eta_s',
        'r.id as rideId',
        'r.fare_quoted',
        'r.pickup',
      ])
      .where('o.id', '=', offerId)
      .executeTakeFirst();
    if (!offer || offer.status !== 'pending') return;
    const ttlSeconds = Math.floor((offer.expires_at.getTime() - Date.now()) / 1000);
    if (ttlSeconds <= 0) return;
    const minutes = offer.eta_s != null ? Math.max(1, Math.round(offer.eta_s / 60)) : null;
    const pickup = offer.pickup.address ?? offer.pickup.landmark ?? '';
    await this.notifier.push({
      key,
      kind: 'offer',
      rideId: offer.rideId,
      userId: offer.driver_id,
      app: 'driver',
      text: (l) => push.newOffer(l, offer.fare_quoted, minutes, pickup),
      data: { offerId },
      urgent: { ttlSeconds },
    });
  }

  /** The reason comes with the event: by the time it is sent, the status may have moved on. */
  private async driverStatus(
    key: string,
    driverId: string,
    from: string,
    to: string,
    reason: string | null,
  ) {
    const texts = {
      active: from === 'blocked' ? push.driverUnblocked : push.driverApproved,
      rejected: (l: 'uz' | 'ru') => push.driverRejected(l, reason),
      blocked: (l: 'uz' | 'ru') => push.driverBlocked(l, reason),
    } as const;
    const text = texts[to as keyof typeof texts];
    if (!text) return;
    await this.notifier.push({
      key,
      kind: `driver_${to}`,
      rideId: null,
      userId: driverId,
      app: 'driver',
      text,
    });
  }

  private async sos(key: string, sosId: string) {
    const s = await this.db.kysely
      .selectFrom('sos_events as s')
      .innerJoin('rides as r', 'r.id', 's.ride_id')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.role', 'u.phone', 'r.id as rideId', 'r.number'])
      .where('s.id', '=', sosId)
      .executeTakeFirst();
    if (!s) return;
    for (const phone of this.env.ADMIN_PHONES) {
      await this.notifier.sms({
        key,
        kind: 'sos',
        rideId: s.rideId,
        userId: null,
        phone,
        text: sms.sos(s.number, s.role, s.phone),
      });
    }
  }
}
