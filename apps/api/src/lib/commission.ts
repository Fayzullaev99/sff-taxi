import { tashkentDate } from './driver-rules.js';

/**
 * What a completed ride costs the driver (market analysis §6.3 "Driver fee model"):
 * - the self-employed turnover tax the platform withholds as tax agent (1%), always;
 * - the platform commission: nothing during the launch promo; on city rides nothing while
 *   a day/week pass runs, otherwise a percentage capped per Tashkent day and week; on
 *   intercity rides a percentage capped per ride (outside the daily cap).
 */
export interface BillingRulesInput {
  promo_until: string | null;
  commission_percent: number;
  daily_cap: number;
  weekly_cap: number;
  intercity_commission_percent: number;
  intercity_trip_cap: number;
  tax_percent: number;
}

export type CommissionNote = 'promo' | 'pass' | 'daily_cap' | 'weekly_cap' | 'trip_cap' | null;

export interface ChargeInput {
  fare: number;
  kind: 'city' | 'intercity';
  completedAt: Date;
  rules: BillingRulesInput;
  hasPass: boolean;
  /** Commission already charged on city rides this Tashkent day and week. */
  chargedToday: number;
  chargedThisWeek: number;
}

export interface Charges {
  tax: number;
  commission: number;
  note: CommissionNote;
}

export function rideCharges(i: ChargeInput): Charges {
  const tax = Math.round((i.fare * i.rules.tax_percent) / 100);
  if (i.rules.promo_until && tashkentDate(i.completedAt) <= i.rules.promo_until) {
    return { tax, commission: 0, note: 'promo' };
  }
  if (i.kind === 'intercity') {
    const full = Math.round((i.fare * i.rules.intercity_commission_percent) / 100);
    const cap = i.rules.intercity_trip_cap;
    return cap > 0 && full > cap
      ? { tax, commission: cap, note: 'trip_cap' }
      : { tax, commission: full, note: null };
  }
  if (i.hasPass) return { tax, commission: 0, note: 'pass' };
  const full = Math.round((i.fare * i.rules.commission_percent) / 100);
  const dayLeft =
    i.rules.daily_cap > 0 ? Math.max(0, i.rules.daily_cap - i.chargedToday) : Infinity;
  const weekLeft =
    i.rules.weekly_cap > 0 ? Math.max(0, i.rules.weekly_cap - i.chargedThisWeek) : Infinity;
  const commission = Math.min(full, dayLeft, weekLeft);
  const note: CommissionNote =
    commission >= full ? null : weekLeft < dayLeft ? 'weekly_cap' : 'daily_cap';
  return { tax, commission, note };
}

const TASHKENT_MS = 5 * 3600_000;

/** The UTC instant when the Tashkent day containing `at` began. */
export function tashkentDayStart(at: Date): Date {
  const local = new Date(at.getTime() + TASHKENT_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TASHKENT_MS,
  );
}

/** The UTC instant when the Tashkent Monday-to-Sunday week containing `at` began. */
export function tashkentWeekStart(at: Date): Date {
  const day = tashkentDayStart(at);
  const weekday = new Date(day.getTime() + TASHKENT_MS).getUTCDay(); // 0 = Sunday
  return new Date(day.getTime() - ((weekday + 6) % 7) * 86_400_000);
}

/** Tashkent calendar month, YYYY-MM: the tax reporting period. */
export function tashkentMonth(at: Date): string {
  return tashkentDate(at).slice(0, 7);
}
