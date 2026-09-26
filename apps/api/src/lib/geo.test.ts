import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { distanceM } from './distance.js';
import {
  assessFix,
  bboxOf,
  distanceToPolygonM,
  estimateRoute,
  inBBox,
  locate,
  pointInPolygon,
  PolygonSchema,
  type PolygonRings,
  etaSeconds,
} from './geo.js';

// a 0.1° square around (40.5, 68.8) with a 0.02° hole in the middle
const outer: [number, number][] = [
  [68.75, 40.45],
  [68.85, 40.45],
  [68.85, 40.55],
  [68.75, 40.55],
  [68.75, 40.45],
];
const hole: [number, number][] = [
  [68.79, 40.49],
  [68.81, 40.49],
  [68.81, 40.51],
  [68.79, 40.51],
  [68.79, 40.49],
];
const square: PolygonRings = [outer];
const donut: PolygonRings = [outer, hole];

/** The cities seeded by migrations/0002_geo.sql. */
function seededCities() {
  const sql = readFileSync(new URL('../../migrations/0002_geo.sql', import.meta.url), 'utf8');
  const row =
    /\('([a-z]+)', '[^']+', '[^']+', ([\d.]+), ([\d.]+), (true|false), \d+,\s+'(\[\[\[[^']+\]\]\])'\)/g;
  return [...sql.matchAll(row)].map((m) => ({
    slug: m[1]!,
    center: { lat: Number(m[2]), lng: Number(m[3]) },
    isActive: m[4] === 'true',
    boundary: JSON.parse(m[5]!) as PolygonRings,
  }));
}

describe('point in polygon', () => {
  it('tells inside from outside, holes included', () => {
    expect(pointInPolygon({ lat: 40.46, lng: 68.76 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 40.56, lng: 68.8 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 40.5, lng: 68.8 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 40.5, lng: 68.8 }, donut)).toBe(false);
    expect(pointInPolygon({ lat: 40.46, lng: 68.76 }, donut)).toBe(true);
  });

  it('works for a concave shape', () => {
    // a "U": the notch between the arms is outside
    const u: PolygonRings = [
      [
        [0, 0],
        [3, 0],
        [3, 3],
        [2, 3],
        [2, 1],
        [1, 1],
        [1, 3],
        [0, 3],
        [0, 0],
      ],
    ];
    expect(pointInPolygon({ lng: 1.5, lat: 2 }, u)).toBe(false);
    expect(pointInPolygon({ lng: 0.5, lat: 2 }, u)).toBe(true);
    expect(pointInPolygon({ lng: 1.5, lat: 0.5 }, u)).toBe(true);
  });

  it('computes boxes and widens them by a margin in metres', () => {
    const b = bboxOf(square);
    expect(b).toEqual({ minLat: 40.45, maxLat: 40.55, minLng: 68.75, maxLng: 68.85 });
    const north = { lat: 40.64, lng: 68.8 }; // ~10 km north of the box
    expect(inBBox(north, b)).toBe(false);
    expect(inBBox(north, b, 5000)).toBe(false);
    expect(inBBox(north, b, 11_000)).toBe(true);
  });

  it('measures the distance to the boundary from outside', () => {
    expect(distanceToPolygonM({ lat: 40.5, lng: 68.76 }, square)).toBe(0);
    // 0.05° of latitude north of the top edge is ~5.5 km
    const d = distanceToPolygonM({ lat: 40.6, lng: 68.8 }, square);
    expect(d).toBeGreaterThan(5400);
    expect(d).toBeLessThan(5650);
  });

  it('resolves the containing area, or the nearest one', () => {
    const areas = [
      { item: 'a', boundary: square, bbox: bboxOf(square) },
      {
        item: 'b',
        boundary: [outer.map(([x, y]) => [x + 0.3, y] as [number, number])],
        bbox: bboxOf([outer.map(([x, y]) => [x + 0.3, y] as [number, number])]),
      },
    ];
    expect(locate({ lat: 40.5, lng: 68.8 }, areas)).toEqual({ inside: 'a' });
    expect(locate({ lat: 40.5, lng: 69.1 }, areas)).toEqual({ inside: 'b' });
    const between = locate({ lat: 40.5, lng: 69.0 }, areas);
    expect(between.inside).toBe(null);
    expect(between).toMatchObject({ nearest: { item: 'b' } });
  });

  it('validates polygons: closed rings of at least four positions', () => {
    expect(PolygonSchema.safeParse(square).success).toBe(true);
    expect(PolygonSchema.safeParse([outer.slice(0, -1)]).success).toBe(false);
    expect(PolygonSchema.safeParse([[[0, 0]]]).success).toBe(false);
    expect(
      PolygonSchema.safeParse([
        [
          [200, 0],
          [0, 1],
          [1, 1],
          [200, 0],
        ],
      ]).success,
    ).toBe(false);
  });
});

