import type { BookingStatus, SeatPrices, TripStatus } from '../api/types';

/** Trips still taking bookings and cancellations (the API's OPEN_TRIP). */
export const isOpenTrip = (s: TripStatus) => s === 'scheduled' || s === 'boarding';

/** Bookings that still hold seats (the API's LIVE_BOOKING). */
export const isLiveBooking = (s: BookingStatus) => s === 'booked' || s === 'boarded';

/** What a booking costs: the front seat at its price, the rest at the rear price (as the API). */
export function bookingPrice(seats: number, front: boolean, prices: SeatPrices): number {
  return front ? (seats - 1) * prices.rear + prices.front : seats * prices.rear;
}

/** A route price the API accepts: both set, 1 000..2 000 000, the front not below the rear. */
export function routePriceProblems(
  rear: number | null,
  front: number | null,
): Record<'rear' | 'front', string | undefined> {
  const range = (v: number | null) =>
    v === null
      ? 'Narxni kiriting'
      : v < 1000 || v > 2_000_000
        ? '1 000 dan 2 000 000 gacha'
        : undefined;
  const out = { rear: range(rear), front: range(front) };
  if (!out.rear && !out.front && front! < rear!)
    out.front = 'Old o‘rindiq orqadagidan arzon bo‘lmasin';
  return out;
}

/** Seats a caller may book on a trip with `free` seats left (the API allows 1..4). */
export function seatChoices(free: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(4, free)) }, (_, i) => i + 1);
}
