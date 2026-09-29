/**
 * The car on the rider's map (pure, unit-tested): which fixes to believe, where the car
 * points and how long it glides from one fix to the next, plus an ETA that does not
 * flicker. The map animates natively between the planned points (see ui/RideMap.tsx).
 */

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface TimedPoint extends LatLngPoint {
  heading: number | null;
  /** ISO time of the fix. */
  at: string;
}

const RAD = Math.PI / 180;

/** Straight-line metres (haversine). */
export function metresBetween(a: LatLngPoint, b: LatLngPoint): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function normaliseDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Compass bearing from a to b, 0–360° (0 = north, 90 = east). */
export function bearing(a: LatLngPoint, b: LatLngPoint): number {
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return normaliseDeg(Math.atan2(y, x) / RAD);
}

/**
 * The rotation to show that turns the shortest way from `from` to `to`: 350° → 10° goes
 * through 360° (+20°), not back through 180° (−340°). Returns an unwrapped angle.
 */
export function shortestRotation(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}

/** Moves shorter than this say nothing reliable about the direction (GPS jitter). */
const HEADING_MIN_MOVE_M = 8;

/**
 * Where the car points: the direction it moved in when it moved far enough, else the
 * heading the driver's phone reported, else the previous one (a car waiting at a light
 * keeps its direction instead of spinning with GPS noise).
 */
export function headingFor(
  prev: LatLngPoint | null,
  next: LatLngPoint & { heading?: number | null },
  previousHeading: number | null,
): number | null {
  if (prev && metresBetween(prev, next) >= HEADING_MIN_MOVE_M) return bearing(prev, next);
  if (typeof next.heading === 'number' && Number.isFinite(next.heading) && next.heading >= 0) {
    return normaliseDeg(next.heading);
  }
  return previousHeading;
}

/** Faster than this between two fixes is a GPS glitch in a town (150 km/h). */
const MAX_SPEED_MS = 150 / 3.6;
/** Jumps shorter than this are never glitches worth dropping. */
const MIN_JUMP_M = 150;

/**
 * Whether a new fix is believable after the last accepted one: a jump implying more than
 * 150 km/h is dropped, unless it was confirmed (`rejectedInARow` ≥ 1: the previous fix was
 * dropped too, so the car really is elsewhere, e.g. after a long gap).
 */
export function acceptFix(
  last: TimedPoint | null,
  next: TimedPoint,
  rejectedInARow: number,
): boolean {
  if (!last || rejectedInARow >= 1) return true;
  const metres = metresBetween(last, next);
  if (metres < MIN_JUMP_M) return true;
  const seconds = (new Date(next.at).getTime() - new Date(last.at).getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  return metres / seconds <= MAX_SPEED_MS;
}

/** Glides take the time between fixes (the car arrives as the next fix is due), bounded. */
const GLIDE_MIN_MS = 600;
const GLIDE_MAX_MS = 5_000;
/** Farther than this, the car jumps: gliding across town looks worse than a jump. */
const TELEPORT_M = 1_000;

/**
 * How long the marker glides to a new fix: the time since the previous fix (so it keeps
 * moving until the next one is due), between 0.6 and 5 s; 0 (jump) for the first fix or
 * a very long move.
 */
export function glideMs(prev: TimedPoint | null, next: TimedPoint): number {
  if (!prev) return 0;
  if (metresBetween(prev, next) > TELEPORT_M) return 0;
  const gap = new Date(next.at).getTime() - new Date(prev.at).getTime();
  if (!Number.isFinite(gap) || gap <= 0) return GLIDE_MIN_MS;
  return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, gap));
}

/** Linear position between two points, t in [0, 1] (constant speed looks like driving). */
export function lerpPoint(from: LatLngPoint, to: LatLngPoint, t: number): LatLngPoint {
  const k = Math.min(1, Math.max(0, t));
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
}

/** No fix for this long while a car is on its way: the link is probably down. */
export const FIX_STALE_MS = 45_000;

export function fixIsStale(at: string | null | undefined, now: number): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && now - t > FIX_STALE_MS;
}

/**
 * The minutes shown as the ETA, steadied: going down is shown at once; going up by a
 * minute (road ETA recomputed, rounding) only once it held for 30 s, or at once when it
 * grew by two minutes or more. Stops "4 → 5 → 4 daq" flicker.
 */
export interface EtaDisplay {
  shown: number | null;
  /** Since when a higher value is waiting to be shown (epoch ms). */
  higherSince: number | null;
}

const ETA_HOLD_MS = 30_000;

export function steadyEta(state: EtaDisplay, next: number | null, now: number): EtaDisplay {
  if (next === null) return { shown: null, higherSince: null };
  if (state.shown === null || next <= state.shown) return { shown: next, higherSince: null };
  if (next - state.shown >= 2) return { shown: next, higherSince: null };
  const since = state.higherSince ?? now;
  if (now - since >= ETA_HOLD_MS) return { shown: next, higherSince: null };
  return { shown: state.shown, higherSince: since };
}

/** One glide of the marker: from where it is shown now to the newest fix. */
export interface GlidePlan {
  from: LatLngPoint;
  to: LatLngPoint;
  /** Unwrapped angles (see shortestRotation), so the turn goes the short way. */
  fromRotation: number;
  toRotation: number;
  startAt: number;
  durationMs: number;
}

/** Where the marker is (and how it is turned) at `now` during a glide. */
export function glideAt(plan: GlidePlan, now: number): { point: LatLngPoint; rotation: number } {
  const t = plan.durationMs <= 0 ? 1 : (now - plan.startAt) / plan.durationMs;
  const k = Math.min(1, Math.max(0, t));
  // the turn is quicker than the move: a car turns at the corner, not along the block
  const turn = Math.min(1, k * 3);
  return {
    point: lerpPoint(plan.from, plan.to, k),
    rotation: plan.fromRotation + (plan.toRotation - plan.fromRotation) * turn,
  };
}

/**
 * The next glide after a new fix arrives: it starts where the marker is shown now (the
 * previous glide may be midway), lasts the time between the fixes, and turns the short
 * way to the new heading.
 */
export function planGlide(
  shown: { point: LatLngPoint; rotation: number } | null,
  prevFix: TimedPoint | null,
  nextFix: TimedPoint,
  heading: number | null,
  now: number,
): GlidePlan {
  const from = shown?.point ?? nextFix;
  const fromRotation = shown?.rotation ?? heading ?? 0;
  const toRotation = heading === null ? fromRotation : shortestRotation(fromRotation, heading);
  return {
    from,
    to: { lat: nextFix.lat, lng: nextFix.lng },
    fromRotation,
    toRotation,
    startAt: now,
    durationMs: shown ? glideMs(prevFix, nextFix) : 0,
  };
}
