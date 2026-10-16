/**
 * Intermediate stops after the order (pure, unit-tested): which stop the car heads to next
 * (the rider's ETA points there, not at the drop-off), and whether and how the rider may
 * change the stops of a ride that is on (docs/architecture.md "Intermediate stops").
 */
import type { RideStop } from '../core/db/schema.js';
import type { Point } from './geo.js';
import { MAX_STOPS } from './tariff.js';

type StopState = Pick<RideStop, 'arrivedAt' | 'leftAt'>;

/** The last stop the car reported arriving at, or -1. A later arrival passes earlier stops. */
function lastArrived(stops: readonly StopState[]): number {
  return stops.reduce((last, s, i) => (s.arrivedAt ? i : last), -1);
}

/**
 * The stop the car is heading to (or standing at) during the trip, as an index; null when
 * every stop is behind (the car heads to the drop-off). A stop the car skipped (the driver
 * went on to a later one) counts as behind.
 */
export function nextStopIndex(stops: readonly StopState[]): number | null {
  const last = lastArrived(stops);
  if (last >= 0 && !stops[last]!.leftAt) return last;
  return last + 1 < stops.length ? last + 1 : null;
}

/**
 * How many stops (from the first) are fixed: every stop up to the one the car last arrived
 * at, that one included (also while the car still stands there). Those cannot be changed
 * or removed any more; the ones after may.
 */
export function lockedStopCount(stops: readonly StopState[]): number {
  return lastArrived(stops) + 1;
}

export interface StopsChangeRide {
  status: string;
  service: string;
  shareable: boolean;
  fare_mode: string;
  payment_method: string;
  pool_id: string | null;
  stops: readonly RideStop[];
}

/** Why the stops of a ride cannot be changed; the apps hide the button on `canChange`. */
export type StopsChangeRefusal =
  'service' | 'shared' | 'card' | 'status' | 'locked' | 'too_many' | 'unchanged';

/** Statuses in which the rider may still change the stops. */
const CHANGEABLE = ['scheduled', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress'];

/**
 * Whether this ride's stops may be changed at all (the button): a taxi ride paid in cash,
 * not shared (other riders' plans) and not over. Card rides are prepaid at the quoted price:
 * changing them would mean a second charge or a partial refund mid-ride, so they are not
 * changed (cancel and order again, the prepayment is refunded in full).
 */
export function stopsChangeAllowed(ride: StopsChangeRide): StopsChangeRefusal | null {
  if (ride.service !== 'taxi') return 'service';
  if (ride.shareable || ride.fare_mode === 'seat' || ride.pool_id) return 'shared';
  if (!CHANGEABLE.includes(ride.status)) return 'status';
  if (ride.payment_method === 'card') return 'card';
  return null;
}

const samePoint = (a: Point, b: Point) =>
  Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

/**
 * Checks a new list of stops against the ride's: the fixed prefix (stops the car already
 * reached) must be kept as it is, at most MAX_STOPS in all, and something must differ.
 */
export function stopsChangeCheck(
  ride: StopsChangeRide,
  next: readonly Point[],
): StopsChangeRefusal | null {
  const allowed = stopsChangeAllowed(ride);
  if (allowed) return allowed;
  if (next.length > MAX_STOPS) return 'too_many';
  const locked = lockedStopCount(ride.stops);
  if (next.length < locked) return 'locked';
  for (let i = 0; i < locked; i++) {
    if (!samePoint(ride.stops[i]!, next[i]!)) return 'locked';
  }
  if (next.length === ride.stops.length && next.every((p, i) => samePoint(p, ride.stops[i]!))) {
    return 'unchanged';
  }
  return null;
}

/**
 * The ride's stops after the change: the fixed prefix keeps its times and waiting, the rest
 * are new (unvisited) with the words the rider gave.
 */
export function mergeStops(
  current: readonly RideStop[],
  next: readonly (Point & { address: string | null; landmark: string | null })[],
): RideStop[] {
  const locked = lockedStopCount(current);
  return next.map((p, i) =>
    i < locked
      ? current[i]!
      : {
          address: p.address,
          landmark: p.landmark,
          lat: p.lat,
          lng: p.lng,
          arrivedAt: null,
          leftAt: null,
          waitingFee: 0,
        },
  );
}
