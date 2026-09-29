import type { Point } from './geo';

/**
 * The driver's ordered stop list. Today a driver carries one ride: its pickup, then its
 * drop-off. Shared rides (several riders at once) add more rides to the same list; the
 * screens render stops, not "the pickup and the drop-off", so they need no change then.
 */

export interface StopPlace extends Point {
  address: string | null;
  landmark: string | null;
}

export interface StopRide {
  id: string;
  number: number;
  status: string;
  pickup: StopPlace;
  dropoff: StopPlace;
  distanceM: number;
}

export interface Stop {
  /** Stable React key. */
  key: string;
  kind: 'pickup' | 'dropoff';
  rideId: string;
  rideNumber: number;
  place: StopPlace;
  /** Already passed (the rider is in the car, or was dropped off). */
  done: boolean;
  /** The stop the driver is heading to (or standing at) now. */
  current: boolean;
}

function pickedUp(status: string): boolean {
  return status === 'in_progress' || status === 'completed';
}

/** One ride's stops. */
export function rideStops(ride: StopRide): Stop[] {
  const inCar = pickedUp(ride.status);
  const done = ride.status === 'completed';
  return [
    {
      key: `${ride.id}:pickup`,
      kind: 'pickup',
      rideId: ride.id,
      rideNumber: ride.number,
      place: ride.pickup,
      done: inCar,
      current: false,
    },
    {
      key: `${ride.id}:dropoff`,
      kind: 'dropoff',
      rideId: ride.id,
      rideNumber: ride.number,
      place: ride.dropoff,
      done,
      current: false,
    },
  ];
}

/**
 * The stops of all the driver's rides in order, the first unfinished one marked current.
 * `order` (stop keys) is the API's route order when it gives one; otherwise each ride's
 * pickup comes before its drop-off, rides in the given order.
 */
export function stopList(rides: readonly StopRide[], order?: readonly string[] | null): Stop[] {
  let stops = rides.flatMap(rideStops);
  if (order?.length) {
    const at = new Map(order.map((k, i) => [k, i]));
    stops = [...stops].sort(
      (a, b) =>
        (at.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (at.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const next = stops.findIndex((s) => !s.done);
  return stops.map((s, i) => (i === next ? { ...s, current: true } : s));
}

/** Where the navigation button leads: the current stop, or null when all are done. */
export function nextStop(stops: readonly Stop[]): Stop | null {
  return stops.find((s) => s.current) ?? null;
}
