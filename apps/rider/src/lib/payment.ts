/**
 * Card rides (pure, unit-tested): the fare is prepaid through Payme or Click before a
 * driver is searched for. The order answers `awaiting_payment` with checkout links; the
 * ride is cancelled when it is not paid within 10 minutes; a paid ride that is cancelled
 * is refunded in full.
 */
import type {
  CardProvider,
  PaymentMethod,
  RidePayment,
  RidePaymentStatus,
  RideStatus,
} from '../api/types';
import { t } from '../i18n/dictionary';
import { formatDateTime, formatMoney } from './format';

export const PROVIDER_LABELS: Record<CardProvider, string> = { payme: 'Payme', click: 'Click' };

/** Payme first (the most used wallet in Uzbekistan), then Click. */
const PROVIDER_ORDER: CardProvider[] = ['payme', 'click'];

/** The card label on the payment choice: "Karta (Payme, Click)". */
export function cardLabel(providers: readonly CardProvider[] | null | undefined): string {
  const names = PROVIDER_ORDER.filter((p) => providers?.includes(p)).map((p) => PROVIDER_LABELS[p]);
  return names.length
    ? t('payments.cardWith', { providers: names.join(', ') })
    : t('common.payment.card');
}

export interface CheckoutLink {
  provider: CardProvider;
  label: string;
  url: string;
}

/** Where the rider can pay now, in a stable order; empty once it cannot be paid. */
export function checkoutLinks(payment: RidePayment | null | undefined): CheckoutLink[] {
  const checkout = payment?.status === 'pending' ? payment.checkout : null;
  if (!checkout) return [];
  return PROVIDER_ORDER.flatMap((provider) => {
    const url = checkout[provider];
    return url && /^https:\/\//.test(url)
      ? [{ provider, label: t('payments.payVia', { provider: PROVIDER_LABELS[provider] }), url }]
      : [];
  });
}

/** Seconds left to pay (0 once the window closed); null without a pending payment. */
export function paymentSecondsLeft(
  payment: RidePayment | null | undefined,
  now: Date,
): number | null {
  if (!payment || payment.status !== 'pending') return null;
  return Math.max(0, Math.ceil((new Date(payment.expiresAt).getTime() - now.getTime()) / 1000));
}

/**
 * A line about the money of a card ride that did not happen or was paid: shown on the
 * summary of a cancelled card ride (refunds) and of a completed one.
 */
export function cardMoneyNote(ride: {
  status: RideStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: RidePaymentStatus;
  payment?: RidePayment | null;
  fare: { quoted: number };
}): { tone: 'info' | 'success' | 'warning'; title: string; message: string } | null {
  if (ride.paymentMethod !== 'card') return null;
  const amount = formatMoney(ride.payment?.amount ?? ride.fare.quoted);
  switch (ride.paymentStatus) {
    case 'refund_pending':
      return {
        tone: 'info',
        title: t('payments.refundPending.title'),
        message: t('payments.refundPending.message', { amount }),
      };
    case 'refunded':
      return {
        tone: 'success',
        title: t('payments.refunded.title'),
        message: ride.payment?.refundedAt
          ? t('payments.refunded.messageAt', {
              amount,
              when: formatDateTime(ride.payment.refundedAt),
            })
          : t('payments.refunded.message', { amount }),
      };
    case 'failed':
      return {
        tone: 'warning',
        title: t('payments.failed.title'),
        message: t('payments.failed.message'),
      };
    case 'not_charged':
      return ride.status === 'cancelled'
        ? {
            tone: 'info',
            title: t('payments.notCharged.title'),
            message: t('payments.notCharged.message'),
          }
        : null;
    case 'paid':
      return ride.status === 'completed'
        ? {
            tone: 'success',
            title: t('payments.paid.title'),
            message: t('payments.paid.message', { amount }),
          }
        : null;
    default:
      return null;
  }
}
