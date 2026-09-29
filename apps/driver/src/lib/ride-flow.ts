import { isApiError } from './api-client';
import { som } from './format';

/** The driver's ride steps (API: POST /v1/driver/rides/:id/arrive|start|complete). */
export type RideAction = 'arrive' | 'start' | 'complete';

export interface RideStep {
  /** What the driver is doing now. */
  title: string;
  /** The one big button. */
  button: string;
  action: RideAction;
  /** Where the navigation button leads (null: standing at the pickup). */
  navigateTo: 'pickup' | 'dropoff' | null;
}

export const STEPS: Record<string, RideStep> = {
  driver_assigned: {
    title: 'Yo‘lovchiga boring',
    button: 'Yetib keldim',
    action: 'arrive',
    navigateTo: 'pickup',
  },
  driver_arrived: {
    title: 'Yo‘lovchini kuting',
    button: 'Yo‘lovchi chiqdi — Boshlash',
    action: 'start',
    navigateTo: null,
  },
  in_progress: {
    title: 'Manzilga boring',
    button: 'Yakunlash',
    action: 'complete',
    navigateTo: 'dropoff',
  },
};

export function stepOf(status: string): RideStep | null {
  return STEPS[status] ?? null;
}

/** Whether the driver may give the ride up (the API refuses once it started). */
export function canCancel(status: string): boolean {
  return status === 'driver_assigned' || status === 'driver_arrived';
}

/** Driver cancel reasons (API DRIVER_CANCEL_REASONS). */
export type CancelReason =
  'rider_no_show' | 'car_problem' | 'cannot_reach' | 'rider_asked' | 'other';

export interface CancelChoice {
  code: CancelReason;
  label: string;
  /** Why it cannot be picked now; null when it can. */
  disabledBecause: string | null;
  /** What happens to the ride and to the driver. */
  effect: string;
}

const BACK_TO_DISPATCH =
  'Buyurtma boshqa haydovchiga beriladi. Bu ishonchlilik ko‘rsatkichingizni pasaytiradi.';

/**
 * The reasons with what each does. A no-show ends the ride (with the cancellation fee
 * for the driver) and is allowed only after waiting `noShowInS` more seconds at the
 * pickup; every other reason sends the ride back to dispatch and counts against the
 * driver's reliability (priority score).
 */
export function cancelChoices(status: string, noShowInS: number | null): CancelChoice[] {
  const arrived = status === 'driver_arrived';
  let noShowBlock: string | null = null;
  if (!arrived) noShowBlock = 'Avval “Yetib keldim” ni bosing va yo‘lovchini kuting';
  else if (noShowInS !== null && noShowInS > 0) {
    const m = Math.floor(noShowInS / 60);
    const s = noShowInS % 60;
    noShowBlock = `Yana ${m}:${s.toString().padStart(2, '0')} kuting`;
  }
  return [
    {
      code: 'rider_no_show',
      label: 'Yo‘lovchi chiqmadi',
      disabledBecause: noShowBlock,
      effect:
        'Safar yakunlanadi, bekor qilish haqi sizga yoziladi (naqd safarda — yo‘lovchi keyingi safarida to‘laganda). Reytingingizga ta’sir qilmaydi.',
    },
    {
      code: 'rider_asked',
      label: 'Yo‘lovchi bekor qilishni so‘radi',
      disabledBecause: null,
      effect: BACK_TO_DISPATCH,
    },
    {
      code: 'car_problem',
      label: 'Avtomobil nosoz',
      disabledBecause: null,
      effect: BACK_TO_DISPATCH,
    },
    {
      code: 'cannot_reach',
      label: 'Manzilga yetib borolmayman',
      disabledBecause: null,
      effect: BACK_TO_DISPATCH,
    },
    { code: 'other', label: 'Boshqa sabab', disabledBecause: null, effect: BACK_TO_DISPATCH },
  ];
}

/** Cash to take from the rider: the final total, or the quote plus waiting while running. */
export function amountToCollect(fare: {
  quoted: number;
  waiting: number;
  total: number | null;
}): number {
  return fare.total ?? fare.quoted + fare.waiting;
}

/**
 * The cash the driver takes: the whole fare on a cash ride; on a card ride the fare was
 * prepaid (Payme/Click, credited to the driver's balance on completion) and only the paid
 * waiting is collected in cash (docs/payments.md).
 */
export function cashToCollect(
  paymentMethod: string,
  fare: { quoted: number; waiting: number; total: number | null },
): number {
  const total = amountToCollect(fare);
  return paymentMethod === 'card' ? Math.max(0, total - fare.quoted) : total;
}

export interface CashRide {
  paymentMethod: string;
  fare: {
    quoted: number;
    waiting: number;
    total: number | null;
    owedFee?: number | null;
    poolDiscount?: number | null;
  };
  /** The API's figure: (cash ride ? fare : 0) + paid waiting + owed fees. */
  collectCash?: number | null;
}

