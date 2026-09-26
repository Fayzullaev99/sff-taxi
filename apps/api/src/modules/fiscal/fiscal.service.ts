import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { Database } from '../../core/db/database.js';
import { emit } from '../../core/outbox/outbox.js';
import { SettingsService } from '../settings/settings.module.js';
import { FISCAL_PROVIDER, type FiscalProvider } from './fiscal-provider.js';
import { buildReceiptPayload, type ReceiptInput } from './receipt-payload.js';

export type ReceiptTarget = { rideId: string } | { bookingId: string };

/**
 * Electronic fiscal receipts (Resolution 200): one per completed ride and intercity booking,
 * cash ones included. Completion emits `fiscal.receipt_due` in its transaction; the worker's
 * handler calls issue(), and a provider failure makes the outbox retry the event with
 * backoff (then operators see it among the dead events and can retry it).
 */
@Injectable()
export class FiscalService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProvider,
  ) {}

  /** Prepares (once) and sends a receipt; safe to repeat. */
  async issue(target: ReceiptTarget): Promise<'sent' | 'skipped' | 'already'> {
    const column = 'rideId' in target ? 'ride_id' : 'booking_id';
    const id = 'rideId' in target ? target.rideId : target.bookingId;
    let row = await this.db.kysely
      .selectFrom('fiscal_receipts')
      .selectAll()
      .where(column, '=', id)
      .executeTakeFirst();
    if (row && row.status !== 'pending') return 'already';
    if (!row) {
      const input = await this.source(target);
      if (!input) throw new NotFoundException('Chek uchun yakunlangan safar topilmadi');
      const payload = buildReceiptPayload({ ...input, rules: await this.settings.fiscal() });
      await this.db.kysely
        .insertInto('fiscal_receipts')
        .values({
          id: uuidv7(),
          [column]: id,
          provider: this.provider.name,
          amount: input.total,
          payload: JSON.stringify(payload),
        })
        .onConflict((oc) => oc.column(column).doNothing())
        .execute();
      row = await this.db.kysely
        .selectFrom('fiscal_receipts')
        .selectAll()
        .where(column, '=', id)
        .executeTakeFirstOrThrow();
      if (row.status !== 'pending') return 'already';
    }

    let issued;
    try {
      issued = await this.provider.issue(row.payload as never);
    } catch (error) {
      await this.db.kysely
        .updateTable('fiscal_receipts')
        .set((eb) => ({
          attempts: eb('attempts', '+', 1),
          last_error: (error as Error).message.slice(0, 1000),
        }))
        .where('id', '=', row.id)
        .execute();
      throw error;
    }
    await this.db.kysely
      .updateTable('fiscal_receipts')
      .set({
        provider: this.provider.name,
        attempts: sql`attempts + 1`,
        last_error: null,
        ...(issued
          ? {
              status: 'sent' as const,
              receipt_id: issued.receiptId,
              fiscal_sign: issued.fiscalSign,
              receipt_url: issued.url,
              sent_at: new Date(),
            }
          : { status: 'skipped' as const }),
      })
      .where('id', '=', row.id)
      .execute();
    return issued ? 'sent' : 'skipped';
  }

  /** What the receipt is made of, from the completed ride or booking. */
  private async source(target: ReceiptTarget): Promise<Omit<ReceiptInput, 'rules'> | null> {
    if ('rideId' in target) {
      const r = await this.db.kysely
        .selectFrom('rides as r')
        .innerJoin('drivers as d', 'd.user_id', 'r.driver_id')
        .select([
          'r.id',
          'r.number',
          'r.completed_at',
          'r.fare_total',
          'r.fare_quoted',
          'r.payment_method',
          'r.rider_phone',
          'r.pickup',
          'r.dropoff',
          'd.pinfl',
        ])
        .where('r.id', '=', target.rideId)
        .where('r.status', '=', 'completed')
        .executeTakeFirst();
      if (!r || r.fare_total === null || !r.completed_at) return null;
      return {
        kind: 'ride',
        id: r.id,
        number: r.number,
        completedAt: r.completed_at,
        total: r.fare_total,
        // a card ride's quoted fare was prepaid; paid waiting was cash
        card: r.payment_method === 'card' ? r.fare_quoted : 0,
        driverPinfl: r.pinfl,
        riderPhone: r.rider_phone,
        from: r.pickup.address,
        to: r.dropoff.address,
        quantity: 1,
      };
    }
    const b = await this.db.kysely
      .selectFrom('intercity_bookings as b')
      .innerJoin('intercity_trips as t', 't.id', 'b.trip_id')
      .innerJoin('drivers as d', 'd.user_id', 't.driver_id')
      .innerJoin('intercity_points as pf', 'pf.id', 't.from_point_id')
      .innerJoin('intercity_points as pt', 'pt.id', 't.to_point_id')
      .select([
        'b.id',
        'b.number',
        'b.completed_at',
        'b.price',
        'b.seats',
        'b.rider_phone',
        'd.pinfl',
        'pf.name_uz as from',
        'pt.name_uz as to',
      ])
      .where('b.id', '=', target.bookingId)
      .where('b.status', '=', 'completed')
      .executeTakeFirst();
    if (!b || !b.completed_at) return null;
    return {
      kind: 'intercity',
      id: b.id,
      number: b.number,
      completedAt: b.completed_at,
      total: b.price,
      card: 0,
      driverPinfl: b.pinfl,
      riderPhone: b.rider_phone,
      from: b.from,
      to: b.to,
      quantity: b.seats,
    };
  }

  /** The receipt of a ride for the rider's screen (null until prepared). */
  async forRide(rideId: string) {
    const row = await this.db.kysely
      .selectFrom('fiscal_receipts')
      .select(['status', 'receipt_url as url', 'sent_at as sentAt'])
      .where('ride_id', '=', rideId)
      .executeTakeFirst();
    return row ?? null;
  }

  async list(filter: { status?: 'pending' | 'sent' | 'skipped'; cursor?: string }) {
    return this.db.kysely
      .selectFrom('fiscal_receipts')
      .select([
        'id',
        'ride_id as rideId',
        'booking_id as bookingId',
        'provider',
        'status',
        'amount',
        'receipt_id as receiptId',
        'receipt_url as url',
        'attempts',
        'last_error as lastError',
        'payload',
        'created_at as createdAt',
        'sent_at as sentAt',
      ])
      .$if(Boolean(filter.status), (q) => q.where('status', '=', filter.status!))
      .$if(Boolean(filter.cursor), (q) => q.where('id', '<', filter.cursor!))
      .orderBy('id', 'desc')
      .limit(100)
      .execute();
  }

  /**
   * Sends prepared receipts again: the ones kept while no provider was configured, once one
   * is, or a pending one after its provider problem was fixed. Returns how many were queued.
   */
  async resend(status: 'skipped' | 'pending', limit = 500): Promise<number> {
    return this.db.transaction(async (trx) => {
      const rows = await trx
        .updateTable('fiscal_receipts')
        .set({ status: 'pending' })
        .where(
          'id',
          'in',
          trx
            .selectFrom('fiscal_receipts')
            .select('id')
            .where('status', '=', status)
            .orderBy('created_at')
            .limit(limit),
        )
        .returning(['ride_id', 'booking_id'])
        .execute();
      for (const r of rows) {
        await emit(
          trx,
          'fiscal.receipt_due',
          r.ride_id ? { rideId: r.ride_id } : { bookingId: r.booking_id },
        );
      }
      return rows.length;
    });
  }
}
