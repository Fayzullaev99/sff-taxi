import { z } from 'zod';
import { distanceM } from './distance.js';

/** Plane geometry for service areas (no PostGIS). Coordinates follow GeoJSON: [lng, lat]. */

export interface Point {
  lat: number;
  lng: number;
}
export type Position = [lng: number, lat: number];
/** A closed ring: the first position repeats as the last. */
export type Ring = Position[];
/** Polygon rings: the first is the outer boundary, any further ones are holes. */
export type PolygonRings = Ring[];

export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const RingSchema = z
  .array(Position)
  .min(4)
  .max(500)
  .refine(
    (r) => r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1],
    'Halqa yopiq bo‘lishi kerak',
  );
export const PolygonSchema = z.array(RingSchema).min(1).max(20);

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export function bboxOf(rings: PolygonRings): BBox {
  const outer = rings[0]!;
  const lats = outer.map((p) => p[1]);
  const lngs = outer.map((p) => p[0]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

/** Whether a point lies in a box widened on every side by `marginM` metres. */
export function inBBox(p: Point, b: BBox, marginM = 0): boolean {
  const dLat = marginM / M_PER_DEG_LAT;
  const dLng = marginM / mPerDegLng(p.lat);
  return (
    p.lat >= b.minLat - dLat &&
    p.lat <= b.maxLat + dLat &&
    p.lng >= b.minLng - dLng &&
    p.lng <= b.maxLng + dLng
  );
}

/** Ray casting (even-odd rule). Points exactly on an edge may fall either way. */
export function pointInRing(p: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: Point, rings: PolygonRings): boolean {
  if (!pointInRing(p, rings[0]!)) return false;
  return !rings.slice(1).some((hole) => pointInRing(p, hole));
}

/**
 * Metres from a point to the nearest edge of a polygon (0 inside). A local flat
 * projection around the point: accurate to well under 1% at city scale.
 */
export function distanceToPolygonM(p: Point, rings: PolygonRings): number {
  if (pointInPolygon(p, rings)) return 0;
  const kx = mPerDegLng(p.lat);
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const ax = (ring[i]![0] - p.lng) * kx;
      const ay = (ring[i]![1] - p.lat) * M_PER_DEG_LAT;
      const bx = (ring[i + 1]![0] - p.lng) * kx;
      const by = (ring[i + 1]![1] - p.lat) * M_PER_DEG_LAT;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

export interface Area<T> {
  item: T;
  boundary: PolygonRings;
  bbox: BBox;
}

/** The area containing the point, or the nearest one and how far its boundary is. */
export function locate<T>(
  p: Point,
  areas: readonly Area<T>[],
): { inside: T } | { inside: null; nearest: { item: T; distanceM: number } | null } {
  const hit = areas.find((a) => inBBox(p, a.bbox) && pointInPolygon(p, a.boundary));
  if (hit) return { inside: hit.item };
  let nearest: { item: T; distanceM: number } | null = null;
  for (const a of areas) {
    const d = distanceToPolygonM(p, a.boundary);
    if (!nearest || d < nearest.distanceM) nearest = { item: a.item, distanceM: Math.round(d) };
  }
  return { inside: null, nearest };
}

// Road distance -----------------------------------------------------------------------

export interface Route {
  /** Metres along the road (or the estimate of it). */
  distanceM: number;
  /** Driving time from the router; null for an estimate. */
  durationS: number | null;
  source: 'osrm' | 'estimate';
}

/**
 * Road distance without a router: the straight line times a detour factor. In a
 * small city with a street grid ~1.3-1.4 is honest.
 */
export function estimateRoute(from: Point, to: Point, detourFactor: number): Route {
  const straight = distanceM(from.lat, from.lng, to.lat, to.lng);
  return { distanceM: Math.round(straight * detourFactor), durationS: null, source: 'estimate' };
}

/** Average door-to-door city speed without a router: ~25 km/h in m/s. */
export const CITY_SPEED_MPS = 25 / 3.6;

/** Average speed between towns without a router: ~60 km/h in m/s. */
export const ROAD_SPEED_MPS = 60 / 3.6;

/**
 * Driving time of an estimated route: the first 5 km at city speed, the rest at road speed
 * (a trip to Yangiyer is not driven at 25 km/h).
 */
export function estimatedDurationS(distanceM: number): number {
  const city = Math.min(distanceM, 5000);
  return Math.round(city / CITY_SPEED_MPS + (distanceM - city) / ROAD_SPEED_MPS);
}

/** Driving time in seconds: the router's when known, else the distance at city speed. */
export function etaSeconds(route: Route): number {
  return route.durationS !== null
    ? Math.round(route.durationS)
    : Math.round(route.distanceM / CITY_SPEED_MPS);
}

// Driver location quality ----------------------------------------------------------------

export interface Fix extends Point {
  at: Date;
  /** Reported accuracy radius in metres, when the app sends one. */
  accuracy?: number | null;
}

export type FixVerdict =
  { ok: true } | { ok: false; reason: 'inaccurate' | 'too_fast' | 'outside' };

export const FIX_LIMITS = {
  maxAccuracyM: 100,
  maxSpeedKmh: 150,
  /**
   * How far outside every city's box a fix may still be: intercity rides go to Tashkent
   * (~120 km) and Jizzakh, so only fixes beyond that are treated as nonsense.
   */
  areaMarginM: 150_000,
};

/**
 * Rejects fixes that are obviously wrong: too inaccurate, far from every service
 * area, or implying a speed no car in the city reaches since the last good fix.
 */
export function assessFix(
  fix: Fix,
  previous: Fix | null,
  areas: readonly BBox[],
  limits = FIX_LIMITS,
): FixVerdict {
  if (fix.accuracy != null && fix.accuracy > limits.maxAccuracyM) {
    return { ok: false, reason: 'inaccurate' };
  }
  if (!areas.some((b) => inBBox(fix, b, limits.areaMarginM)))
    return { ok: false, reason: 'outside' };
  if (previous) {
    const metres = distanceM(previous.lat, previous.lng, fix.lat, fix.lng);
    // at least one second apart, so two fixes in the same instant are not "infinitely fast"
    const seconds = Math.max(1, (fix.at.getTime() - previous.at.getTime()) / 1000);
    // tolerate the GPS noise of a standing car
    if (metres > 200 && (metres / seconds) * 3.6 > limits.maxSpeedKmh) {
      return { ok: false, reason: 'too_fast' };
    }
  }
  return { ok: true };
}
