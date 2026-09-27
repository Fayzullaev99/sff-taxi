/**
 * The intercity trip board (pure, unit-tested): what a booking costs, what cancelling it
 * costs, the dates to search. Mirrors apps/api/src/lib/intercity.ts and the booking rules
 * (free until a set time before departure, then a share of the booking: the rules come from
 * GET /config and the trip / booking views; 60 minutes and 30% are the launch defaults).
 */
import type { BookingStatus, TripStatus } from '../api/types';
import { formatDay, formatMoney, formatTime, tashkentDay } from './format';

export const MAX_SEATS = 4;

export interface SeatPrices {
  rear: number;
  front: number;
}

/** The API's bookingPrice: with the front seat, one seat at the front price. */
export function bookingPrice(seats: number, front: boolean, prices: SeatPrices): number {
  return front ? (seats - 1) * prices.rear + prices.front : seats * prices.rear;
}

/** What the front seat costs over a rear one. */
export function frontSurcharge(prices: SeatPrices): number {
  return Math.max(0, prices.front - prices.rear);
}

/** The seat board's cancellation rules (GET /config `intercity`, the trip's `cancelRules`). */
export interface CancelRules {
  freeCancelMinutes: number;
  lateCancelFeePercent: number;
}

/** The launch defaults, until the API has answered (or for an older API without them). */
export const DEFAULT_CANCEL_RULES: CancelRules = {
  freeCancelMinutes: 60,
  lateCancelFeePercent: 30,
};

const validRules = (r: Partial<CancelRules> | null | undefined): r is CancelRules =>
  !!r &&
  Number.isFinite(r.freeCancelMinutes) &&
  (r.freeCancelMinutes as number) >= 0 &&
  Number.isFinite(r.lateCancelFeePercent) &&
  (r.lateCancelFeePercent as number) >= 0 &&
  (r.lateCancelFeePercent as number) <= 100;

/**
 * The rules in force: the first readable of the sources, most specific first (the booking's
 * or trip's own, then /config), else the launch defaults.
 */
export function cancelRulesFrom(
  ...sources: (Partial<CancelRules> | null | undefined)[]
): CancelRules {
  for (const r of sources) {
    if (validRules(r)) {
      return {
        freeCancelMinutes: r.freeCancelMinutes,
        lateCancelFeePercent: r.lateCancelFeePercent,
      };
    }
  }
  return DEFAULT_CANCEL_RULES;
}

export interface BookingCancelTerms {
  fee: number;
  /** Until when cancelling is free (null once it is not). */
  freeUntil: Date | null;
  message: string;
}

/**
 * What cancelling costs now, as the API records it (the share rounded to 100 so'm). The
 * booking's own `cancelFreeUntil` / `cancelFeeNow` win when given; the clock catches the
 * free time running out after the booking was fetched.
 */
export function bookingCancelTerms(
  departureAt: string | Date,
  price: number,
  now: Date,
  rules: CancelRules = DEFAULT_CANCEL_RULES,
  server: { freeUntil?: string | null; feeNow?: number | null } = {},
): BookingCancelTerms {
  const freeUntil = server.freeUntil
    ? new Date(server.freeUntil)
    : new Date(new Date(departureAt).getTime() - rules.freeCancelMinutes * 60_000);
  const percent = rules.lateCancelFeePercent;
  if (now < freeUntil) {
    return {
      fee: 0,
      freeUntil,
      message:
        percent > 0
          ? `Soat ${formatTime(freeUntil)} gacha bekor qilish bepul. Keyin bron narxining ${percent}% i to‘lanadi.`
          : 'Bekor qilish bepul.',
    };
  }
  const computed = Math.round((price * percent) / 100 / 100) * 100;
  const fee = server.feeNow && server.feeNow > 0 ? server.feeNow : computed;
  if (fee <= 0) return { fee: 0, freeUntil: null, message: 'Bekor qilish bepul.' };
  return {
    fee,
    freeUntil: null,
    message: `Jo‘nashga ${rules.freeCancelMinutes} daqiqadan kam qoldi: bekor qilsangiz ${formatMoney(fee)} (${percent}%) haydovchiga yoziladi.`,
  };
}

/** The general rule, for the trip and booking screens. */
export function cancelRuleText(rules: CancelRules = DEFAULT_CANCEL_RULES): string {
  if (rules.lateCancelFeePercent <= 0) return 'Bronni istalgan vaqtda bepul bekor qilish mumkin.';
  return (
    `Jo‘nashdan ${rules.freeCancelMinutes} daqiqa oldingacha bepul bekor qilish mumkin. ` +
    `Undan keyin bron narxining ${rules.lateCancelFeePercent}% i haydovchiga yoziladi.`
  );
}

export interface DateOption {
  /** YYYY-MM-DD (Tashkent), as the API's `date`. */
  value: string;
  label: string;
}

/** Today and the next days in Tashkent (drivers publish up to 7 days ahead). */
export function searchDates(now: Date, days = 8): DateOption[] {
  return Array.from({ length: days }, (_, i) => {
    const value = tashkentDay(new Date(now.getTime() + i * 86_400_000));
    return { value, label: i === 0 ? 'Bugun' : i === 1 ? 'Ertaga' : formatDay(value) };
  });
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  booked: 'Band qilingan',
  boarded: 'Mashinadasiz',
  completed: 'Yetib keldi',
  cancelled: 'Bekor qilingan',
  no_show: 'Kelmadingiz',
};

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  scheduled: 'Jo‘nashni kutmoqda',
  boarding: 'Yo‘lovchilar o‘tirmoqda',
  departed: 'Yo‘lda',
  arrived: 'Yetib keldi',
  cancelled: 'Qatnov bekor qilindi',
};

/** Why a booking ended, in the rider's words. */
export function bookingCancelledText(b: {
  status: BookingStatus;
  cancelledBy: string | null;
  cancelReason: string | null;
  cancellationFee: number;
}): string | null {
  if (b.status === 'no_show') {
    return 'Mashina jo‘nab ketganda siz yo‘q edingiz: bron yopildi.';
  }
  if (b.status !== 'cancelled') return null;
  const reason = b.cancelReason ? `: ${b.cancelReason}` : '';
  const fee =
    b.cancellationFee > 0 ? ` Bekor qilish to‘lovi: ${formatMoney(b.cancellationFee)}.` : '';
  switch (b.cancelledBy) {
    case 'rider':
      return `Siz bronni bekor qildingiz.${fee}`;
    case 'driver':
      return `Haydovchi qatnovni bekor qildi${reason}.`;
    case 'operator':
      return `Operator bronni bekor qildi${reason}.`;
    default:
      return `Bron bekor qilindi${reason}.`;
  }
}
