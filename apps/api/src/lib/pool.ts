import { z } from 'zod';
import { distanceM } from './distance.js';
import type { Point } from './geo.js';

/**
 * Shared rides ("Hamroh bilan"): a driver carrying riders who agreed to share the car takes
 * another rider going the same way, without waiting for anyone to get out. This file is the
 * pure core (docs/shared-rides.md): the seating rule, inserting a new rider's pickup and
 * drop-off into the driver's remaining stops within detour limits, the shared distance of
 * each rider and the discount it earns. Modules do the I/O (routing matrix, locks, storage).
 */

/** Hard seating rule: one passenger in front, never more than two in the back. */
export const FRONT_SEATS = 1;
export const REAR_SEATS_MAX = 2;
/** People a car carries besides the driver, whatever its registered seats. */
export const MAX_PASSENGERS = FRONT_SEATS + REAR_SEATS_MAX;

/** How many passengers a car may carry: its seats, but never more than the seating rule. */
export function carCapacity(vehicleSeats: number): number {
  return Math.max(0, Math.min(vehicleSeats, MAX_PASSENGERS));
}

/** Where `occupied` people sit: the front seat first, the rest in the back (at most 2). */
export function seatLayout(occupied: number, capacity: number) {
  const cap = carCapacity(capacity);
  const n = Math.max(0, Math.min(occupied, cap));
  const front = Math.min(n, FRONT_SEATS);
  const rear = n - front;
  return { occupied: n, capacity: cap, front, rear, free: cap - n };
}

const seconds = (min: number, max: number) => z.number().int().min(min).max(max);

/** Operator-editable rules of shared rides (admin/settings/pool). */
export const PoolRules = z.object({
  /** Shared rides are offered at all. */
  enabled: z.boolean(),
  /** Each rider's discount when the car is shared for (at least) the full-discount share. */
  discount_percent: z.number().int().min(0).max(50),
  /**
   * The share of a rider's own trip that must be shared for the full discount; a shorter
   * shared part earns a proportional part of it (5 km shared of a 40 km trip is not half).
   */
  full_discount_share_percent: z.number().int().min(1).max(100),
  /** Most extra time a new rider may add to anyone already in (or waiting for) the car. */
  max_detour_seconds_city: seconds(60, 1800),
  max_detour_seconds_intercity: seconds(60, 3600),
  /** ... and at most this share of their own remaining time (at least 2 minutes). */
  max_detour_percent: z.number().int().min(5).max(200),
  /** A car further than this (road time) from the new rider's pickup is not asked. */
  max_pickup_eta_seconds: seconds(60, 3600),
  /** Cars within this straight-line distance of the pickup are considered. */
  search_radius_m: z.number().int().min(500).max(50_000),
  /** A car already going that way wins over a free car up to this many seconds further. */
  pool_preference_seconds: seconds(0, 600),
  /** How many riders (orders) one car may carry at once. */
  max_riders: z.number().int().min(2).max(MAX_PASSENGERS),
});
export type PoolRules = z.infer<typeof PoolRules>;

export const DEFAULT_POOL: PoolRules = {
  enabled: true,
  discount_percent: 15,
  full_discount_share_percent: 50,
  max_detour_seconds_city: 360,
  max_detour_seconds_intercity: 900,
  max_detour_percent: 50,
  max_pickup_eta_seconds: 900,
  search_radius_m: 8000,
  pool_preference_seconds: 90,
  max_riders: 3,
};

// Stops and legs ---------------------------------------------------------------------------

/**
 * A stop still ahead of the driver. `destination` is the driver's own goal (going home, or
 * where the people already in the car without the app are going): nothing may push it back
 * beyond the detour limits either.
 */
export interface PlanStop {
  rideId: string | null;
  type: 'pickup' | 'dropoff' | 'destination';
  lat: number;
  lng: number;
  /** People getting in (pickup) or out (drop-off, destination). */
  passengers: number;
}

export interface Leg {
  distanceM: number;
  durationS: number;
}

/** Road legs between any two of the points (by index): the routing matrix. */
export type LegMatrix = Leg[][];

export interface InsertionInput {
  /** The car now. */
  driver: Point;
  /** Stops ahead, in order. */
  stops: PlanStop[];
  /** People in the car now who ride without the app (the driver's own count). */
  extraOnboard: number;
  /** carCapacity(vehicle seats). */
  capacity: number;
  request: { rideId: string; pickup: Point; dropoff: Point; passengers: number };
  /** Detour limit for anyone already in or waiting for the car. */
  maxDetourS: number;
  maxDetourPercent: number;
  maxPickupEtaS: number;
  /**
   * Legs between the points [driver, ...stops, request pickup, request drop-off], in that
   * order (poolPoints() builds the list).
   */
  matrix: LegMatrix;
}

