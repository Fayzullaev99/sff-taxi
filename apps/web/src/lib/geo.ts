import type { BBox, LatLng, PolygonRings } from '../api/types';

/** Great-circle distance in metres (same formula as the API). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

// Service areas: same rules as the API (apps/api/src/lib/geo.ts). Rings are [lng, lat].

function pointInRing(p: LatLng, ring: [number, number][]): boolean {
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

export function pointInPolygon(p: LatLng, rings: PolygonRings): boolean {
  if (!rings[0] || !pointInRing(p, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(p, hole));
}

/** The first area whose boundary contains the point. */
export function areaAt<T extends { boundary: PolygonRings }>(
  p: LatLng,
  areas: readonly T[],
): T | null {
  return areas.find((a) => pointInPolygon(p, a.boundary)) ?? null;
}

export function ringsBBox(rings: PolygonRings): BBox | null {
  const outer = rings[0];
  if (!outer?.length) return null;
  return {
    minLat: Math.min(...outer.map((p) => p[1])),
    maxLat: Math.max(...outer.map((p) => p[1])),
    minLng: Math.min(...outer.map((p) => p[0])),
    maxLng: Math.max(...outer.map((p) => p[0])),
  };
}

/** Outline corners, for fitting a map to an area. */
export function ringsPoints(rings: PolygonRings): LatLng[] {
  return (rings[0] ?? []).map(([lng, lat]) => ({ lat, lng }));
}

const MAX_RINGS = 20;
const MAX_POINTS = 500;

/**
 * Parses a boundary typed as JSON: polygon rings of [lng, lat], each closed, at least four
 * positions, like the API's PolygonSchema. Accepts a GeoJSON Polygon / Feature too.
 */
export function parseBoundary(text: string): { rings: PolygonRings } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'JSON noto‘g‘ri: qavslar va vergullarni tekshiring' };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as { type?: unknown; coordinates?: unknown; geometry?: unknown };
    if (v.type === 'Feature' && v.geometry) value = v.geometry;
    const g = value as { type?: unknown; coordinates?: unknown };
    if (g.type === 'Polygon') value = g.coordinates;
    else return { error: 'Faqat Polygon: halqalar ro‘yxati [[[lng, lat], …]]' };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'Halqalar ro‘yxati kerak: [[[lng, lat], …]]' };
  }
  if (value.length > MAX_RINGS) return { error: `Ko‘pi bilan ${MAX_RINGS} ta halqa` };
  const rings: PolygonRings = [];
  for (const [ri, ring] of value.entries()) {
    const name = ri === 0 ? 'Tashqi chegara' : `${ri}-teshik`;
    if (!Array.isArray(ring)) return { error: `${name}: nuqtalar ro‘yxati kerak` };
    if (ring.length < 4)
      return { error: `${name}: kamida 4 ta nuqta (oxirgisi birinchisi bilan bir xil)` };
    if (ring.length > MAX_POINTS) return { error: `${name}: ko‘pi bilan ${MAX_POINTS} ta nuqta` };
    const points: [number, number][] = [];
    for (const [pi, pos] of ring.entries()) {
      if (
        !Array.isArray(pos) ||
        pos.length !== 2 ||
        typeof pos[0] !== 'number' ||
        typeof pos[1] !== 'number' ||
        !Number.isFinite(pos[0]) ||
        !Number.isFinite(pos[1])
      ) {
        return { error: `${name}, ${pi + 1}-nuqta: [uzunlik, kenglik] sonlar juftligi kerak` };
      }
      const [lng, lat] = pos as [number, number];
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        return { error: `${name}, ${pi + 1}-nuqta: koordinata chegaradan tashqarida` };
      }
      points.push([lng, lat]);
    }
    const first = points[0]!;
    const last = points.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return { error: `${name}: halqa yopiq bo‘lishi kerak (oxirgi nuqta = birinchi nuqta)` };
    }
    rings.push(points);
  }
  return { rings };
}

/** Rings as compact JSON, one position per line group, for the boundary editor. */
export function formatBoundary(rings: PolygonRings): string {
  return `[\n${rings
    .map((ring) => `  [\n${ring.map(([lng, lat]) => `    [${lng}, ${lat}]`).join(',\n')}\n  ]`)
    .join(',\n')}\n]`;
}
