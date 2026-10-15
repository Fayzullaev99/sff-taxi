import { Injectable } from '@nestjs/common';
import { Database } from '../../core/db/database.js';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { chatPreview } from '../../lib/chat.js';
import { driverGivenName } from '../../lib/names.js';
import { engagementPush } from './engagement-messages.js';
import { Notifier } from './notifier.js';

/**
 * Pushes of the rider-engagement features, apart from the ride lifecycle's handler:
 * - riders: the referral reward (a friend's first completed ride credited them);
 * - the ride chat: the other side's message when the app may be closed (the app keeps the
 *   banner quiet while that chat is on screen); a message already read is not pushed;
 * - drivers: a tip, cash the rider hands over or a card tip on the balance.
 */
@Injectable()
export class EngagementNotificationsHandler implements OutboxHandler {
  readonly name = 'engagement-notifications';

  constructor(
    private readonly db: Database,
    private readonly notifier: Notifier,
  ) {}

  handles(topic: string): boolean {
    return (
      topic === 'promo.referral_rewarded' ||
      topic === 'ride.message' ||
      topic === 'ride.tip_changed'
    );
  }

  async handle(event: OutboxEvent): Promise<void> {
    const key = `event:${event.id}`;
    const p = event.payload;
    if (event.topic === 'promo.referral_rewarded') {
      const amount = Number(p.amount);
      await this.notifier.push({
        key,
        kind: 'referral_rewarded',
        rideId: null,
        userId: String(p.referrerId),
        app: 'rider',
        text: (l) => engagementPush.referralRewarded(l, amount),
        data: { referralId: String(p.referralId) },
      });
      return;
    }
    if (event.topic === 'ride.message') return this.chatMessage(key, String(p.messageId));
    if (event.topic === 'ride.tip_changed') {
      const method = p.method === 'card' ? 'card' : 'cash';
      const amount = Number(p.amount);
      await this.notifier.push({
        key,
        kind: 'tip',
        rideId: String(p.rideId),
        userId: String(p.driverId),
        app: 'driver',
        text: (l) => engagementPush.tip(l, method, amount),
      });
    }
  }

  private async chatMessage(key: string, messageId: string) {
    const m = await this.db.kysely
      .selectFrom('ride_messages as m')
      .innerJoin('rides as r', 'r.id', 'm.ride_id')
      .leftJoin('drivers as d', 'd.user_id', 'm.driver_id')
      .select([
        'm.ride_id',
        'm.author_role',
        'm.driver_id',
        'm.text',
        'm.read_at',
        'r.rider_id',
        'd.full_name as driver_name',
      ])
      .where('m.id', '=', messageId)
      .executeTakeFirst();
    // read in the app meanwhile: nothing to tell
    if (!m || m.read_at) return;
    const fromDriver = m.author_role === 'driver';
    const name = fromDriver && m.driver_name ? driverGivenName(m.driver_name) : null;
    const preview = chatPreview(m.text);
    await this.notifier.push({
      key,
      kind: 'chat',
      rideId: m.ride_id,
      userId: fromDriver ? m.rider_id : m.driver_id,
      app: fromDriver ? 'rider' : 'driver',
      text: (l) => engagementPush.chatMessage(l, m.author_role, name, preview),
    });
  }
}
