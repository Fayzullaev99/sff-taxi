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
  | { type: 'offer.new'; offerId: string; rideId: string; expiresAt: string }
  | { type: 'offer.closed'; offerId: string; rideId: string; status: string }
  | { type: 'ride.attention'; rideId: string; reason: string }
  | { type: 'sos'; sosId: string; rideId: string }
  | { type: 'driver.updated'; status: string }
  | {
      type: 'driver.location';
      rideId: string;
      lat: number;
      lng: number;
      heading: number | null;
      at: string;
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
    return topic.startsWith('ride.') || topic === 'driver.status_changed';
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
          to: { userIds: [offer.driver_id] },
          event: {
            type: 'offer.new',
            offerId: offer.id,
            rideId: offer.ride_id,
            expiresAt: offer.expires_at.toISOString(),
          },
        });
      }
      case 'ride.offer_closed':
        return this.bus.publish({
          to: { userIds: [String(p.driverId)] },
          event: {
            type: 'offer.closed',
            offerId: String(p.offerId),
            rideId: String(p.rideId),
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
          event: { type: 'driver.updated', status: String(p.to) },
        });
      case 'ride.requested':
      case 'ride.status_changed':
        return this.rideUpdated(String(p.rideId), p.previousDriverId);
    }
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