export interface Insertion {
  /** The new plan: the stops ahead with the new pickup and drop-off in place. */
  stops: PlanStop[];
  /** Road time until the new rider is picked up. */
  pickupEtaS: number;
  /** How much longer the whole plan became. */
  addedS: number;
  addedM: number;
  /** The worst delay anyone already in or waiting for the car gets. */
  maxDelayS: number;
  /** Road metres of the new rider's own trip in the plan (pickup to drop-off). */
  riderInCarM: number;
}

/** The points of an insertion's matrix, in the order InsertionInput.matrix expects. */
export function poolPoints(
  driver: Point,
  stops: readonly PlanStop[],
  request: { pickup: Point; dropoff: Point },
): Point[] {
  return [
    driver,
    ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    request.pickup,
    request.dropoff,
  ];
}

/** Rides whose pickup is not ahead but whose drop-off is: they are in the car. */
export function onboardRides(stops: readonly PlanStop[]): Map<string, number> {
  const picked = new Set(stops.filter((s) => s.type === 'pickup').map((s) => s.rideId));
  const onboard = new Map<string, number>();
  for (const s of stops) {
    if (s.type === 'dropoff' && s.rideId && !picked.has(s.rideId)) {
      onboard.set(s.rideId, s.passengers);
    }
  }
  return onboard;
}

interface Walked {
  /** Arrival time and distance at each stop, in order. */
  at: { s: number; m: number }[];
  totalS: number;
  totalM: number;
  /** Whether the car was ever over capacity. */
  overCapacity: boolean;
}

/**
 * Drives through `order` (indices into the matrix points; 0 is the driver) counting time,
 * distance and the people in the car.
 */
function walk(
  order: number[],
  stopOf: (i: number) => PlanStop,
  matrix: LegMatrix,
  startOnboard: number,
  capacity: number,
): Walked {
  let s = 0;
  let m = 0;
  let prev = 0;
  let people = startOnboard;
  let overCapacity = startOnboard > capacity;
  const at: Walked['at'] = [];
  for (const i of order) {
    const leg = matrix[prev]![i]!;
    s += leg.durationS;
    m += leg.distanceM;
    const stop = stopOf(i);
    people += stop.type === 'pickup' ? stop.passengers : -stop.passengers;
    if (people > capacity) overCapacity = true;
    at.push({ s, m });
    prev = i;
  }
  return { at, totalS: s, totalM: m, overCapacity };
}

/** The delay an existing stop may get: the cap, but at most a share of its own time (≥ 2 min). */
export function allowedDelay(ownS: number, maxDetourS: number, maxDetourPercent: number): number {
  return Math.min(maxDetourS, Math.max(120, (ownS * maxDetourPercent) / 100));
}

/**
 * The best place for a new rider's pickup and drop-off among the stops ahead: every pair of
 * positions is tried (a car holds at most three riders, so this is a few dozen plans); a
 * plan is allowed when the car is never over capacity, nobody already in or waiting for it
 * is delayed beyond the limits, the car reaches the new rider in time and the new rider is
 * not driven around much longer than their direct trip. The cheapest added time wins.
 * Null: the rider is not on this car's way.
 */
export function bestInsertion(input: InsertionInput): Insertion | null {
  const { stops, matrix, request } = input;
  const n = stops.length;
  const P = n + 1;
  const D = n + 2;
  const requestStops: Record<number, PlanStop> = {
    [P]: {
      rideId: request.rideId,
      type: 'pickup',
      lat: request.pickup.lat,
      lng: request.pickup.lng,
      passengers: request.passengers,
    },
    [D]: {
      rideId: request.rideId,
      type: 'dropoff',
      lat: request.dropoff.lat,
      lng: request.dropoff.lng,
      passengers: request.passengers,
    },
  };
  const stopOf = (i: number) => requestStops[i] ?? stops[i - 1]!;
  const onboardApp = [...onboardRides(stops).values()].reduce((a, b) => a + b, 0);
  const startOnboard = input.extraOnboard + onboardApp;
  const base = walk(
    stops.map((_, i) => i + 1),
    stopOf,
    matrix,
    startOnboard,
    input.capacity,
  );
  const direct = matrix[P]![D]!;

  // the driver's own destination stays the last stop: the new rider gets in and out before it
  const destination = stops.findIndex((s) => s.type === 'destination');
  const last = destination >= 0 ? destination : n;
  // a shared ride shares: the new rider gets in before the last rider already there gets
  // out (after that the car is simply free, and ordinary dispatch offers it)
  const lastApp = stops.findLastIndex((s) => s.rideId !== null && s.type === 'dropoff');
  const lastPickup = lastApp >= 0 ? Math.min(lastApp, last) : last;

  let best: Insertion | null = null;
  for (let i = 0; i <= lastPickup; i++) {
    for (let j = i; j <= last; j++) {
      // pickup goes before the old stop i, drop-off before the old stop j (after the pickup)
      const order: number[] = [];
      for (let k = 0; k <= n; k++) {
        if (k === i) order.push(P);
        if (k === j) order.push(D);
        if (k < n) order.push(k + 1);
      }
      const w = walk(order, stopOf, matrix, startOnboard, input.capacity);
      if (w.overCapacity) continue;
      const posP = order.indexOf(P);
      const posD = order.indexOf(D);
      const pickupEtaS = w.at[posP]!.s;
      if (pickupEtaS > input.maxPickupEtaS) continue;
      const riderS = w.at[posD]!.s - pickupEtaS;
      if (
        riderS >
        direct.durationS + allowedDelay(direct.durationS, input.maxDetourS, input.maxDetourPercent)
      ) {
        continue;
      }
      let maxDelayS = 0;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        const before = base.at[k]!.s;
        const after = w.at[order.indexOf(k + 1)]!.s;
        const delay = after - before;
        maxDelayS = Math.max(maxDelayS, delay);
        if (delay > allowedDelay(before, input.maxDetourS, input.maxDetourPercent)) ok = false;
      }
      if (!ok) continue;
      const addedS = w.totalS - base.totalS;
      if (
        !best ||
        addedS < best.addedS ||
        (addedS === best.addedS && pickupEtaS < best.pickupEtaS)
      ) {
        best = {
          stops: order.map(stopOf),
          pickupEtaS: Math.round(pickupEtaS),
          addedS: Math.round(addedS),
          addedM: Math.round(w.totalM - base.totalM),
          maxDelayS: Math.round(maxDelayS),
          riderInCarM: Math.round(w.at[posD]!.m - w.at[posP]!.m),
        };
      }
    }
  }
  return best;
}

