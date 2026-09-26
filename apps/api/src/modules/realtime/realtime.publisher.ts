import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Database } from '../../core/db/database.js';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { REDIS } from '../../core/redis/redis.token.js';

export const REALTIME_CHANNEL = 'taxi:realtime';

/** Who a message is for; a connection receives it if it matches any part. */
export interface Audience {
  userIds?: string[];
  admins?: boolean;
}

/**
 * What screens receive: mostly a nudge to refetch, never more than the recipient may read
 * through the API. The driver's position goes to the rider of that ride only.
 */
export type RealtimeEvent =
  | { type: 'ride.updated'; rideId: string; status: string }
  | { type: 'offer.new'; offerId: string; rideId: string; driverId: string; expiresAt: string }
  | { type: 'offer.closed'; offerId: string; rideId: string; driverId: string; status: string }
  | { type: 'ride.attention'; rideId: string; reason: string }
  | { type: 'sos'; sosId: string; rideId: string }
  | { type: 'driver.updated'; driverId: string; status: string }
  | { type: 'driver.appeal'; appealId: string; driverId: string }
  | { type: 'intercity.updated'; tripId: string; bookingId: string | null; status: string }
  | { type: 'complaint.updated'; complaintId: string; rideId: string; status: string }
  | {
      /** Operators' live map: every online driver's last position, every few seconds. */
      type: 'drivers.positions';
      drivers: {
        id: string;
        lat: number;
        lng: number;
        heading: number | null;
        at: string;
        busy: boolean;
      }[];
    }
  | {
      type: 'driver.location';
      rideId: string;
      lat: number;
      lng: number;
      heading: number | null;
      at: string;
      /** Road ETA to the pickup while the driver is on the way (refreshed every ~15 s). */
      etaS: number | null;
    };

export interface RealtimeMessage {
  to: Audience;
  event: RealtimeEvent;
}

/** Publishes to every API instance's open streams (Redis pub/sub). */
@Injectable()
export class RealtimeBus {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(message: RealtimeMessage): Promise<void> {
    await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(message));
  }
}

/** Worker-side: turns ride and driver events into realtime messages for the API instances. */
@Injectable()
export class RealtimePublisher implements OutboxHandler {
  readonly name = 'realtime';
  private readonly bus: RealtimeBus;

  constructor(
    private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.bus = new RealtimeBus(redis);
  }

  handles(topic: string): boolean {
    return (
      topic.startsWith('ride.') ||
      topic.startsWith('driver.') ||
      topic.startsWith('intercity.') ||
      topic === 'complaint.changed'
    );
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    switch (event.topic) {
      case 'ride.offer_created': {
        const offer = await this.db.kysely
          .selectFrom('ride_offers')
          .select(['id', 'ride_id', 'driver_id', 'status', 'expires_at'])
          .where('id', '=', String(p.offerId))
          .executeTakeFirst();
        // an offer already answered or withdrawn is not news any more
        if (!offer || offer.status !== 'pending') return;
        return this.bus.publish({
          to: { userIds: [offer.driver_id], admins: true },
          event: {
            type: 'offer.new',
            offerId: offer.id,
            rideId: offer.ride_id,
            driverId: offer.driver_id,
            expiresAt: offer.expires_at.toISOString(),
          },
        });
      }
      case 'ride.offer_closed':
        return this.bus.publish({
          to: { userIds: [String(p.driverId)], admins: true },
          event: {
            type: 'offer.closed',
            offerId: String(p.offerId),
            rideId: String(p.rideId),
            driverId: String(p.driverId),
            status: String(p.status),
          },
        });
      case 'ride.attention':
        return this.bus.publish({
          to: { admins: true },
          event: { type: 'ride.attention', rideId: String(p.rideId), reason: String(p.reason) },
        });
      case 'ride.sos':
        return this.bus.publish({
          to: { admins: true },
          event: { type: 'sos', sosId: String(p.sosId), rideId: String(p.rideId) },
        });
      case 'driver.status_changed':
        return this.bus.publish({
          to: { userIds: [String(p.driverId)], admins: true },
          event: { type: 'driver.updated', driverId: String(p.driverId), status: String(p.to) },
        });
      case 'driver.appeal':
        return this.bus.publish({
          to: { admins: true },
          event: {
            type: 'driver.appeal',
            appealId: String(p.appealId),
            driverId: String(p.driverId),
          },
        });
      case 'ride.requested':
      case 'ride.status_changed':
        return this.rideUpdated(String(p.rideId), p.previousDriverId);
      case 'complaint.changed':
        return this.bus.publish({
          to: { userIds: [String(p.riderId)], admins: true },
          event: {
            type: 'complaint.updated',
            complaintId: String(p.complaintId),
            rideId: String(p.rideId),
            status: String(p.status),
          },
        });
      case 'intercity.trip_changed':
      case 'intercity.booking_changed':
        return this.tripUpdated(
          String(p.tripId),
          typeof p.bookingId === 'string' ? p.bookingId : null,
          String(p.to ?? p.status),
        );
    }
  }

  /** A trip or one of its bookings changed: its driver, its riders and operators refetch. */
  private async tripUpdated(tripId: string, bookingId: string | null, status: string) {
    const trip = await this.db.kysely
      .selectFrom('intercity_trips')
      .select(['id', 'driver_id'])
      .where('id', '=', tripId)
      .executeTakeFirst();
    if (!trip) return;
    const riders = await this.db.kysely
      .selectFrom('intercity_bookings')
      .select('rider_id')
      .where('trip_id', '=', tripId)
      .$if(Boolean(bookingId), (q) => q.where('id', '=', bookingId!))
      .execute();
    await this.bus.publish({
      to: { userIds: [trip.driver_id, ...new Set(riders.map((r) => r.rider_id))], admins: true },
      event: { type: 'intercity.updated', tripId, bookingId, status },
    });
  }

  /** The ride as it is now: a late or repeated event still sends the current state. */
  private async rideUpdated(rideId: string, previousDriverId: unknown): Promise<void> {
    const ride = await this.db.kysely
      .selectFrom('rides')
      .select(['id', 'status', 'rider_id', 'driver_id'])
      .where('id', '=', rideId)
      .executeTakeFirst();
    if (!ride) return;
    const userIds = [ride.rider_id, ride.driver_id].filter((id): id is string => !!id);
    // a driver taken off the ride must hear about it too
    if (typeof previousDriverId === 'string') userIds.push(previousDriverId);
    await this.bus.publish({
      to: { userIds, admins: true },
      event: { type: 'ride.updated', rideId: ride.id, status: ride.status },
    });
  }
}
