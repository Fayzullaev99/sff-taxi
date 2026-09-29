import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import type {
  PaymentIntentStatus,
  PaymentIntentsTable,
  PaymentProvider,
  RidePaymentStatus,
} from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import { LedgerService } from '../billing/ledger.service.js';
import {
  checkoutUrls,
  enabledProviders,
  RIDE_PAYMENT_MINUTES,
  TOPUP_MAX,
  TOPUP_MIN,
  TOPUP_PAYMENT_MINUTES,
} from './payment-config.js';

type Intent = Selectable<PaymentIntentsTable>;

/** Payme/Click cancel reason 4: the transaction timed out. */
export const REASON_TIMEOUT = 4;

export interface IntentFilter {
  purpose?: 'ride' | 'topup';
  /** An intent status, or "failed": expired or cancelled without a payment. */
  status?: PaymentIntentStatus | 'failed';
  provider?: PaymentProvider;
  driverId?: string;
  rideId?: string;
  phone?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

/** Why an intent cannot take a payment right now. */
export type Unpayable = 'missing' | 'paid' | 'closed';

export interface PayableIntent {
  id: string;
  purpose: 'ride' | 'topup' | 'booking';
  rideId: string | null;
  bookingId: string | null;
  driverId: string | null;
  /** so'm */
  amount: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDER_NAME = { payme: 'Payme', click: 'Click' } as const;

/** No provider transaction was opened for the intent in the last five minutes. */
export function noFreshTransaction(intentIdColumn: string, now: Date) {
  const since = new Date(now.getTime() - 5 * 60_000);
  return sql<boolean>`not exists (
    select 1 from payment_transactions t
    where t.intent_id = ${sql.ref(intentIdColumn)} and t.state = 'created' and t.created_at > ${since}
  )`;
}

/**
 * Payment intents: what a rider (a card ride's fixed fare) or a driver (a balance top-up) is
 * asked to pay, and what a provider's confirmation does. Payme and Click share all of it;
 * their services only speak the protocols (SFF Eats' PaymentsService, keyed by intent).
 */
@Injectable()
export class IntentsService {
  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Card is offered when at least one provider is configured. */
  cardAvailable(): boolean {
    return enabledProviders(this.env).length > 0;
  }

  // Creating ---------------------------------------------------------------------------

  /** The prepayment of a card ride, in the ride's creating transaction. */
  async createForRide(
    trx: Tx,
    ride: { id: string; riderId: string; amount: number },
    now = new Date(),
  ): Promise<string> {
    const id = uuidv7();
    await trx
      .insertInto('payment_intents')
      .values({
        id,
        purpose: 'ride',
        ride_id: ride.id,
        user_id: ride.riderId,
        amount: ride.amount,
        expires_at: new Date(now.getTime() + RIDE_PAYMENT_MINUTES * 60_000),
      })
      .execute();
    return id;
  }

