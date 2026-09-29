import { describe, expect, it } from 'vitest';
import { distanceM } from './distance.js';
import { estimatedDurationS, type Point } from './geo.js';
import {
  allowedDelay,
  bestInsertion,
  carCapacity,
  DEFAULT_POOL,
  type InsertionInput,
  type LegMatrix,
  MAX_PASSENGERS,
  onboardRides,
  type PlanStop,
  poolDiscount,
  poolPoints,
  poolSplit,
  seatLayout,
  sharedMetres,
} from './pool.js';

/** Points along a straight road east of Guliston: `km` kilometres from the start. */
const ORIGIN = { lat: 40.49, lng: 68.78 };
const east = (km: number, northKm = 0): Point => ({
  lat: ORIGIN.lat + northKm / 110.574,
  lng: ORIGIN.lng + km / (111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
});

/** Straight-line legs at 60 km/h: a road without detours, for exact expectations. */
function matrixOf(points: Point[]): LegMatrix {
  return points.map((a) =>
    points.map((b) => {
      const m = distanceM(a.lat, a.lng, b.lat, b.lng);
      return { distanceM: m, durationS: m / (60 / 3.6) };
    }),
  );
}

function input(
  driver: Point,
  stops: PlanStop[],
  request: InsertionInput['request'],
  over: Partial<InsertionInput> = {},
): InsertionInput {
  return {
    driver,
    stops,
    extraOnboard: 0,
    capacity: 3,
    request,
    maxDetourS: DEFAULT_POOL.max_detour_seconds_intercity,
    maxDetourPercent: DEFAULT_POOL.max_detour_percent,
    maxPickupEtaS: 3600,
    matrix: matrixOf(poolPoints(driver, stops, request)),
    ...over,
  };
}

const drop = (rideId: string, p: Point, passengers = 1): PlanStop => ({
  rideId,
  type: 'dropoff',
  ...p,
  passengers,
});
const pick = (rideId: string, p: Point, passengers = 1): PlanStop => ({
  rideId,
  type: 'pickup',
  ...p,
  passengers,
});

describe('seating rule', () => {
  it('never seats more than one in front and two in the back', () => {
    expect(MAX_PASSENGERS).toBe(3);
    expect(carCapacity(4)).toBe(3);
    expect(carCapacity(7)).toBe(3);
    expect(carCapacity(2)).toBe(2);
    expect(seatLayout(3, 4)).toEqual({ occupied: 3, capacity: 3, front: 1, rear: 2, free: 0 });
    expect(seatLayout(1, 4)).toEqual({ occupied: 1, capacity: 3, front: 1, rear: 0, free: 2 });
    // more people than seats is clamped, never shown as a third rear seat
    expect(seatLayout(5, 4).rear).toBe(2);
  });
});

describe('inserting a rider on the way', () => {
  it('takes a rider joining halfway to the same destination with no detour', () => {
    const plan = [drop('A', east(100))];
    const ins = bestInsertion(
      input(east(0), plan, { rideId: 'B', pickup: east(50), dropoff: east(100), passengers: 1 }),
    )!;
    expect(ins).not.toBeNull();
    expect(ins.stops[0]).toMatchObject({ rideId: 'B', type: 'pickup' });
    expect(ins.stops).toHaveLength(3);
    expect(ins.addedS).toBeLessThan(1);
    expect(ins.maxDelayS).toBeLessThan(1);
  });

  it('without a router, a stop on the way to another town is no detour (QA wave 4)', () => {
    // the router's estimate: straight line x 1.35, the first 5 km at city speed
    const estimated = (points: Point[]): LegMatrix =>
      points.map((a) =>
        points.map((b) => {
          const m = distanceM(a.lat, a.lng, b.lat, b.lng) * 1.35;
          return { distanceM: m, durationS: estimatedDurationS(m), estimated: true };
        }),
      );
    // heading 25 km out of town with a friend in front, a rider from here to 7 km on the way
    const plan: PlanStop[] = [{ rideId: null, type: 'destination', ...east(25), passengers: 1 }];
    const request = { rideId: 'B', pickup: east(0.3), dropoff: east(7), passengers: 1 };
    const over = {
      extraOnboard: 1,
      maxDetourS: DEFAULT_POOL.max_detour_seconds_city,
      maxPickupEtaS: DEFAULT_POOL.max_pickup_eta_seconds,
    };
    const matrix = estimated(poolPoints(east(0), plan, request));
    const ins = bestInsertion(input(east(0), plan, request, { ...over, matrix }))!;
    expect(ins).not.toBeNull();
    expect(ins.addedS).toBeLessThan(5);
    expect(ins.maxDelayS).toBeLessThan(5);
    // counted per leg (each leg starting at city speed) the same trip was a 7-minute detour
    const perLeg = matrix.map((row) =>
      row.map((l) => ({ distanceM: l.distanceM, durationS: l.durationS })),
    );
    expect(bestInsertion(input(east(0), plan, request, { ...over, matrix: perLeg }))).toBeNull();
  });

  it('refuses a rider far off the route', () => {
    const plan = [drop('A', east(20))];
    const ins = bestInsertion(
      input(
        east(0),
        plan,
        { rideId: 'B', pickup: east(10, 8), dropoff: east(20, 8), passengers: 1 },
        { maxDetourS: DEFAULT_POOL.max_detour_seconds_city },
      ),
    );
    expect(ins).toBeNull();
  });

  it('accepts a small detour within the limits', () => {
    const plan = [drop('A', east(20))];
    const ins = bestInsertion(
      input(
        east(0),
        plan,
        { rideId: 'B', pickup: east(8, 0.5), dropoff: east(15, 0.3), passengers: 1 },
        { maxDetourS: DEFAULT_POOL.max_detour_seconds_city },
      ),
    )!;
    expect(ins).not.toBeNull();
    expect(ins.maxDelayS).toBeGreaterThan(0);
    expect(ins.maxDelayS).toBeLessThanOrEqual(DEFAULT_POOL.max_detour_seconds_city);
  });

  it('never puts more than three people in the car', () => {
    const plan = [drop('A', east(30), 2)];
    const req = { rideId: 'B', pickup: east(5), dropoff: east(25), passengers: 2 };
    expect(bestInsertion(input(east(0), plan, req))).toBeNull();
    // one person fits (1 front + 2 back)
    expect(bestInsertion(input(east(0), plan, { ...req, passengers: 1 }))).not.toBeNull();
    // the people riding without the app count too
    expect(
      bestInsertion(input(east(0), plan, { ...req, passengers: 1 }, { extraOnboard: 1 })),
    ).toBeNull();
  });

  it('is not a shared ride when the new rider gets in after everyone got out', () => {
    // A gets out at 10 km; B gets in at 12 km: the car is simply free by then
    const plan = [drop('A', east(10), 3)];
    const ins = bestInsertion(
      input(east(0), plan, { rideId: 'B', pickup: east(12), dropoff: east(20), passengers: 2 }),
    );
    expect(ins).toBeNull();
  });

  it('keeps the driver’s destination last', () => {
    const plan: PlanStop[] = [{ rideId: null, type: 'destination', ...east(30), passengers: 1 }];
    const along = bestInsertion(
      input(east(0), plan, { rideId: 'B', pickup: east(5), dropoff: east(25), passengers: 1 }),
    )!;
    expect(along.stops.at(-1)!.type).toBe('destination');
    // beyond the destination is not "on the way"
    const beyond = bestInsertion(
      input(
        east(0),
        plan,
        { rideId: 'B', pickup: east(5), dropoff: east(60), passengers: 1 },
        { maxDetourS: DEFAULT_POOL.max_detour_seconds_city },
      ),
    );
    expect(beyond).toBeNull();
  });

  it('does not keep a rider who is almost home waiting long', () => {
    // 2 minutes allowed for a rider 1 minute from home, whatever the cap
    expect(allowedDelay(60, 900, 50)).toBe(120);
    expect(allowedDelay(3600, 900, 50)).toBe(900);
    expect(allowedDelay(600, 900, 50)).toBe(300);
  });

  it('refuses a car too far from the new pickup', () => {
    const plan = [drop('A', east(100))];
    const ins = bestInsertion(
      input(
        east(0),
        plan,
        { rideId: 'B', pickup: east(50), dropoff: east(100), passengers: 1 },
        { maxPickupEtaS: 900 },
      ),
    );
    expect(ins).toBeNull();
  });

  it('knows who is in the car from the stops ahead', () => {
    const stops = [pick('B', east(5)), drop('A', east(10), 2), drop('B', east(12))];
    expect([...onboardRides(stops)]).toEqual([['A', 2]]);
  });
});

describe('shared distance and prices', () => {
  it('matches the founder’s example: 100 000 + 40 000 at 15% -> 85 000, 34 000, driver 119 000', () => {
    const driver = east(0);
    const stops = [pick('B', east(50)), drop('A', east(100)), drop('B', east(100))];
    const pts = [driver, ...stops];
    const shared = sharedMetres(stops, (a, b) =>
      distanceM(pts[a]!.lat, pts[a]!.lng, pts[b]!.lat, pts[b]!.lng),
    );
    expect(shared.get('A')).toBeCloseTo(50_000, -3);
    expect(shared.get('B')).toBeCloseTo(50_000, -3);
    const split = poolSplit(
      [
        {
          rideId: 'A',
          fare: 100_000,
          tripM: 2 * shared.get('A')!,
          sharedM: shared.get('A')!,
          discountable: true,
        },
        { rideId: 'B', fare: 40_000, tripM: 50_000, sharedM: shared.get('B')!, discountable: true },
      ],
      DEFAULT_POOL,
    );
    expect(split.lines.map((l) => l.pays)).toEqual([85_000, 34_000]);
    expect(split.driverTotal).toBe(119_000);
  });

  it('gives a proportional discount for a short shared part', () => {
    // 5 km shared of a 40 km trip: 5 / 20 of the full 15%
    expect(poolDiscount(60_000, 40_000, 5000, DEFAULT_POOL)).toBe(2200);
    expect(poolDiscount(60_000, 40_000, 0, DEFAULT_POOL)).toBe(0);
    expect(poolDiscount(60_000, 40_000, 40_000, DEFAULT_POOL)).toBe(9000);
  });

  it('gives no discount on a fixed seat fare', () => {
    const split = poolSplit(
      [{ rideId: 'S', fare: 10_000, tripM: 40_000, sharedM: 40_000, discountable: false }],
      DEFAULT_POOL,
    );
    expect(split.lines[0]!.pays).toBe(10_000);
  });

  it('counts nothing shared while a rider is alone in the car', () => {
    const stops = [drop('A', east(10)), pick('B', east(12)), drop('B', east(20))];
    const pts = [east(0), ...stops];
    const shared = sharedMetres(stops, (a, b) =>
      distanceM(pts[a]!.lat, pts[a]!.lng, pts[b]!.lat, pts[b]!.lng),
    );
    expect(shared.get('A')).toBe(0);
    expect(shared.get('B')).toBe(0);
  });
});
