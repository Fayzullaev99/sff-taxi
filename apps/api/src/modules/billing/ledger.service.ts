import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { Database, type Tx } from '../../core/db/database.js';
import type { LedgerKind } from '../../core/db/schema.js';
import { msg } from '../../core/http/messages.js';
import { SettingsService } from '../settings/settings.module.js';

type Db = Tx | Database['kysely'];

export interface LedgerEntryInput {
  driverId: string;
  kind: LedgerKind;
  /** Signed so'm: credits positive, debits negative. */
  amount: number;
  rideId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

const PASS_DAYS = { day: 1, week: 7 } as const;
export type PassKind = keyof typeof PASS_DAYS;

/**
 * The driver's prepaid balance: an append-only ledger (the table refuses updates and
 * deletes), balance = sum of the entries. Cash rides are paid to the driver; the platform
 * fee and the withheld tax are debited here and top-ups credited.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  async balance(driverId: string, db: Db = this.db.kysely): Promise<number> {
    const row = await db
      .selectFrom('driver_ledger')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('balance'))
      .where('driver_id', '=', driverId)
      .executeTakeFirstOrThrow();
    return Number(row.balance);
  }

  /** Appends one entry; a ride's charge of the same kind is recorded once (unique index). */
  async post(trx: Tx, e: LedgerEntryInput): Promise<string | null> {
    if (e.amount === 0) return null;
    const id = uuidv7();
    const inserted = await trx
      .insertInto('driver_ledger')
      .values({
        id,
        driver_id: e.driverId,
        kind: e.kind,
        amount: e.amount,
        ride_id: e.rideId ?? null,
        note: e.note ?? null,
        created_by: e.createdBy ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['ride_id', 'kind']).where('ride_id', 'is not', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return inserted?.id ?? null;
  }

  async entries(driverId: string, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('driver_ledger')
      .select(['id', 'kind', 'amount', 'ride_id as rideId', 'note', 'created_at as createdAt'])
      .where('driver_id', '=', driverId)
      .$if(Boolean(cursor), (q) => q.where('id', '<', cursor!))
      .orderBy('id', 'desc')
      .limit(50)
      .execute();
    return { items: rows, nextCursor: rows.length === 50 ? rows.at(-1)!.id : null };
  }

  /** Balance and whether it still allows working (going online, getting offers). */
  async standing(driverId: string, db: Db = this.db.kysely) {
    const [balance, billing] = await Promise.all([
      this.balance(driverId, db),
      this.settings.billing(db),
    ]);
    return { balance, minBalance: billing.min_balance, canWork: balance >= billing.min_balance };
  }

  /** Operator: cash handed in at the office (top-up) or a correction (adjustment). */
  async record(
    adminId: string,
    driverId: string,
    input: { kind: 'topup' | 'adjustment'; amount: number; note: string | null },
  ) {
    if (input.kind === 'topup' && input.amount <= 0) {
      throw new BadRequestException('To‘ldirish summasi musbat bo‘lishi kerak');
    }
    if (input.kind === 'adjustment' && !input.note) {
      throw new BadRequestException('Tuzatish uchun izoh yozing');
    }
    await this.db.transaction(async (trx) => {
      await this.lockDriver(trx, driverId);
      // an operator's double click must not credit the cash twice: the same entry by the
      // same operator within a minute is refused (a real second top-up can wait a minute)
      const repeat = await trx
        .selectFrom('driver_ledger')
        .select('id')
        .where('driver_id', '=', driverId)
        .where('kind', '=', input.kind)
        .where('amount', '=', input.amount)
        .where('created_by', '=', adminId)
        .where('created_at', '>', sql<Date>`now() - interval '60 seconds'`)
        .executeTakeFirst();
      if (repeat) {
        throw new ConflictException('Xuddi shunday yozuv hozirgina qo‘shildi: takrorlanmadimi?');
      }
      await this.post(trx, { driverId, ...input, createdBy: adminId });
    });
    return this.standing(driverId);
  }

  /** The pass covering `at`, if any. */
  async activePass(driverId: string, at: Date, db: Db = this.db.kysely) {
    return (
      (await db
        .selectFrom('driver_passes')
        .select(['id', 'kind', 'starts_at as startsAt', 'ends_at as endsAt', 'price'])
        .where('driver_id', '=', driverId)
        .where('starts_at', '<=', at)
        .where('ends_at', '>', at)
        .orderBy('ends_at', 'desc')
        .executeTakeFirst()) ?? null
    );
  }

  async passes(driverId: string) {
    return this.db.kysely
      .selectFrom('driver_passes')
      .select(['id', 'kind', 'starts_at as startsAt', 'ends_at as endsAt', 'price'])
      .where('driver_id', '=', driverId)
      .orderBy('ends_at', 'desc')
      .limit(20)
      .execute();
  }

  /**
   * Buys a day or week pass from the balance. It starts now, or when the driver's last
   * pass ends, so buying ahead never wastes days. The balance must cover the price.
   */
  async buyPass(driverId: string, kind: PassKind, now = new Date()) {
    const billing = await this.settings.billing();
    const price = kind === 'day' ? billing.pass_day_price : billing.pass_week_price;
    return this.db.transaction(async (trx) => {
      await this.lockDriver(trx, driverId);
      const balance = await this.balance(driverId, trx);
      if (balance < price) {
        throw new ConflictException(
          msg('Balansda mablag‘ yetarli emas: {0} so‘m kerak, {1} so‘m bor', price, balance),
        );
      }
      const last = await trx
        .selectFrom('driver_passes')
        .select('ends_at')
        .where('driver_id', '=', driverId)
        .where('ends_at', '>', now)
        .orderBy('ends_at', 'desc')
        .executeTakeFirst();
      const startsAt = last ? last.ends_at : now;
      const endsAt = new Date(startsAt.getTime() + PASS_DAYS[kind] * 86_400_000);
      const ledgerId = await this.post(trx, {
        driverId,
        kind: 'pass',
        amount: -price,
        note: kind === 'day' ? 'Kunlik abonement' : 'Haftalik abonement',
      });
      const id = uuidv7();
      await trx
        .insertInto('driver_passes')
        .values({
          id,
          driver_id: driverId,
          kind,
          starts_at: startsAt,
          ends_at: endsAt,
          price,
          ledger_id: ledgerId,
        })
        .execute();
      return { id, kind, startsAt, endsAt, price, balance: balance - price };
    });
  }

  /** Serialises money movements of one driver. */
  private async lockDriver(trx: Tx, driverId: string): Promise<void> {
    const row = await trx
      .selectFrom('drivers')
      .select('user_id')
      .where('user_id', '=', driverId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Haydovchi topilmadi');
  }
}
