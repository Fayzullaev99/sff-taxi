/**
 * Intermediate stops of a ride that is on (pure, unit-tested): which stop the car heads to
 * next (the ETA and the map frame point there, not at the drop-off), which stops are fixed
 * because the car already reached them, and the sentence of a price change.
 */
import type { LatLng, Ride, RideStop } from '../api/types';
import { t } from '../i18n/dictionary';
import { formatMoney } from './format';

type StopState = Pick<RideStop, 'arrivedAt' | 'leftAt'>;

/** The last stop the car reported arriving at, or -1; a later arrival passes earlier stops. */
function lastArrived(stops: readonly StopState[]): number {
  return stops.reduce((last, s, i) => (s.arrivedAt ? i : last), -1);
}

/**
 * The stop the car heads to (or stands at) during the trip, as an index into `stops`;
 * null when every stop is behind (the car heads to the drop-off). Mirrors the API's
 * `nextStopIndex`, so an older API without it is read the same way.
 */
export function nextStopIndex(stops: readonly StopState[] | undefined): number | null {
  if (!stops?.length) return null;
  const last = lastArrived(stops);
  if (last >= 0 && !stops[last]!.leftAt) return last;
  return last + 1 < stops.length ? last + 1 : null;
}

/** Stops up to the one the car last reached (that one included) cannot be changed any more. */
export function lockedStopCount(stops: readonly StopState[] | undefined): number {
  return stops?.length ? lastArrived(stops) + 1 : 0;
}

/**
 * Where the car is going during the trip: the next intermediate stop (with its number) or
 * the drop-off. The API's `nextStopIndex` wins when it is there (the server's own view).
 */
export function tripTarget(ride: Pick<Ride, 'stops' | 'dropoff' | 'nextStopIndex'>): {
  point: LatLng;
  stopIndex: number | null;
} {
  const index = ride.nextStopIndex !== undefined ? ride.nextStopIndex : nextStopIndex(ride.stops);
  const stop = index === null ? undefined : ride.stops?.[index];
  return stop
    ? { point: { lat: stop.lat, lng: stop.lng }, stopIndex: index }
    : { point: ride.dropoff, stopIndex: null };
}

/**
 * The price change of a stops edit in one sentence for the confirmation: "Yangi narx
 * 14 000 so‘m (avval 12 000 so‘m): +2 000 so‘m". What the rider pays (after discounts).
 */
export function priceChangeText(before: number, after: number): string {
  if (after === before) return t('ride.stops.priceSame', { price: formatMoney(after) });
  const diff = after - before;
  return t(diff > 0 ? 'ride.stops.priceUp' : 'ride.stops.priceDown', {
    before: formatMoney(before),
    after: formatMoney(after),
    diff: formatMoney(Math.abs(diff)),
  });
}
