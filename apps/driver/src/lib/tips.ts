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
      return `Yo‘lovchi ${som(tip.amount)} choychaqa beradi (naqd)`;
    case 'paid':
      return `Choychaqa ${som(tip.amount)} kartadan — balansingizga to‘liq tushdi`;
    case 'awaiting_payment':
      return `Yo‘lovchi ${som(tip.amount)} choychaqani kartadan to‘lamoqda`;
    default:
      return null;
  }
}
