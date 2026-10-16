import { t } from '../i18n/dictionary';
import type { Point } from './geo';

/**
 * The driver's ordered stop list. A driver carries one ride: its pickup, its intermediate
 * stops ("Oraliq manzil", up to two), then its drop-off. Shared rides (several riders at
 * once) add more rides to the same list; the screens render stops, not "the pickup and the
 * drop-off", so they need no change then.
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
  /** Intermediate stops in order, with when the car got there and drove on. */
  stops?: readonly (StopPlace & { arrivedAt: string | null; leftAt: string | null })[];
}

export interface Stop {
  /** Stable React key. */
  key: string;
  /** via: an intermediate stop of the ride (`index` from 0). */
  kind: 'pickup' | 'via' | 'dropoff';
  index?: number;
  /** An intermediate stop the car is standing at (arrived, not driven on yet). */
  arrived?: boolean;
  rideId: string;
  rideNumber: number;
  place: StopPlace;
  /** Already passed (the rider is in the car, or was dropped off). */
  done: boolean;
  /** The stop the driver is heading to (or standing at) now. */
  current: boolean;
  /** Shared rides: whose stop it is, how many get in or out, the ride's status. */
  riderName?: string | null;
  passengers?: number;
  status?: string;
}

/**
 * The stops ahead of a car with several riders (`driver/rides/current` → `pool.stops`), in
 * the API's order: none is done yet, the first is where the driver goes now.
 */
export function stopsFromPool(
  stops: readonly {
    rideId: string;
    number?: number;
    type: 'pickup' | 'dropoff';
    lat: number;
    lng: number;
    place?: { address: string | null; landmark: string | null } | null;
    riderName?: string | null;
    passengers?: number;
    status: string;
  }[],
): Stop[] {
  return stops.map((s, i) => ({
    key: `${s.rideId}:${s.type}`,
    kind: s.type,
    rideId: s.rideId,
    rideNumber: s.number ?? 0,
    place: {
      lat: s.lat,
      lng: s.lng,
      address: s.place?.address ?? null,
      landmark: s.place?.landmark ?? null,
    },
    done: false,
    current: i === 0,
    riderName: s.riderName ?? null,
    passengers: s.passengers ?? 1,
    status: s.status,
  }));
}

function pickedUp(status: string): boolean {
  return status === 'in_progress' || status === 'completed';
}

/**
 * One ride's stops. An intermediate stop is passed once the car drove on from it, or when
 * the car went on to a later stop (the rider skipped it).
 */
export function rideStops(ride: StopRide): Stop[] {
  const inCar = pickedUp(ride.status);
  const done = ride.status === 'completed';
  const via = ride.stops ?? [];
  const lastVisited = via.reduce((last, s, i) => (s.arrivedAt ? i : last), -1);
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
    ...via.map((s, i): Stop => ({
      key: `${ride.id}:via${i}`,
      kind: 'via',
      index: i,
      rideId: ride.id,
      rideNumber: ride.number,
      place: { lat: s.lat, lng: s.lng, address: s.address, landmark: s.landmark },
      done: done || s.leftAt !== null || i < lastVisited,
      arrived: s.arrivedAt !== null && s.leftAt === null,
      current: false,
    })),
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

/**
 * What the driver does at the current intermediate stop, during the trip: say they are there
 * (the free minutes start) or drive on (paid waiting is fixed). Null when the current stop
 * is not an intermediate one.
 */
export function viaAction(
  stop: Stop | null,
  status: string,
): { index: number; action: 'arrive' | 'leave'; button: string } | null {
  if (!stop || stop.kind !== 'via' || status !== 'in_progress' || stop.index === undefined) {
    return null;
  }
  return stop.arrived
    ? { index: stop.index, action: 'leave', button: t('common.actions.next') }
    : {
        index: stop.index,
        action: 'arrive',
        button: t('ride.stops.viaArrived', { n: stop.index + 1 }),
      };
}

/** Where the navigation button leads: the current stop, or null when all are done. */
export function nextStop(stops: readonly Stop[]): Stop | null {
  return stops.find((s) => s.current) ?? null;
}
