/**
 * Tips ("choychaqa") on the rating screen, without React Native (unit-tested): reading a
 * typed amount, what the button says, the line after the tip.
 */
import type { RidePayment } from '../api/types';
import { formatMoney } from './format';

export interface TipView {
  id: string;
  rideId: string;
  amount: number;
  method: 'cash' | 'card';
  status: 'recorded' | 'awaiting_payment' | 'paid' | 'failed' | 'refunded';
  paidAt: string | null;
  createdAt: string;
  payment: RidePayment | null;
}

export interface TipRulesView {
  enabled: boolean;
  presets: number[];
  min: number;
  max: number;
  /** A card tip can be paid (Payme/Click configured and allowed). */
  card: boolean;
  until: string | null;
  open: boolean;
}

/** "5 000", "5000", "5 000 so'm" -> 5000; null when not a whole amount. */
export function parseTipAmount(text: string): number | null {
  const digits = text.replace(/[\s\u00a0.,']/g, '').replace(/so.?m$/i, '');
  if (!/^\d{1,9}$/.test(digits)) return null;
  return Number(digits);
}

/** Why the amount cannot be given, or null. */
export function tipAmountError(amount: number | null, rules: Pick<TipRulesView, 'min' | 'max'>) {
  if (amount === null) return 'Summani raqam bilan yozing';
  if (amount < rules.min) return `Kamida ${formatMoney(rules.min)}`;
  if (amount > rules.max) return `Ko‘pi bilan ${formatMoney(rules.max)}`;
  if (amount % 100 !== 0) return 'Summani 100 so‘mga karrali yozing';
  return null;
}

/** The line once a tip is given (or why it waits). */
export function tipStatusText(tip: Pick<TipView, 'amount' | 'method' | 'status'>): string {
  const sum = formatMoney(tip.amount);
  switch (tip.status) {
    case 'recorded':
      return `Rahmat! ${sum} choychaqani haydovchiga naqd bering.`;
    case 'paid':
      return `Rahmat! ${sum} choychaqa kartadan to‘landi va to‘liq haydovchiga yetadi.`;
    case 'awaiting_payment':
      return `${sum} choychaqa: to‘lovni yakunlang.`;
    case 'refunded':
      return `${sum} choychaqa kartangizga qaytarildi.`;
    case 'failed':
      return 'Karta orqali to‘lov amalga oshmadi: qayta urinib ko‘ring yoki naqd bering.';
  }
}

/** The tip can still be given or changed (nothing final yet). */
export function tipEditable(tip: Pick<TipView, 'status'> | null, rules: TipRulesView): boolean {
  if (!rules.enabled || !rules.open) return false;
  return !tip || tip.status === 'failed' || tip.status === 'awaiting_payment';
}
