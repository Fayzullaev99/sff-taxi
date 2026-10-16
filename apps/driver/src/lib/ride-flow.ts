import { t } from '../i18n/dictionary';
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

/** The step of each status, worded in the app's language when asked. */
export function stepOf(status: string): RideStep | null {
  switch (status) {
    case 'driver_assigned':
      return {
        title: t('ride.flow.toPickupTitle'),
        button: t('ride.flow.arrived'),
        action: 'arrive',
        navigateTo: 'pickup',
      };
    case 'driver_arrived':
      return {
        title: t('ride.flow.waitTitle'),
        button: t('ride.flow.start'),
        action: 'start',
        navigateTo: null,
      };
    case 'in_progress':
      return {
        title: t('ride.flow.toDropoffTitle'),
        button: t('ride.flow.complete'),
        action: 'complete',
        navigateTo: 'dropoff',
      };
    default:
      return null;
  }
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

/**
 * The reasons with what each does. A no-show ends the ride (with the cancellation fee
 * for the driver) and is allowed only after waiting `noShowInS` more seconds at the
 * pickup; every other reason sends the ride back to dispatch and counts against the
 * driver's reliability (priority score).
 */
export function cancelChoices(status: string, noShowInS: number | null): CancelChoice[] {
  const arrived = status === 'driver_arrived';
  let noShowBlock: string | null = null;
  if (!arrived) noShowBlock = t('ride.cancel.arriveFirst');
  else if (noShowInS !== null && noShowInS > 0) {
    const m = Math.floor(noShowInS / 60);
    const s = noShowInS % 60;
    noShowBlock = t('ride.cancel.waitMore', { time: `${m}:${s.toString().padStart(2, '0')}` });
  }
  const backToDispatch = t('ride.cancel.backToDispatch');
  return [
    {
      code: 'rider_no_show',
      label: t('ride.cancel.noShow'),
      disabledBecause: noShowBlock,
      effect: t('ride.cancel.noShowEffect'),
    },
    {
      code: 'rider_asked',
      label: t('ride.cancel.riderAsked'),
      disabledBecause: null,
      effect: backToDispatch,
    },
    {
      code: 'car_problem',
      label: t('ride.cancel.carProblem'),
      disabledBecause: null,
      effect: backToDispatch,
    },
    {
      code: 'cannot_reach',
      label: t('ride.cancel.cannotReach'),
      disabledBecause: null,
      effect: backToDispatch,
    },
    {
      code: 'other',
      label: t('ride.cancel.otherReason'),
      disabledBecause: null,
      effect: backToDispatch,
    },
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
  /** The rider's promo / bonus discount: on a cash ride the platform pays it to the balance. */
  discount?: { compensation: number } | null;
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
  /** The rider's promo / bonus discount the platform pays onto the balance (cash rides). */
  bonus: number;
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
  const bonus = Math.max(0, ride.discount?.compensation ?? 0);
  if (typeof ride.collectCash === 'number' && Number.isFinite(ride.collectCash)) {
    const total = Math.max(0, ride.collectCash + (waiting - ride.fare.waiting));
    return { total, fare, waiting, owedFee, discount, bonus };
  }
  const base = cashToCollect(ride.paymentMethod, {
    ...ride.fare,
    waiting,
    total: liveWaiting === undefined ? ride.fare.total : null,
  });
  return { total: Math.max(0, base + owedFee - bonus), fare, waiting, owedFee, discount, bonus };
}

/** "Yo‘lovchi bonusi 1 400 so‘m — SFF balansingizga to‘laydi", or null without one. */
export function bonusNote(bonus: number): string | null {
  return bonus > 0 ? t('ride.flow.bonusNote', { amount: som(bonus) }) : null;
}

/** "shundan 3 000 so‘m — …" under the big number, or null when nothing is owed. */
export function owedFeeNote(owedFee: number): string | null {
  return owedFee > 0 ? t('ride.flow.owedNote', { amount: som(owedFee) }) : null;
}

/**
 * "Narx 20 000 so‘m − hamroh chegirmasi 2 300 so‘m + kutish 1 000 so‘m + oldingi safar
 * 3 000 so‘m": every part of the big number, or null for one part.
 */
export function cashPartsText(cash: CashBreakdown): string | null {
  const parts: string[] = [];
  if (cash.fare > 0) parts.push(t('ride.flow.partFare', { amount: som(cash.fare) }));
  if (cash.discount > 0) {
    parts.push(t('ride.flow.partPoolDiscount', { amount: som(cash.discount) }));
  }
  if (cash.bonus > 0) parts.push(t('ride.flow.partBonus', { amount: som(cash.bonus) }));
  if (cash.waiting > 0) parts.push(t('ride.flow.partWaiting', { amount: som(cash.waiting) }));
  if (cash.owedFee > 0) parts.push(t('ride.flow.partOwed', { amount: som(cash.owedFee) }));
  if (parts.length < 2) return null;
  // a card ride starts with the waiting: no leading "+"
  return parts.join(' ').replace(/^\+ /, '');
}

/** The offer's extra line for fees the rider owes (collected in cash with this fare). */
export function offerOwedFeeLine(owedFee: number | null | undefined): string | null {
  return owedFee && owedFee > 0 ? t('ride.offer.owedFee', { amount: som(owedFee) }) : null;
}

export type OfferFailure = 'taken' | 'expired' | 'gone' | 'offline' | 'network' | 'other';

/**
 * Why accepting an offer failed, from the API's answer (409/404 messages of DispatchService,
 * in the account's language: Uzbek or Russian).
 */
export function offerFailure(error: unknown): OfferFailure {
  if (isApiError(error, 0)) return 'network';
  if (isApiError(error, 404)) return 'gone';
  if (isApiError(error, 409)) {
    const m = error.message.toLowerCase();
    if (m.includes('boshqa haydovchi') || m.includes('другому водителю')) return 'taken';
    if (m.includes('amal qilmaydi') || m.includes('недействительно')) return 'expired';
    if (m.includes('liniyaga') || m.includes('на линию')) return 'offline';
    return 'taken';
  }
  return 'other';
}

/** The closed-offer screen's words for a failure. */
export function offerFailureText(failure: OfferFailure): { title: string; text: string } {
  switch (failure) {
    case 'taken':
      return { title: t('ride.offer.takenTitle'), text: t('ride.offer.takenText') };
    case 'expired':
      return { title: t('ride.offer.expiredTitle'), text: t('ride.offer.expiredText') };
    case 'gone':
      return { title: t('ride.offer.goneTitle'), text: t('ride.offer.goneText') };
    case 'offline':
      return { title: t('ride.offer.offlineTitle'), text: t('ride.offer.offlineText') };
    case 'network':
      return { title: t('ride.offer.networkTitle'), text: t('ride.offer.networkText') };
    default:
      return { title: t('ride.offer.otherTitle'), text: t('ride.offer.otherText') };
  }
}
