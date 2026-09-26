import { som } from './format';

/**
 * The driver's money rules (market analysis §6.3 "Driver fee model", API billing settings).
 * The API does not publish its billing settings to drivers yet (API gap), so these are the
 * launch defaults; every charge itself is computed by the API and shown from the ledger.
 */
export const BILLING = {
  /** 0% platform commission on rides completed up to this Tashkent date. */
  promoUntil: '2026-12-31',
  commissionPercent: 5,
  dailyCap: 10_000,
  weeklyCap: 55_000,
  intercityPercent: 5,
  intercityTripCap: 10_000,
  taxPercent: 1,
  passDay: 9_000,
  passWeek: 50_000,
} as const;

export interface PromoStatus {
  active: boolean;
  /** Days left including today (0 when over). */
  daysLeft: number;
  text: string;
}

/** `today` and `until` are Tashkent dates (YYYY-MM-DD). */
export function promoStatus(today: string, until: string | null = BILLING.promoUntil): PromoStatus {
  if (!until || today > until) {
    return {
      active: false,
      daysLeft: 0,
      text: `Komissiya ${BILLING.commissionPercent}%, kuniga ko‘pi bilan ${som(BILLING.dailyCap)}, haftasiga ${som(BILLING.weeklyCap)}`,
    };
  }
  const days =
    Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) +
    1;
  const [, m, d] = until.split('-');
  return {
    active: true,
    daysLeft: days,
    text: `${d}.${m} gacha 0% komissiya — faqat qonuniy 1% soliq ushlanadi`,
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
export function passBreakEven(kind: 'day' | 'week'): number {
  const price = kind === 'day' ? BILLING.passDay : BILLING.passWeek;
  return Math.ceil((price * 100) / BILLING.commissionPercent);
}

/** Whether buying a pass makes sense now; the reason when it does not. */
export function passAdvice(promo: PromoStatus, hasActivePass: boolean): string | null {
  if (promo.active) return 'Aksiya davomida komissiya 0% — abonement kerak emas.';
  if (hasActivePass) return 'Abonementingiz amalda. Yangisi tugashi bilan boshlanadi.';
  return null;
}

/** "Kunlik abonement · 26.09 23:59 gacha" */
export function passLabel(pass: { kind: string; endsAt: string }): string {
  const d = new Date(pass.endsAt);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const when = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pass.kind === 'week' ? 'Haftalik' : 'Kunlik'} abonement · ${when} gacha`;
}

/** How to put money on the balance while card top-ups are not wired (Payme/Click: API backlog). */
export const TOP_UP_STEPS = [
  'SFF Taxi ofisiga keling (Guliston) va operatorga telefon raqamingizni ayting.',
  'Naqd pul topshiring — balans darhol to‘ldiriladi, ilovada ko‘rinadi.',
  'Payme / Click orqali to‘ldirish tez orada qo‘shiladi.',
];
