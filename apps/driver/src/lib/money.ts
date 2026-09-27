import { type BillingRules, DEFAULT_BILLING } from './driver-config';
import { dateTime, som } from './format';

/**
 * The driver's money rules (market analysis §6.3 "Driver fee model"). The numbers come from
 * `GET /v1/driver/config` (lib/driver-config); every charge itself is computed by the API
 * and shown from the ledger.
 */

export interface PromoStatus {
  active: boolean;
  /** Days left including today (0 when over). */
  daysLeft: number;
  text: string;
}

/** `today` and `billing.promoUntil` are Tashkent dates (YYYY-MM-DD). */
export function promoStatus(today: string, billing: BillingRules = DEFAULT_BILLING): PromoStatus {
  const until = billing.promoUntil;
  if (!until || today > until) {
    return {
      active: false,
      daysLeft: 0,
      text: `Komissiya ${billing.commissionPercent}%, kuniga ko‘pi bilan ${som(billing.dailyCap)}, haftasiga ${som(billing.weeklyCap)}`,
    };
  }
  const days =
    Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) +
    1;
  const [, m, d] = until.split('-');
  return {
    active: true,
    daysLeft: days,
    text: `${d}.${m} gacha 0% komissiya — faqat qonuniy ${billing.taxPercent}% soliq ushlanadi`,
  };
}

export type BalanceLevel = 'ok' | 'low' | 'blocked';

export interface BalanceStatus {
  level: BalanceLevel;
  canWork: boolean;
  /** How much to top up to be able to go online (0 when already allowed). */
  shortBy: number;
}

/** Below the minimum no shift and no offers; within 10 000 above it the driver is warned. */
export const LOW_BALANCE_MARGIN = 10_000;

export function balanceStatus(balance: number, minBalance: number): BalanceStatus {
  if (balance < minBalance) {
    return { level: 'blocked', canWork: false, shortBy: minBalance - balance };
  }
  return {
    level: balance - minBalance < LOW_BALANCE_MARGIN ? 'low' : 'ok',
    canWork: true,
    shortBy: 0,
  };
}

/**
 * City fares per day from which a pass is cheaper than the commission. With a daily cap,
 * a day pass only pays off if it is below the cap.
 */
export function passBreakEven(
  kind: 'day' | 'week',
  billing: BillingRules = DEFAULT_BILLING,
): number {
  const price = kind === 'day' ? billing.passDay : billing.passWeek;
  if (billing.commissionPercent <= 0) return Infinity;
  return Math.ceil((price * 100) / billing.commissionPercent);
}

/** Whether buying a pass makes sense now; the reason when it does not. */
export function passAdvice(promo: PromoStatus, hasActivePass: boolean): string | null {
  if (promo.active) return 'Aksiya davomida komissiya 0% — abonement kerak emas.';
  if (hasActivePass) return 'Abonementingiz amalda. Yangisi tugashi bilan boshlanadi.';
  return null;
}

/** "Kunlik abonement · 26.09 23:59 gacha" */
export function passLabel(pass: { kind: string; endsAt: string }): string {
  // Tashkent time, like every other time in the app
  const when = dateTime(pass.endsAt);
  return `${pass.kind === 'week' ? 'Haftalik' : 'Kunlik'} abonement · ${when} gacha`;
}

/** How to put cash on the balance at the office. */
export const OFFICE_TOP_UP_STEPS = [
  'SFF Taxi ofisiga keling va operatorga telefon raqamingizni ayting.',
  'Naqd pul topshiring — balans darhol to‘ldiriladi, ilovada ko‘rinadi.',
];
