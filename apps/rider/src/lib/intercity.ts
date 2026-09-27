/**
 * The intercity trip board (pure, unit-tested): what a booking costs, what cancelling it
 * costs, the dates to search. Mirrors apps/api/src/lib/intercity.ts and the booking rules
 * (free until 60 minutes before departure, then 30% of the booking; settings the API does
 * not publish to riders, so these are its defaults).
 */
import type { BookingStatus, TripStatus } from '../api/types';
import { formatDay, formatMoney, formatTime, tashkentDay } from './format';

export const FREE_CANCEL_MINUTES = 60;
export const LATE_CANCEL_FEE_PERCENT = 30;
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

export interface BookingCancelTerms {
  fee: number;
  /** Until when cancelling is free (null once it is not). */
  freeUntil: Date | null;
  message: string;
}

/** The fee the API records when the rider cancels now (rounded to 100 so'm). */
export function bookingCancelTerms(
  departureAt: string | Date,
  price: number,
  now: Date,
): BookingCancelTerms {
  const freeUntil = new Date(new Date(departureAt).getTime() - FREE_CANCEL_MINUTES * 60_000);
  if (now < freeUntil) {
    return {
      fee: 0,
      freeUntil,
      message: `Soat ${formatTime(freeUntil)} gacha bekor qilish bepul. Keyin bron narxining ${LATE_CANCEL_FEE_PERCENT}% i to‘lanadi.`,
    };
  }
  const fee = Math.round((price * LATE_CANCEL_FEE_PERCENT) / 100 / 100) * 100;
  return {
    fee,
    freeUntil: null,
    message: `Jo‘nashga ${FREE_CANCEL_MINUTES} daqiqadan kam qoldi: bekor qilsangiz ${formatMoney(fee)} (${LATE_CANCEL_FEE_PERCENT}%) haydovchiga yoziladi.`,
  };
}

/** The general rule, for the booking screen. */
export const CANCEL_RULE_TEXT =
  `Jo‘nashdan ${FREE_CANCEL_MINUTES} daqiqa oldingacha bepul bekor qilish mumkin. ` +
  `Undan keyin bron narxining ${LATE_CANCEL_FEE_PERCENT}% i haydovchiga yoziladi.`;

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
