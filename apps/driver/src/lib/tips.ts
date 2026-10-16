import { t } from '../i18n/dictionary';
import { som } from './format';

/** A ride's tip as the driver sees it (GET /driver/rides/:id/tip). */
export interface DriverTip {
  id: string;
  rideId: string;
  amount: number;
  method: 'cash' | 'card';
  status: 'recorded' | 'awaiting_payment' | 'paid' | 'failed' | 'refunded';
  paidAt: string | null;
  createdAt: string;
}

/**
 * What the driver reads about a tip: cash the rider hands over (only recorded), a card tip
 * credited whole to the balance; nothing for one not paid.
 */
export function tipLine(tip: Pick<DriverTip, 'amount' | 'method' | 'status'>): string | null {
  switch (tip.status) {
    case 'recorded':
      return t('ride.tips.cash', { amount: som(tip.amount) });
    case 'paid':
      return t('ride.tips.paid', { amount: som(tip.amount) });
    case 'awaiting_payment':
      return t('ride.tips.awaiting', { amount: som(tip.amount) });
    default:
      return null;
  }
}
