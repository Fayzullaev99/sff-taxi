/**
 * Tips ("choychaqa") on the rating screen, without React Native (unit-tested): reading a
 * typed amount, what the button says, the line after the tip.
 */
import type { RidePayment } from '../api/types';
import { t } from '../i18n/dictionary';
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
  if (amount === null) return t('ride.tip.errors.notNumber');
  if (amount < rules.min) return t('ride.tip.errors.atLeast', { amount: formatMoney(rules.min) });
  if (amount > rules.max) return t('ride.tip.errors.atMost', { amount: formatMoney(rules.max) });
  if (amount % 100 !== 0) return t('ride.tip.errors.multiple');
  return null;
}

/** The line once a tip is given (or why it waits). */
export function tipStatusText(tip: Pick<TipView, 'amount' | 'method' | 'status'>): string {
  const amount = formatMoney(tip.amount);
  switch (tip.status) {
    case 'recorded':
      return t('ride.tip.status.recorded', { amount });
    case 'paid':
      return t('ride.tip.status.paid', { amount });
    case 'awaiting_payment':
      return t('ride.tip.status.awaitingPayment', { amount });
    case 'refunded':
      return t('ride.tip.status.refunded', { amount });
    case 'failed':
      return t('ride.tip.status.failed');
  }
}

/** The tip can still be given or changed (nothing final yet). */
export function tipEditable(tip: Pick<TipView, 'status'> | null, rules: TipRulesView): boolean {
  if (!rules.enabled || !rules.open) return false;
  return !tip || tip.status === 'failed' || tip.status === 'awaiting_payment';
}