describe('seeded cities', () => {
  const cities = seededCities();

  it('has the launch region with Guliston active and the rest upcoming', () => {
    expect(cities.map((c) => c.slug)).toEqual([
      'guliston',
      'yangiyer',
      'shirin',
      'sirdaryo',
      'boyovut',
      'baxt',
      'sayxunobod',
      'xovos',
      'mirzaobod',
      'oqoltin',
      'sardoba',
    ]);
    expect(cities.filter((c) => c.isActive).map((c) => c.slug)).toEqual(['guliston']);
    const guliston = cities[0]!;
    expect(guliston.center.lat).toBeCloseTo(40.49, 1);
    expect(guliston.center.lng).toBeCloseTo(68.78, 1);
  });

  it('has valid, simple boundaries that contain their centres and do not overlap', () => {
    for (const c of cities) {
      expect(PolygonSchema.safeParse(c.boundary).success, c.slug).toBe(true);
      expect(c.boundary[0]!.length, c.slug).toBeLessThanOrEqual(41);
      expect(pointInPolygon(c.center, c.boundary), c.slug).toBe(true);
      for (const other of cities.filter((o) => o !== c)) {
        const overlaps = c.boundary[0]!.some(([lng, lat]) =>
          pointInPolygon({ lat, lng }, other.boundary),
        );
        expect(overlaps, `${c.slug} / ${other.slug}`).toBe(false);
      }
    }
  });
});

describe('road distance estimate', () => {
  const guliston = { lat: 40.49598, lng: 68.77587 };
  const sirdaryo = { lat: 40.8309, lng: 68.6662 };

  it('multiplies the straight line by the detour factor', () => {
    const straight = distanceM(guliston.lat, guliston.lng, sirdaryo.lat, sirdaryo.lng);
    // Guliston - Sirdaryo town is ~38 km in a straight line
    expect(straight).toBeGreaterThan(37_000);
    expect(straight).toBeLessThan(39_000);
    const route = estimateRoute(guliston, sirdaryo, 1.35);
    expect(route).toEqual({
      distanceM: Math.round(straight * 1.35),
      durationS: null,
      source: 'estimate',
    });
    expect(estimateRoute(guliston, guliston, 1.35).distanceM).toBe(0);
  });

  it('turns a route into seconds: router time when known, else the city speed', () => {
    expect(etaSeconds({ distanceM: 3000, durationS: 300, source: 'osrm' })).toBe(300);
    // 3 km at 25 km/h
    expect(etaSeconds({ distanceM: 3000, durationS: null, source: 'estimate' })).toBe(432);
  });
});

describe('driver location filter', () => {
  const areas = [bboxOf(square)];
  const at = new Date('2026-09-26T10:00:00Z');
  const later = (s: number) => new Date(at.getTime() + s * 1000);
  const start = { lat: 40.5, lng: 68.8, at };

  it('accepts a normal fix', () => {
    expect(assessFix({ lat: 40.501, lng: 68.8, at: later(10) }, start, areas)).toEqual({
      ok: true,
    });
    expect(assessFix(start, null, areas)).toEqual({ ok: true });
  });

  it('rejects an inaccurate fix only when the phone says so', () => {
    expect(assessFix({ ...start, accuracy: 150 }, null, areas)).toEqual({
      ok: false,
      reason: 'inaccurate',
    });
    expect(assessFix({ ...start, accuracy: 30 }, null, areas).ok).toBe(true);
  });

  it('rejects a fix far outside every city', () => {
    // Bukhara
    expect(assessFix({ lat: 39.7747, lng: 64.4286, at }, null, areas)).toEqual({
      ok: false,
      reason: 'outside',
    });
    // 100 km outside the box is still an intercity ride (Tashkent is ~120 km away)
    expect(assessFix({ lat: 41.4, lng: 68.8, at }, null, areas).ok).toBe(true);
  });

  it('rejects a jump faster than 150 km/h since the last good fix', () => {
    // 2 km in 30 s = 240 km/h
    expect(assessFix({ lat: 40.518, lng: 68.8, at: later(30) }, start, areas)).toEqual({
      ok: false,
      reason: 'too_fast',
    });
    // the same 2 km in 2 minutes = 60 km/h
    expect(assessFix({ lat: 40.518, lng: 68.8, at: later(120) }, start, areas).ok).toBe(true);
    // GPS jitter of a standing car is not a jump
    expect(assessFix({ lat: 40.5015, lng: 68.8, at: later(1) }, start, areas).ok).toBe(true);
  });
});