  /** A driver tops up the prepaid balance by card. */
  async createTopup(user: AuthUser, amount: number, now = new Date()) {
    if (!this.cardAvailable()) {
      throw new BadRequestException('Karta orqali to‘lov hali ulanmagan: ofisda naqd to‘ldiring');
    }
    if (!Number.isInteger(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) {
      throw new BadRequestException(
        `To‘ldirish summasi ${TOPUP_MIN} dan ${TOPUP_MAX} so‘mgacha bo‘lishi kerak`,
      );
    }
    const driver = await this.db.kysely
      .selectFrom('drivers')
      .select('status')
      .where('user_id', '=', user.userId)
      .executeTakeFirst();
    if (!driver) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
    if (driver.status === 'blocked') {
      throw new ForbiddenException('Hisobingiz bloklangan: operatorga murojaat qiling');
    }
    const id = uuidv7();
    const row = await this.db.kysely
      .insertInto('payment_intents')
      .values({
        id,
        purpose: 'topup',
        driver_id: user.userId,
        user_id: user.userId,
        amount,
        expires_at: new Date(now.getTime() + TOPUP_PAYMENT_MINUTES * 60_000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.view(row);
  }

  // Reading ----------------------------------------------------------------------------

  view(i: Intent) {
    return {
      id: i.id,
      purpose: i.purpose,
      amount: i.amount,
      status: i.status,
      provider: i.provider,
      expiresAt: i.expires_at,
      paidAt: i.paid_at,
      refundRequestedAt: i.refund_requested_at,
      refundedAt: i.refunded_at,
      // where to pay, while it can still be paid
      checkout: i.status === 'pending' ? checkoutUrls(this.env, i.id, i.amount, i.purpose) : null,
      createdAt: i.created_at,
    };
  }

  async forRide(rideId: string) {
    const row = await this.db.kysely
      .selectFrom('payment_intents')
      .selectAll()
      .where('ride_id', '=', rideId)
      .executeTakeFirst();
    return row ? this.view(row) : null;
  }

  async topups(driverId: string) {
    const rows = await this.db.kysely
      .selectFrom('payment_intents')
      .selectAll()
      .where('driver_id', '=', driverId)
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return rows.map((r) => this.view(r));
  }

  async topup(user: AuthUser, id: string) {
    const row = await this.db.kysely
      .selectFrom('payment_intents')
      .selectAll()
      .where('id', '=', id)
      .where('driver_id', '=', user.userId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('To‘lov topilmadi');
    return this.view(row);
  }

  // Provider callbacks -----------------------------------------------------------------

  /**
   * The intent locked for the rest of the transaction if `provider` may take its payment
   * now: pending, within its window (unless the provider opened the transaction in time),
   * and for a ride, the ride still waiting for this payment.
   */
  async lockPayable(
    trx: Tx,
    intentId: string,
    { checkWindow = true } = {},
  ): Promise<PayableIntent | Unpayable> {
    if (!UUID.test(intentId)) return 'missing';
    const i = await trx
      .selectFrom('payment_intents')
      .selectAll()
      .select(sql<boolean>`expires_at < now()`.as('expired'))
      .where('id', '=', intentId)
      .forUpdate()
      .executeTakeFirst();
    if (!i) return 'missing';
    if (['paid', 'refund_pending', 'refunded'].includes(i.status)) return 'paid';
    if (i.status !== 'pending' || (checkWindow && i.expired)) return 'closed';
    if (i.ride_id) {
      const ride = await trx
        .selectFrom('rides')
        .select('status')
        .where('id', '=', i.ride_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (ride.status !== 'awaiting_payment') return 'closed';
    }
    return {
      id: i.id,
      purpose: i.purpose,
      rideId: i.ride_id,
      bookingId: i.booking_id,
      driverId: i.driver_id,
      amount: i.amount,
    };
  }

  /**
   * The provider took the money. The single place an intent becomes paid: a ride goes to
   * dispatch exactly as a cash ride would, a top-up is credited to the driver's balance.
   */
  async markPaid(trx: Tx, intent: PayableIntent, provider: PaymentProvider): Promise<void> {
    const now = new Date();
    await trx
      .updateTable('payment_intents')
      .set({ status: 'paid', provider, paid_at: now })
      .where('id', '=', intent.id)
      .execute();
    if (intent.purpose === 'topup') {
      await this.ledger.post(trx, {
        driverId: intent.driverId!,
        kind: 'topup',
        amount: intent.amount,
        note: `${PROVIDER_NAME[provider]} orqali to‘ldirildi`,
        paymentIntentId: intent.id,
      });
      // the driver app hears at once (push and stream) instead of polling the top-up
      await emit(trx, 'driver.topup_paid', {
        intentId: intent.id,
        driverId: intent.driverId,
        amount: intent.amount,
        provider,
      });
      return;
    }
    // the search starts now, not when the rider opened the payment page
    await trx
      .updateTable('rides')
      .set({ status: 'searching', payment_status: 'paid', requested_at: now, updated_at: now })
      .where('id', '=', intent.rideId!)
      .execute();
    await trx
      .insertInto('ride_events')
      .values({
        id: uuidv7(),
        ride_id: intent.rideId!,
        type: 'paid',
        actor: 'system',
        actor_id: null,
        data: JSON.stringify({ provider, amount: intent.amount }),
      })
      .execute();
    await emit(trx, 'ride.status_changed', {
      rideId: intent.rideId,
      from: 'awaiting_payment',
      to: 'searching',
    });
    await emit(trx, 'ride.requested', { rideId: intent.rideId });
  }

  /**
   * The provider gave the whole payment back (a refund made in its cabinet). A ride's
   * refund request is done; a refunded top-up is taken back from the balance.
   */
  async markRefunded(
    trx: Tx,
    intentId: string,
    provider: PaymentProvider,
    reference: string | null = null,
  ): Promise<void> {
    const i = await trx
      .selectFrom('payment_intents')
      .selectAll()
      .where('id', '=', intentId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (i.status === 'refunded') return;
    const now = new Date();
    await trx
      .updateTable('payment_intents')
      .set({
        status: 'refunded',
        refunded_at: now,
        refund_requested_at: i.refund_requested_at ?? now,
        refund_reference: reference ?? `${PROVIDER_NAME[provider]} kabineti`,
      })
      .where('id', '=', i.id)
      .execute();
    if (i.ride_id) {
      await trx
        .updateTable('rides')
        .set({ payment_status: 'refunded', updated_at: now })
        .where('id', '=', i.ride_id)
        .execute();
      await trx
        .insertInto('ride_events')
        .values({
          id: uuidv7(),
          ride_id: i.ride_id,
          type: 'refunded',
          actor: 'system',
          actor_id: null,
          data: JSON.stringify({ provider, amount: i.amount }),
        })
        .execute();
      await emit(trx, 'ride.refund_changed', {
        rideId: i.ride_id,
        intentId: i.id,
        status: 'refunded',
        amount: i.amount,
      });
    } else {
      await this.ledger.post(trx, {
        driverId: i.driver_id!,
        kind: 'adjustment',
        amount: -i.amount,
        note: `${PROVIDER_NAME[provider]} to‘lovi qaytarildi`,
      });
    }
  }

  // Rides ------------------------------------------------------------------------------

  /**
   * A card ride ended without a trip (cancelled by anyone, expired): an unpaid intent is
   * closed; a paid one is queued for a refund. Returns the ride's payment status.
   */
  async onRideCancelled(trx: Tx, rideId: string): Promise<RidePaymentStatus> {
    const i = await trx
      .selectFrom('payment_intents')
      .select(['id', 'status', 'amount'])
      .where('ride_id', '=', rideId)
      .forUpdate()
      .executeTakeFirst();
    if (!i) return 'not_charged';
    if (i.status === 'pending') {
      await trx
        .updateTable('payment_intents')
        .set({ status: 'cancelled' })
        .where('id', '=', i.id)
        .execute();
      return 'not_charged';
    }
    if (i.status === 'paid') {
      await trx
        .updateTable('payment_intents')
        .set({ status: 'refund_pending', refund_requested_at: new Date() })
        .where('id', '=', i.id)
        .execute();
      await emit(trx, 'ride.refund_changed', {
        rideId,
        intentId: i.id,
        status: 'refund_pending',
        amount: i.amount,
      });
      return 'refund_pending';
    }
    return i.status === 'refunded' ? 'refunded' : 'not_charged';
  }

  /** Closes an unpaid ride intent whose window has passed (the ride is cancelled by the caller). */
  async expireRideIntent(trx: Tx, rideId: string): Promise<void> {
    await trx
      .updateTable('payment_intents')
      .set({ status: 'expired' })
      .where('ride_id', '=', rideId)
      .where('status', '=', 'pending')
      .execute();
  }

  /**
   * Rides still waiting for a payment whose window has closed. A payment being made right
   * now (a transaction opened in the last few minutes) gets a little longer, so a rider
   * typing the SMS code is not cut off.
   */
  async dueRideIntents(now: Date, limit: number): Promise<string[]> {
    const rows = await this.dueQuery(now, 'ride', limit).select('i.ride_id').execute();
    return rows.map((r) => r.ride_id!);
  }

  /** Expires top-ups whose window has closed; returns how many. */
  async expireTopups(now = new Date(), limit = 100): Promise<number> {
    const due = await this.dueQuery(now, 'topup', limit).select('i.id').execute();
    let expired = 0;
    for (const { id } of due) {
      // re-checked in the update: the payment may have started or completed since the scan
      const res = await this.db.kysely
        .updateTable('payment_intents')
        .set({ status: 'expired' })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .where(noFreshTransaction('payment_intents.id', now))
        .executeTakeFirst();
      expired += Number(res.numUpdatedRows);
    }
    return expired;
  }

  private dueQuery(now: Date, purpose: 'ride' | 'topup', limit: number) {
    return this.db.kysely
      .selectFrom('payment_intents as i')
      .where('i.status', '=', 'pending')
      .where('i.purpose', '=', purpose)
      .where('i.expires_at', '<', now)
      .where(noFreshTransaction('i.id', now))
      .orderBy('i.expires_at')
      .limit(limit);
  }

  // Operators --------------------------------------------------------------------------

  /**
   * Every card payment for the panel: ride prepayments and driver top-ups, newest first,
   * filtered by purpose, status, provider, Tashkent days, a driver or a phone; paged by
   * `cursor` = the last id seen (100 per page).
   */
  async adminList(f: IntentFilter) {
    const dayStart = (d: string) => new Date(`${d}T00:00:00+05:00`);
    const rows = await this.db.kysely
      .selectFrom('payment_intents as i')
      .innerJoin('users as u', 'u.id', 'i.user_id')
      .leftJoin('rides as r', 'r.id', 'i.ride_id')
      .leftJoin('drivers as d', 'd.user_id', 'i.driver_id')
      .select([
        'i.id',
        'i.purpose',
        'i.status',
        'i.amount',
        'i.provider',
        'i.ride_id as rideId',
        'r.number as rideNumber',
        'i.driver_id as driverId',
        'd.full_name as driverName',
        'i.user_id as userId',
        'u.phone',
        'i.expires_at as expiresAt',
        'i.paid_at as paidAt',
        'i.refund_requested_at as refundRequestedAt',
        'i.refunded_at as refundedAt',
        'i.refund_reference as refundReference',
        'i.created_at as createdAt',
      ])
      .$if(Boolean(f.purpose), (q) => q.where('i.purpose', '=', f.purpose!))
      .$if(Boolean(f.status), (q) =>
        q.where(
          'i.status',
          'in',
          f.status === 'failed' ? ['expired', 'cancelled'] : [f.status as PaymentIntentStatus],
        ),
      )
      .$if(Boolean(f.provider), (q) => q.where('i.provider', '=', f.provider!))
      .$if(Boolean(f.driverId), (q) => q.where('i.driver_id', '=', f.driverId!))
      .$if(Boolean(f.rideId), (q) => q.where('i.ride_id', '=', f.rideId!))
      .$if(Boolean(f.phone), (q) => q.where('u.phone', '=', f.phone!))
      .$if(Boolean(f.from), (q) => q.where('i.created_at', '>=', dayStart(f.from!)))
      .$if(Boolean(f.to), (q) =>
        q.where('i.created_at', '<', new Date(dayStart(f.to!).getTime() + 86_400_000)),
      )
      .$if(Boolean(f.cursor), (q) => q.where('i.id', '<', f.cursor!))
      .orderBy('i.id', 'desc')
      .limit(100)
      .execute();
    return { items: rows, nextCursor: rows.length === 100 ? rows.at(-1)!.id : null };
  }

  /** Totals per purpose and status for the same filters' period (the panel's header). */
  async adminSummary(f: Pick<IntentFilter, 'from' | 'to'>) {
    const dayStart = (d: string) => new Date(`${d}T00:00:00+05:00`);
    return this.db.kysely
      .selectFrom('payment_intents')
      .select([
        'purpose',
        'status',
        (eb) => eb.fn.countAll<string>().as('count'),
        (eb) => eb.fn.sum<string>('amount').as('amount'),
      ])
      .$if(Boolean(f.from), (q) => q.where('created_at', '>=', dayStart(f.from!)))
      .$if(Boolean(f.to), (q) =>
        q.where('created_at', '<', new Date(dayStart(f.to!).getTime() + 86_400_000)),
      )
      .groupBy(['purpose', 'status'])
      .orderBy('purpose')
      .orderBy('status')
      .execute()
      .then((rows) =>
        rows.map((r) => ({ ...r, count: Number(r.count), amount: Number(r.amount ?? 0) })),
      );
  }

  /** Paid rides that were cancelled: the money must go back to the rider's card. */
  async refundQueue() {
    return this.db.kysely
      .selectFrom('payment_intents as i')
      .innerJoin('rides as r', 'r.id', 'i.ride_id')
      .select([
        'i.id',
        'i.amount',
        'i.provider',
        'i.paid_at as paidAt',
        'i.refund_requested_at as refundRequestedAt',
        'r.id as rideId',
        'r.number as rideNumber',
        'r.rider_phone as riderPhone',
        'r.cancel_reason as cancelReason',
      ])
      .where('i.status', '=', 'refund_pending')
      .orderBy('i.refund_requested_at')
      .limit(200)
      .execute();
  }

  /**
   * An operator returned the money outside a provider callback (a Click reversal, a bank
   * transfer): the refund is recorded with its reference.
   */
  async confirmRefund(intentId: string, reference: string) {
    await this.db.transaction(async (trx) => {
      const i = await trx
        .selectFrom('payment_intents')
        .select(['status', 'provider'])
        .where('id', '=', intentId)
        .forUpdate()
        .executeTakeFirst();
      if (!i) throw new NotFoundException('To‘lov topilmadi');
      if (i.status !== 'refund_pending') {
        throw new BadRequestException('Bu to‘lov qaytarish kutmayapti');
      }
      await this.markRefunded(trx, intentId, i.provider!, reference);
    });
    const row = await this.db.kysely
      .selectFrom('payment_intents')
      .selectAll()
      .where('id', '=', intentId)
      .executeTakeFirstOrThrow();
    return this.view(row);
  }
}
