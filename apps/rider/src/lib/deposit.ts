/**
 * Deposits (pure, unit-tested): a ride booked for later and a seat on the trip board are
 * held once part of the price is paid by card; the rest is cash to the driver. Cancelled in
 * time the deposit comes back, late it is the waiting driver's (docs/payments.md).
 */
import type { QuoteDeposit, RideClass } from '../api/types';
import { formatDateTime, formatMoney } from './format';

/** A ride for later: cancelled at least this long before its time, the deposit comes back. */
export const RIDE_FREE_CANCEL_MINUTES = 60;

/** The API's rule: the share rounded up to 1 000 so‘m, at least the minimum, at most the price. */
export function depositAmount(price: number, rules: { percent: number; min: number }): number {
  if (rules.percent <= 0 || price <= 0) return 0;
  const share = Math.ceil((price * rules.percent) / 100 / 1000) * 1000;
  return Math.min(price, Math.max(rules.min, share));
}

/**
 * The deposit a ride for later asks for: the quote's own amount for the class, or (a
 * different price, e.g. seats on a fixed route) the same rule applied to that price.
 */
export function rideDeposit(
  deposit: QuoteDeposit | null | undefined,
  rideClass: RideClass,
  price: number,
  classTotal: number,
): number | null {
  if (!deposit) return null;
  const listed = deposit.amounts?.[rideClass] ?? (rideClass === 'economy' ? deposit.amount : null);
  const amount =
    price === classTotal && typeof listed === 'number' ? listed : depositAmount(price, deposit);
  return amount > 0 ? amount : null;
}

/** When the free cancellation of a ride for later ends. */
export function freeCancelUntil(scheduledFor: string, freeMinutes = RIDE_FREE_CANCEL_MINUTES) {
  return new Date(new Date(scheduledFor).getTime() - freeMinutes * 60_000);
}

/** The rules a rider agrees to before paying a ride for later's deposit. */
export function rideDepositRules(
  amount: number,
  price: number,
  scheduledFor: string | null,
  freeMinutes = RIDE_FREE_CANCEL_MINUTES,
): string {
  const until = scheduledFor
    ? ` (${formatDateTime(freeCancelUntil(scheduledFor, freeMinutes))} gacha)`
    : '';
  return (
    `Buyurtma ${formatMoney(amount)} oldindan to‘lov (depozit) kartadan to‘langach tasdiqlanadi, ` +
    `qolgan ${formatMoney(Math.max(0, price - amount))} naqd haydovchiga. ` +
    `Vaqtidan ${freeMinutes} daqiqa oldingacha${until} bekor qilsangiz, depozit qaytariladi; ` +
    `keyin bekor qilinsa, u kutgan haydovchiga qoladi.`
  );
}

/**
 * Cancelling a ride for later whose deposit was paid: refunded while at least the free
 * minutes are left before its time, else kept (the driver's compensation).
 */
export function rideDepositCancel(
  deposit: number,
  scheduledFor: string | null,
  now: Date,
  freeMinutes = RIDE_FREE_CANCEL_MINUTES,
): { refund: boolean; message: string } {
  const free =
    scheduledFor !== null && now.getTime() < freeCancelUntil(scheduledFor, freeMinutes).getTime();
  return free
    ? { refund: true, message: `Depozit ${formatMoney(deposit)} kartangizga qaytariladi.` }
    : {
        refund: false,
        message: `Vaqtiga ${freeMinutes} daqiqadan kam qoldi: depozit ${formatMoney(deposit)} haydovchiga qoladi.`,
      };
}

/** The trip board's deposit rules (GET intercity/trips/:id → depositRules). */
export interface BookingDepositRules {
  percent: number;
  min: number;
  paymentMinutes: number;
}

/** What booking seats costs now by card and later in cash; null when deposits are off. */
export function bookingDeposit(
  price: number,
  rules: BookingDepositRules | null | undefined,
): { deposit: number; cash: number } | null {
  if (!rules) return null;
  const deposit = depositAmount(price, rules);
  return deposit > 0 ? { deposit, cash: price - deposit } : null;
}

export function bookingDepositRules(
  d: { deposit: number; cash: number },
  paymentMinutes: number,
  freeCancelMinutes: number,
): string {
  return (
    `Joy ${formatMoney(d.deposit)} oldindan to‘lov (depozit) kartadan ${paymentMinutes} daqiqa ichida ` +
    `to‘langach band bo‘ladi, qolgan ${formatMoney(d.cash)} naqd haydovchiga. ` +
    `Jo‘nashdan ${freeCancelMinutes} daqiqa oldingacha bekor qilsangiz, depozit qaytariladi; ` +
    `keyin yoki kelmasangiz, haydovchiga qoladi.`
  );
}
