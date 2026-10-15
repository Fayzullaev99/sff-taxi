import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import type { RideTipsTable } from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import { checkTip } from '../../lib/tips.js';
import { IntentsService } from '../payments/intents.service.js';
import { SettingsService } from '../settings/settings.module.js';

type Tip = Selectable<RideTipsTable>;

/** A card tip is paid within this long; then the rider may try again. */
export const TIP_PAYMENT_MINUTES = 30;

/**
 * Tips ("choychaqa"): one per ride, after it completed. Cash is only recorded (the rider
 * hands it over); a card tip is a payment intent of purpose `tip` (Payme/Click), credited
 * 100% to the driver's balance when paid (ledger `tip`, in IntentsService.markPaid): no
 * commission, no tax withheld (docs/architecture.md §8 "Tips").
 */
@Injectable()
export class TipsService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly intents: IntentsService,
  ) {}

  /** The ride's tip (or null) and what the rating screen offers. */
  async forRider(user: AuthUser, rideId: string) {
    const ride = await this.completedRide(rideId, user.userId);
    const [rules, tip] = await Promise.all([this.settings.tips(), this.tipOf(ride.id)]);
    const now = new Date();
    return {
      tip: tip ? await this.view(tip) : null,
      rules: {
        enabled: rules.enabled,
        presets: rules.presets,
        min: rules.min_amount,
        max: rules.max_amount,
        card: rules.card_enabled && this.intents.cardAvailable(),
        /** Until when a tip can still be added. */
        until: ride.completed_at
          ? new Date(ride.completed_at.getTime() + rules.window_hours * 3600_000)
          : null,
        open:
          rules.enabled &&
          ride.completed_at !== null &&
          now.getTime() - ride.completed_at.getTime() <= rules.window_hours * 3600_000,
      },
    };
  }

  /**
   * The rider adds a tip. Cash: recorded at once. Card: a payment intent (checkout links in
   * the answer); a repeat while it is still payable returns the same one; a failed or expired
   * attempt may be retried, also with another amount. A paid or recorded tip is final (409).
   */
  async give(user: AuthUser, rideId: string, input: { amount: number; method: 'cash' | 'card' }) {
    const ride = await this.completedRide(rideId, user.userId);
    const rules = await this.settings.tips();
    const check = checkTip(
      input.amount,
      { completedAt: ride.completed_at!, now: new Date() },
      rules,
    );
    if (!check.ok) throw new BadRequestException({ message: check.message, reason: check.reason });
    if (input.method === 'card' && !(rules.card_enabled && this.intents.cardAvailable())) {
      throw new BadRequestException('Karta orqali choychaqa hozircha ishlamaydi: naqd bering');
    }
    const tipId = await this.db.transaction(async (trx) => {
      const created = await trx
        .insertInto('ride_tips')
        .values({
          id: uuidv7(),
          ride_id: ride.id,
          rider_id: user.userId,
          driver_id: ride.driver_id!,
          amount: input.amount,
          method: input.method,
          status: input.method === 'cash' ? 'recorded' : 'awaiting_payment',
        })
        .onConflict((oc) => oc.column('ride_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      // the tip row is the lock for this ride's tip (payment callbacks lock it the same way)
      const tip = await this.lockTip(trx, ride.id);
      if (!created) {
        if (tip.status === 'paid' || tip.status === 'recorded' || tip.status === 'refunded') {
          // the same request again (a double tap, a retry after a lost answer): the same tip
          if (tip.method === input.method && tip.amount === input.amount) return tip.id;
          throw new ConflictException('Bu safar uchun choychaqa allaqachon berilgan');
        }
        // a card attempt not paid (waiting or failed): still payable as asked, or start over
        const pending = await trx
          .selectFrom('payment_intents')
          .select(['id', 'amount', 'expires_at'])
          .where('tip_id', '=', tip.id)
          .where('status', '=', 'pending')
          .forUpdate()
          .executeTakeFirst();
        if (
          input.method === 'card' &&
          pending &&
          pending.amount === input.amount &&
          pending.expires_at > new Date()
        ) {
          return tip.id;
        }
        if (pending) await this.closePending(trx, tip.id);
        await trx
          .updateTable('ride_tips')
          .set({
            method: input.method,
            status: input.method === 'cash' ? 'recorded' : 'awaiting_payment',
            amount: input.amount,
            updated_at: new Date(),
          })
          .where('id', '=', tip.id)
          .execute();
      }
      if (input.method === 'card') {
        await this.intents.createForTip(trx, {
          tipId: tip.id,
          riderId: user.userId,
          amount: input.amount,
          expiresAt: new Date(Date.now() + TIP_PAYMENT_MINUTES * 60_000),
        });
      } else {
        // the driver hears of it (push and stream): the rider hands it over
        await emit(trx, 'ride.tip_changed', {
          tipId: tip.id,
          rideId: ride.id,
          driverId: ride.driver_id,
          amount: input.amount,
          method: 'cash',
          status: 'recorded',
        });
      }
      return tip.id;
    });
    const tip = await this.db.kysely
      .selectFrom('ride_tips')
      .selectAll()
      .where('id', '=', tipId)
      .executeTakeFirstOrThrow();
    return this.view(tip);
  }

  /** The driver's view of a ride's tip (null when none). */
  async forDriver(user: AuthUser, rideId: string) {
    const tip = await this.db.kysely
      .selectFrom('ride_tips')
      .selectAll()
      .where('ride_id', '=', rideId)
      .where('driver_id', '=', user.userId)
      .executeTakeFirst();
    return tip ? this.driverView(tip) : null;
  }

  /** Operators: the ride's tip with its payments. */
  async forOperator(rideId: string) {
    const tip = await this.tipOf(rideId);
    if (!tip) return null;
    const payments = await this.db.kysely
      .selectFrom('payment_intents')
      .selectAll()
      .where('tip_id', '=', tip.id)
      .orderBy('id')
      .execute();
    return { ...this.driverView(tip), payments: payments.map((p) => this.intents.view(p)) };
  }

  /** Card tip intents whose window closed: expired, the tip failed (the rider may retry). */
  async expireUnpaid(now = new Date(), limit = 100): Promise<number> {
    const due = await this.db.kysely
      .selectFrom('payment_intents')
      .select(['id', 'tip_id'])
      .where('purpose', '=', 'tip')
      .where('status', '=', 'pending')
      .where('expires_at', '<', now)
      .orderBy('expires_at')
      .limit(limit)
      .execute();
    let expired = 0;
    for (const d of due) {
      const done = await this.db.transaction(async (trx) => {
        // the intent first, like the provider callbacks; a payment landing now: next time
        const intent = await trx
          .selectFrom('payment_intents')
          .select('id')
          .where('id', '=', d.id)
          .where('status', '=', 'pending')
          .where(
            sql<boolean>`not exists (select 1 from payment_transactions t where t.intent_id = payment_intents.id and t.state = 'created' and t.created_at > ${new Date(now.getTime() - 5 * 60_000)})`,
          )
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!intent) return false;
        await trx
          .updateTable('payment_intents')
          .set({ status: 'expired' })
          .where('id', '=', d.id)
          .execute();
        await trx
          .updateTable('ride_tips')
          .set({ status: 'failed', updated_at: now })
          .where('id', '=', d.tip_id!)
          .where('status', '=', 'awaiting_payment')
          .execute();
        return true;
      });
      if (done) expired++;
    }
    return expired;
  }

  private async closePending(trx: Tx, tipId: string): Promise<void> {
    await trx
      .updateTable('payment_intents')
      .set({ status: 'cancelled' })
      .where('tip_id', '=', tipId)
      .where('status', '=', 'pending')
      .execute();
  }

  private async lockTip(trx: Tx, rideId: string): Promise<Tip> {
    return trx
      .selectFrom('ride_tips')
      .selectAll()
      .where('ride_id', '=', rideId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  private tipOf(rideId: string) {
    return this.db.kysely
      .selectFrom('ride_tips')
      .selectAll()
      .where('ride_id', '=', rideId)
      .executeTakeFirst();
  }

  /** The rider's completed ride with a driver; 404 / 409 otherwise. */
  private async completedRide(rideId: string, riderId: string) {
    const ride = await this.db.kysely
      .selectFrom('rides')
      .select(['id', 'rider_id', 'driver_id', 'status', 'completed_at'])
      .where('id', '=', rideId)
      .executeTakeFirst();
    if (!ride || ride.rider_id !== riderId) throw new NotFoundException('Buyurtma topilmadi');
    if (ride.status !== 'completed' || !ride.completed_at || !ride.driver_id) {
      throw new ConflictException('Choychaqa safar yakunlangandan keyin beriladi');
    }
    return ride;
  }

  /** The rider's view: the tip and, for a card tip waiting, where to pay. */
  private async view(tip: Tip) {
    const payment =
      tip.method === 'card'
        ? await this.db.kysely
            .selectFrom('payment_intents')
            .selectAll()
            .where('tip_id', '=', tip.id)
            .orderBy('id', 'desc')
            .executeTakeFirst()
        : undefined;
    return {
      id: tip.id,
      rideId: tip.ride_id,
      amount: tip.amount,
      method: tip.method,
      status: tip.status,
      paidAt: tip.paid_at,
      createdAt: tip.created_at,
      payment: payment ? this.intents.view(payment) : null,
    };
  }

  private driverView(tip: Tip) {
    return {
      id: tip.id,
      rideId: tip.ride_id,
      amount: tip.amount,
      method: tip.method,
      status: tip.status,
      paidAt: tip.paid_at,
      createdAt: tip.created_at,
    };
  }
}