/**
 * Metres of the plan each rider spends in the car together with at least one other app
 * rider: the part of their trip that is shared. People riding without the app do not count
 * (nothing proves they were there).
 */
export function sharedMetres(
  stops: readonly PlanStop[],
  legM: (from: number, to: number) => number,
): Map<string, number> {
  const inCar = new Set(onboardRides(stops).keys());
  const shared = new Map<string, number>();
  for (const s of stops) if (s.rideId) shared.set(s.rideId, 0);
  let prev = 0;
  stops.forEach((stop, idx) => {
    const metres = legM(prev, idx + 1);
    if (inCar.size >= 2) {
      for (const id of inCar) shared.set(id, (shared.get(id) ?? 0) + metres);
    }
    if (stop.rideId && stop.type === 'pickup') inCar.add(stop.rideId);
    if (stop.rideId && stop.type === 'dropoff') inCar.delete(stop.rideId);
    prev = idx + 1;
  });
  return shared;
}

/** Leg lengths of a plan from the car along its stops (straight-line × factor fallback). */
export function planLegs(driver: Point, stops: readonly PlanStop[], detourFactor: number) {
  const pts = [driver, ...stops];
  return (from: number, to: number) =>
    Math.round(
      distanceM(pts[from]!.lat, pts[from]!.lng, pts[to]!.lat, pts[to]!.lng) * detourFactor,
    );
}

/**
 * A rider's shared-ride discount: the full percent once at least the full-discount share of
 * their own trip was shared, proportionally less below it. Whole 100 so'm (cash), never
 * more than the fare.
 */
export function poolDiscount(
  fare: number,
  tripM: number,
  sharedM: number,
  rules: Pick<PoolRules, 'discount_percent' | 'full_discount_share_percent'>,
): number {
  if (fare <= 0 || sharedM <= 0 || tripM <= 0) return 0;
  const needed = (tripM * rules.full_discount_share_percent) / 100;
  const share = Math.min(1, sharedM / needed);
  const discount = Math.floor((fare * rules.discount_percent * share) / 100 / 100) * 100;
  return Math.max(0, Math.min(fare, discount));
}

export interface PoolRider {
  rideId: string;
  /** The rider's own quoted fare (what they pay alone). */
  fare: number;
  /** Their own trip's road distance (the quote's). */
  tripM: number;
  /** Shared metres so far (stored) plus the plan's change. */
  sharedM: number;
  /** Fixed per-seat fares are already a shared price: no discount on top. */
  discountable: boolean;
}

/**
 * What each rider pays and what the driver gets. The driver's take from a new rider must
 * cover the detour: a match that leaves the driver worse off than without it is refused
 * by the caller (driverGain < detour cost).
 */
export function poolSplit(riders: readonly PoolRider[], rules: PoolRules) {
  const lines = riders.map((r) => {
    const discount = r.discountable ? poolDiscount(r.fare, r.tripM, r.sharedM, rules) : 0;
    return { rideId: r.rideId, fare: r.fare, discount, pays: r.fare - discount };
  });
  return { lines, driverTotal: lines.reduce((s, l) => s + l.pays, 0) };
}