export interface CashBreakdown {
  /** The whole cash to take from the rider. */
  total: number;
  /** The fare part (0 on a card ride: prepaid). */
  fare: number;
  waiting: number;
  /** Cancellation fees the rider owed from earlier cash rides, taken with this fare. */
  owedFee: number;
  /** A shared ride's discount off the fare (cash rides). */
  discount: number;
}

/**
 * The cash the driver takes and what it is made of. The API's `collectCash` is the truth;
 * while the waiting timer runs, `liveWaiting` (counted on the phone) replaces the stored
 * waiting fee. An older API without `collectCash` falls back to fare + waiting + owed fee.
 */
export function cashBreakdown(ride: CashRide, liveWaiting?: number): CashBreakdown {
  const owedFee = Math.max(0, ride.fare.owedFee ?? 0);
  const waiting = liveWaiting ?? ride.fare.waiting;
  const fare = ride.paymentMethod === 'card' ? 0 : ride.fare.quoted;
  const discount = fare > 0 ? Math.max(0, ride.fare.poolDiscount ?? 0) : 0;
  if (typeof ride.collectCash === 'number' && Number.isFinite(ride.collectCash)) {
    const total = Math.max(0, ride.collectCash + (waiting - ride.fare.waiting));
    return { total, fare, waiting, owedFee, discount };
  }
  const base = cashToCollect(ride.paymentMethod, {
    ...ride.fare,
    waiting,
    total: liveWaiting === undefined ? ride.fare.total : null,
  });
  return { total: base + owedFee, fare, waiting, owedFee, discount };
}

/** "shundan 3 000 so‘m — …" under the big number, or null when nothing is owed. */
export function owedFeeNote(owedFee: number): string | null {
  return owedFee > 0
    ? `shundan ${som(owedFee)} — yo‘lovchining oldingi bekor qilingan safari uchun`
    : null;
}

/**
 * "Narx 20 000 so‘m − hamroh chegirmasi 2 300 so‘m + kutish 1 000 so‘m + oldingi safar
 * 3 000 so‘m": every part of the big number, or null for one part.
 */
export function cashPartsText(cash: CashBreakdown): string | null {
  const parts: string[] = [];
  if (cash.fare > 0) parts.push(`Narx ${som(cash.fare)}`);
  if (cash.discount > 0) parts.push(`− hamroh chegirmasi ${som(cash.discount)}`);
  if (cash.waiting > 0) parts.push(`+ kutish ${som(cash.waiting)}`);
  if (cash.owedFee > 0) parts.push(`+ oldingi safar ${som(cash.owedFee)}`);
  if (parts.length < 2) return null;
  // a card ride starts with the waiting: no leading "+"
  return parts.join(' ').replace(/^\+ /, '');
}

/** The offer's extra line for fees the rider owes (collected in cash with this fare). */
export function offerOwedFeeLine(owedFee: number | null | undefined): string | null {
  return owedFee && owedFee > 0
    ? `+ ${som(owedFee)} oldingi bekor qilingan safar uchun (naqd)`
    : null;
}

export type OfferFailure = 'taken' | 'expired' | 'gone' | 'offline' | 'network' | 'other';

/** Why accepting an offer failed, from the API's answer (409/404 messages of DispatchService). */
export function offerFailure(error: unknown): OfferFailure {
  if (isApiError(error, 0)) return 'network';
  if (isApiError(error, 404)) return 'gone';
  if (isApiError(error, 409)) {
    const m = error.message.toLowerCase();
    if (m.includes('boshqa haydovchi')) return 'taken';
    if (m.includes('amal qilmaydi')) return 'expired';
    if (m.includes('liniyaga')) return 'offline';
    return 'taken';
  }
  return 'other';
}

export const OFFER_FAILURE_TEXT: Record<OfferFailure, { title: string; text: string }> = {
  taken: {
    title: 'Buyurtmani boshqa haydovchi oldi',
    text: 'Siz tez harakat qildingiz, lekin boshqa haydovchi birinchi bo‘ldi. Liniyada qoling — keyingi buyurtma tez orada keladi.',
  },
  expired: {
    title: 'Taklif vaqti tugadi',
    text: 'Buyurtma keyingi haydovchiga o‘tdi. Liniyada qoling, yangi taklif keladi.',
  },
  gone: {
    title: 'Buyurtma endi mavjud emas',
    text: 'Boshqa haydovchi oldi yoki yo‘lovchi bekor qildi. Liniyada qoling — yangi taklif keladi.',
  },
  offline: {
    title: 'Siz liniyada emassiz',
    text: 'Buyurtma olish uchun avval liniyaga chiqing.',
  },
  network: {
    title: 'Internet aloqasi yo‘q',
    text: 'Javob yuborilmadi. Aloqani tekshiring.',
  },
  other: { title: 'Buyurtmani olib bo‘lmadi', text: 'Birozdan so‘ng qayta urinib ko‘ring.' },
};
