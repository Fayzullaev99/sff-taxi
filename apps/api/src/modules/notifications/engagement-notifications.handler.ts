import { Injectable } from '@nestjs/common';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { engagementPush } from './engagement-messages.js';
import { Notifier } from './notifier.js';

/**
 * Pushes of the rider-engagement features, apart from the ride lifecycle's handler:
 * - riders: the referral reward (a friend's first completed ride credited them).
 */
@Injectable()
export class EngagementNotificationsHandler implements OutboxHandler {
  readonly name = 'engagement-notifications';

  constructor(private readonly notifier: Notifier) {}

  handles(topic: string): boolean {
    return topic === 'promo.referral_rewarded';
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
    }
  }
}
