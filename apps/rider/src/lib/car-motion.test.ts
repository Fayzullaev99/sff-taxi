import { describe, expect, it } from 'vitest';
import {
  acceptFix,
  bearing,
  type EtaDisplay,
  fixIsStale,
  glideAt,
  glideMs,
  headingFor,
  lerpPoint,
  metresBetween,
  planGlide,
  shortestRotation,
  steadyEta,
  type TimedPoint,
} from './car-motion';

const P = { lat: 40.49598, lng: 68.77587 };
/** A point `m` metres north (+) of P. */
const north = (m: number) => ({ lat: P.lat + m / 111_320, lng: P.lng });
/** A point `m` metres east (+) of P. */
const east = (m: number) => ({
  lat: P.lat,
  lng: P.lng + m / (111_320 * Math.cos((P.lat * Math.PI) / 180)),
});
const at = (s: number) => new Date(Date.UTC(2026, 8, 29, 9, 0, s)).toISOString();
const fix = (p: { lat: number; lng: number }, s: number, heading: number | null = null) =>
  ({ ...p, heading, at: at(s) }) as TimedPoint;

describe('direction', () => {
  it('measures bearings on the compass', () => {
    expect(bearing(P, north(100))).toBeCloseTo(0, 0);
    expect(bearing(P, east(100))).toBeCloseTo(90, 0);
    expect(bearing(north(100), P)).toBeCloseTo(180, 0);
    expect(bearing(east(100), P)).toBeCloseTo(270, 0);
  });

  it('turns the shortest way round', () => {
    expect(shortestRotation(350, 10)).toBe(370);
    expect(shortestRotation(10, 350)).toBe(-10);
    expect(shortestRotation(90, 180)).toBe(180);
    // an unwrapped angle keeps turning the short way
    expect(shortestRotation(370, 20)).toBe(380);
  });

  it('points where the car moved, else where the phone says, else keeps the last', () => {
    expect(headingFor(P, { ...east(50), heading: 10 }, null)).toBeCloseTo(90, 0);
    // a few metres of jitter: the reported heading wins
    expect(headingFor(P, { ...east(3), heading: 200 }, 45)).toBe(200);
    // standing still without a reported heading: keep the direction
    expect(headingFor(P, { ...east(2), heading: null }, 45)).toBe(45);
    expect(headingFor(null, { ...P, heading: -1 }, null)).toBeNull();
  });
});

describe('believable fixes', () => {
  it('takes normal driving and small jumps', () => {
    // 100 m in 5 s = 72 km/h
    expect(acceptFix(fix(P, 0), fix(north(100), 5), 0)).toBe(true);
    // 140 m even in 1 s: below the jump that is worth dropping
    expect(acceptFix(fix(P, 0), fix(north(140), 1), 0)).toBe(true);
    expect(acceptFix(null, fix(P, 0), 0)).toBe(true);
  });

  it('drops a jump faster than 150 km/h, but not twice in a row', () => {
    // 800 m in 4 s = 720 km/h
    expect(acceptFix(fix(P, 0), fix(north(800), 4), 0)).toBe(false);
    expect(acceptFix(fix(P, 0), fix(north(800), 8), 1)).toBe(true);
    // a long gap makes a long move believable
    expect(acceptFix(fix(P, 0), fix(north(800), 60), 0)).toBe(true);
  });
});

describe('gliding', () => {
  it('glides for the time between fixes, bounded, and jumps on the first or a far one', () => {
    expect(glideMs(null, fix(P, 0))).toBe(0);
    expect(glideMs(fix(P, 0), fix(north(40), 4))).toBe(4_000);
    expect(glideMs(fix(P, 0), fix(north(40), 30))).toBe(5_000);
    expect(glideMs(fix(P, 4), fix(north(10), 4))).toBe(600);
    expect(glideMs(fix(P, 0), fix(north(2_000), 60))).toBe(0);
  });

  it('interpolates linearly and clamps', () => {
    const to = north(100);
    const mid = lerpPoint(P, to, 0.5);
    expect(metresBetween(P, mid)).toBeCloseTo(50, 0);
    expect(lerpPoint(P, to, 2)).toEqual(to);
    expect(lerpPoint(P, to, -1)).toEqual(P);
  });

  it('calls a fix older than 45 s stale', () => {
    const now = new Date(at(0)).getTime();
    expect(fixIsStale(at(-10), now)).toBe(false);
    expect(fixIsStale(at(-50), now)).toBe(true);
    expect(fixIsStale(null, now)).toBe(false);
  });
});

describe('a steady ETA', () => {
  const run = (steps: [number | null, number][]) => {
    let s: EtaDisplay = { shown: null, higherSince: null };
    return steps.map(([v, t]) => (s = steadyEta(s, v, t)).shown);
  };

  it('goes down at once', () => {
    expect(
      run([
        [5, 0],
        [4, 15_000],
        [3, 30_000],
      ]),
    ).toEqual([5, 4, 3]);
  });

  it('holds a one-minute rise until it lasted 30 s', () => {
    expect(
      run([
        [4, 0],
        [5, 10_000],
        [4, 20_000],
        [5, 30_000],
        [5, 50_000],
        [5, 60_000],
      ]),
    ).toEqual([4, 4, 4, 4, 4, 5]);
  });

  it('shows a rise of two minutes or more at once, and nothing without an ETA', () => {
    expect(
      run([
        [4, 0],
        [7, 1_000],
        [null, 2_000],
        [6, 3_000],
      ]),
    ).toEqual([4, 7, null, 6]);
  });
});

describe('a glide between fixes', () => {
  it('starts where the marker is shown, ends on the fix, turning the short way', () => {
    const shown = { point: P, rotation: 350 };
    const plan = planGlide(shown, fix(P, 0), fix(north(40), 4), 10, 1_000);
    expect(plan.durationMs).toBe(4_000);
    expect(plan.toRotation).toBe(370);
    const start = glideAt(plan, 1_000);
    expect(start.point).toEqual(P);
    expect(start.rotation).toBe(350);
    const mid = glideAt(plan, 3_000);
    expect(metresBetween(P, mid.point)).toBeCloseTo(20, 0);
    // the turn is done in the first third
    expect(mid.rotation).toBe(370);
    const end = glideAt(plan, 9_000);
    expect(metresBetween(end.point, north(40))).toBeLessThan(0.01);
  });

  it('puts the first fix in place at once and keeps the turn without a heading', () => {
    const first = planGlide(null, null, fix(P, 0), null, 0);
    expect(first.durationMs).toBe(0);
    expect(glideAt(first, 0)).toEqual({ point: { lat: P.lat, lng: P.lng }, rotation: 0 });
    const still = planGlide({ point: P, rotation: 45 }, fix(P, 0), fix(P, 4), null, 0);
    expect(still.toRotation).toBe(45);
  });
});
