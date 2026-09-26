import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { BusinessCalendar } from '../../core/clock/business-calendar.js';
import { Database, type Tx } from '../../core/db/database.js';
import {
  type Charges,
  rideCharges,
  tashkentDayStart,
  tashkentMonth,
  tashkentWeekStart,
} from '../../lib/commission.js';
import { SettingsService } from '../settings/settings.module.js';
import { LedgerService } from './ledger.service.js';

export interface CompletedRide {
  id: string;
  number: number;
  driverId: string;
  kind: 'city' | 'intercity';
  fareTotal: number;
  completedAt: Date;
}

/**
 * Charges a completed ride to the driver's balance: the withheld tax (with its row for the
 * monthly remittance report) and the platform commission. Runs in the completion
 * transaction; the ledger's (ride, kind) uniqueness keeps a retry from charging twice.
 */
@Injectable()
export class RideChargesService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly calendar: BusinessCalendar,
  ) {}

  async charge(trx: Tx, ride: CompletedRide): Promise<Charges> {
    const [rules, driver, pass] = await Promise.all([
      this.settings.billing(trx),
      trx
        .selectFrom('drivers')
        .select('pinfl')
        .where('user_id', '=', ride.driverId)
        .executeTakeFirst(),
      this.ledger.activePass(ride.driverId, ride.completedAt, trx),
    ]);
    if (!driver) throw new NotFoundException('Haydovchi topilmadi');
    // the Tashkent day, week and month the ride counts in (the business calendar)
    const at = this.calendar.at(ride.completedAt);
    const [chargedToday, chargedThisWeek] = await Promise.all([
      this.cityCommissionSince(trx, ride.driverId, this.calendar.real(tashkentDayStart(at))),
      this.cityCommissionSince(trx, ride.driverId, this.calendar.real(tashkentWeekStart(at))),
    ]);
    const charges = rideCharges({
      fare: ride.fareTotal,
      kind: ride.kind,
      completedAt: at,
      rules,
      hasPass: pass !== null,
      chargedToday,
      chargedThisWeek,
    });

    const taxLedgerId = await this.ledger.post(trx, {
      driverId: ride.driverId,
      kind: 'tax',
      amount: -charges.tax,
      rideId: ride.id,
      note: `Aylanma solig‘i ${rules.tax_percent}% — safar #${ride.number}`,
    });
    await this.ledger.post(trx, {
      driverId: ride.driverId,
      kind: 'commission',
      amount: -charges.commission,
      rideId: ride.id,
      note: `Komissiya — safar #${ride.number}`,
    });
    await trx
      .insertInto('tax_withholdings')
      .values({
        id: uuidv7(),
        ride_id: ride.id,
        driver_id: ride.driverId,
        pinfl: driver.pinfl,
        period: tashkentMonth(at),
        base_amount: ride.fareTotal,
        rate_percent: rules.tax_percent,
        amount: charges.tax,
        ledger_id: taxLedgerId,
      })
      .onConflict((oc) => oc.column('ride_id').doNothing())
      .execute();
    await trx
      .updateTable('rides')
      .set({ commission: charges.commission, commission_note: charges.note, tax: charges.tax })
      .where('id', '=', ride.id)
      .execute();
    return charges;
  }

  /**
   * Charges a completed intercity booking (seats on a trip, cash to the driver): the 1% tax
   * and the intercity commission capped per booking, never counted in the city caps.
   */
  async chargeBooking(
    trx: Tx,
    b: { id: string; number: number; driverId: string; fare: number; completedAt: Date },
  ): Promise<Charges> {
    const [rules, driver] = await Promise.all([
      this.settings.billing(trx),
      trx
        .selectFrom('drivers')
        .select('pinfl')
        .where('user_id', '=', b.driverId)
        .executeTakeFirst(),
    ]);
    if (!driver) throw new NotFoundException('Haydovchi topilmadi');
    const at = this.calendar.at(b.completedAt);
    const charges = rideCharges({
      fare: b.fare,
      kind: 'intercity',
      completedAt: at,
      rules,
      hasPass: false,
      chargedToday: 0,
      chargedThisWeek: 0,
    });
    const taxLedgerId = await this.ledger.post(trx, {
      driverId: b.driverId,
      kind: 'tax',
      amount: -charges.tax,
      bookingId: b.id,
      note: `Aylanma solig‘i ${rules.tax_percent}% — shaharlararo bron #${b.number}`,
    });
    await this.ledger.post(trx, {
      driverId: b.driverId,
      kind: 'commission',
      amount: -charges.commission,
      bookingId: b.id,
      note: `Komissiya — shaharlararo bron #${b.number}`,
    });
    await trx
      .insertInto('tax_withholdings')
      .values({
        id: uuidv7(),
        booking_id: b.id,
        driver_id: b.driverId,
        pinfl: driver.pinfl,
        period: tashkentMonth(at),
        base_amount: b.fare,
        rate_percent: rules.tax_percent,
        amount: charges.tax,
        ledger_id: taxLedgerId,
      })
      .onConflict((oc) => oc.column('booking_id').doNothing())
      .execute();
    await trx
      .updateTable('intercity_bookings')
      .set({ commission: charges.commission, commission_note: charges.note, tax: charges.tax })
      .where('id', '=', b.id)
      .execute();
    return charges;
  }

  /** Commission charged on city rides completed since `since` (real time; daily and weekly caps). */
  private async cityCommissionSince(trx: Tx, driverId: string, since: Date): Promise<number> {
    const row = await trx
      .selectFrom('driver_ledger as l')
      .innerJoin('rides as r', 'r.id', 'l.ride_id')
      .select(sql<string>`coalesce(-sum(l.amount), 0)`.as('total'))
      .where('l.driver_id', '=', driverId)
      .where('l.kind', '=', 'commission')
      .where('r.kind', '=', 'city')
      .where('r.completed_at', '>=', since)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Earnings of a driver between two instants: what riders paid and what was deducted. */
  async earnings(driverId: string, from: Date, to: Date) {
    const row = await this.db.kysely
      .selectFrom('rides')
      .select([
        sql<string>`count(*)`.as('rides'),
        sql<string>`coalesce(sum(fare_total), 0)`.as('fares'),
        sql<string>`coalesce(sum(commission), 0)`.as('commission'),
        sql<string>`coalesce(sum(tax), 0)`.as('tax'),
        // card rides were prepaid; only their paid waiting is collected in cash
        sql<string>`coalesce(sum(case when payment_method = 'cash' then fare_total else waiting_fee end), 0)`.as(
          'cash',
        ),
      ])
      .where('driver_id', '=', driverId)
      .where('status', '=', 'completed')
      .where('completed_at', '>=', from)
      .where('completed_at', '<', to)
      .executeTakeFirstOrThrow();
    // intercity seats are paid in cash to the driver
    const seats = await this.db.kysely
      .selectFrom('intercity_bookings as b')
      .innerJoin('intercity_trips as t', 't.id', 'b.trip_id')
      .select([
        sql<string>`count(*)`.as('bookings'),
        sql<string>`coalesce(sum(b.price), 0)`.as('fares'),
        sql<string>`coalesce(sum(b.commission), 0)`.as('commission'),
        sql<string>`coalesce(sum(b.tax), 0)`.as('tax'),
      ])
      .where('t.driver_id', '=', driverId)
      .where('b.status', '=', 'completed')
      .where('b.completed_at', '>=', from)
      .where('b.completed_at', '<', to)
      .executeTakeFirstOrThrow();
    const fares = Number(row.fares) + Number(seats.fares);
    const commission = Number(row.commission) + Number(seats.commission);
    const tax = Number(row.tax) + Number(seats.tax);
    return {
      from,
      to,
      rides: Number(row.rides),
      intercityBookings: Number(seats.bookings),
      fares,
      cash: Number(row.cash) + Number(seats.fares),
      commission,
      tax,
      net: fares - commission - tax,
    };
  }

  /** The monthly withholding report per driver, for the tax authority. */
  async taxReport(period: string) {
    const rows = await this.db.kysely
      .selectFrom('tax_withholdings as t')
      .innerJoin('drivers as d', 'd.user_id', 't.driver_id')
      .select([
        't.driver_id as driverId',
        'd.full_name as fullName',
        't.pinfl',
        sql<string>`count(*)`.as('rides'),
        sql<string>`sum(t.base_amount)`.as('base'),
        sql<string>`sum(t.amount)`.as('amount'),
        sql<string>`count(t.remitted_at)`.as('remittedRides'),
      ])
      .where('t.period', '=', period)
      .groupBy(['t.driver_id', 'd.full_name', 't.pinfl'])
      .orderBy('d.full_name')
      .execute();
    const drivers = rows.map((r) => ({
      driverId: r.driverId,
      fullName: r.fullName,
      pinfl: r.pinfl,
      rides: Number(r.rides),
      base: Number(r.base),
      amount: Number(r.amount),
      remitted: Number(r.remittedRides) === Number(r.rides),
    }));
    return {
      period,
      drivers,
      totals: {
        rides: drivers.reduce((s, d) => s + d.rides, 0),
        base: drivers.reduce((s, d) => s + d.base, 0),
        amount: drivers.reduce((s, d) => s + d.amount, 0),
      },
    };
  }

  /** Records that a period's withheld tax was paid to the budget. */
  async markRemitted(period: string, reference: string) {
    const res = await this.db.kysely
      .updateTable('tax_withholdings')
      .set({ remitted_at: new Date(), remittance_ref: reference })
      .where('period', '=', period)
      .where('remitted_at', 'is', null)
      .executeTakeFirst();
    return { period, rows: Number(res.numUpdatedRows) };
  }
}
