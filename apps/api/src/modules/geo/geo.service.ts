import { Injectable, NotFoundException } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { Database, type Tx } from '../../core/db/database.js';
import type { CitiesTable } from '../../core/db/schema.js';
import {
  type BBox,
  bboxOf,
  distanceToPolygonM,
  locate,
  type Point,
  pointInPolygon,
  PolygonSchema,
  type PolygonRings,
} from '../../lib/geo.js';
import { Tariff } from '../../lib/tariff.js';
import { SettingsService } from '../settings/settings.module.js';

type Db = Tx | Database['kysely'];

export interface City {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  center: Point;
  boundary: PolygonRings;
  bbox: BBox;
  timezone: string;
  isActive: boolean;
  sort: number;
  /** The city's own tariff; null = the global one. */
  tariff: Tariff | null;
}

export const UpdateCityBody = z
  .object({
    nameUz: z.string().trim().min(1).max(100),
    nameRu: z.string().trim().min(1).max(100),
    isActive: z.boolean(),
    sort: z.number().int().min(0).max(10_000),
    center: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
    boundary: PolygonSchema,
    tariff: Tariff.nullable(),
  })
  .partial();

/** A stored override that no longer parses is ignored rather than breaking quotes. */
function parsed<T>(schema: z.ZodType<T>, value: unknown): T | null {
  if (value === null || value === undefined) return null;
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

function toCity(r: Selectable<CitiesTable>): City {
  return {
    id: r.id,
    slug: r.slug,
    nameUz: r.name_uz,
    nameRu: r.name_ru,
    center: { lat: r.center_lat, lng: r.center_lng },
    boundary: r.boundary,
    bbox: { minLat: r.min_lat, maxLat: r.max_lat, minLng: r.min_lng, maxLng: r.max_lng },
    timezone: r.timezone,
    isActive: r.is_active,
    sort: r.sort,
    tariff: parsed(Tariff, r.tariff),
  };
}

/** What the apps see of a city. */
export function publicCity(c: City) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.nameUz,
    nameUz: c.nameUz,
    nameRu: c.nameRu,
    center: c.center,
    bbox: c.bbox,
    isActive: c.isActive,
    /** Listed, no rides start there yet: "tez orada". */
    upcoming: !c.isActive,
  };
}

/** Cities (service areas): which one a point is in, and its tariff. */
@Injectable()
export class GeoService {
  /** Every quote and GPS fix reads the cities: kept for a few seconds (dropped on update). */
  private citiesCache: { cities: City[]; until: number } | null = null;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  async cities(db?: Db): Promise<City[]> {
    if (!db && this.citiesCache && this.citiesCache.until > Date.now()) {
      return this.citiesCache.cities;
    }
    const rows = await (db ?? this.db.kysely)
      .selectFrom('cities')
      .selectAll()
      .orderBy('sort')
      .orderBy('slug')
      .execute();
    const cities = rows.map(toCity);
    if (!db) this.citiesCache = { cities, until: Date.now() + 10_000 };
    return cities;
  }

  async city(id: string, db: Db = this.db.kysely): Promise<City> {
    const row = await db.selectFrom('cities').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Shahar topilmadi');
    return toCity(row);
  }

  /** The city (active or not) whose service area contains the point. */
  async cityAt(p: Point, db: Db = this.db.kysely): Promise<City | null> {
    // cheap box test in SQL, the exact polygon test here
    const rows = await db
      .selectFrom('cities')
      .selectAll()
      .where('min_lat', '<=', p.lat)
      .where('max_lat', '>=', p.lat)
      .where('min_lng', '<=', p.lng)
      .where('max_lng', '>=', p.lng)
      .orderBy('sort')
      .execute();
    const hit = rows.map(toCity).find((c) => pointInPolygon(p, c.boundary));
    return hit ?? null;
  }

  /**
   * The active city a ride starting at `p` belongs to: the one containing it, else the
   * nearest active one whose boundary is within its tariff's service radius (villages
   * around the city). Null: we do not work there yet.
   */
  async serviceCity(p: Point): Promise<{ city: City; tariff: Tariff; outsideM: number } | null> {
    const active = (await this.cities()).filter((c) => c.isActive);
    const global = await this.settings.tariff();
    let best: { city: City; tariff: Tariff; outsideM: number } | null = null;
    for (const city of active) {
      const outsideM = Math.round(distanceToPolygonM(p, city.boundary));
      const tariff = city.tariff ?? global;
      if (outsideM > tariff.service_radius_km * 1000) continue;
      if (!best || outsideM < best.outsideM) best = { city, tariff, outsideM };
    }
    return best;
  }

  /** The tariff that applies in a city: its own, else the global one. */
  async tariff(cityId: string | null, db: Db = this.db.kysely): Promise<Tariff> {
    if (cityId) {
      const row = await db
        .selectFrom('cities')
        .select('tariff')
        .where('id', '=', cityId)
        .executeTakeFirst();
      const own = parsed(Tariff, row?.tariff);
      if (own) return own;
    }
    return this.settings.tariff(db);
  }

  /** Where a point is: inside a city, or outside with the nearest (active) city. */
  async resolve(p: Point) {
    const cities = await this.cities();
    const areas = cities.map((c) => ({ item: c, boundary: c.boundary, bbox: c.bbox }));
    const found = locate(p, areas);
    if (found.inside) {
      const c = found.inside;
      return { status: c.isActive ? 'inside' : 'upcoming', city: publicCity(c), nearest: null };
    }
    const nearestActive = locate(
      p,
      areas.filter((a) => a.item.isActive),
    ) as { inside: null; nearest: { item: City; distanceM: number } | null };
    const view = (n: { item: City; distanceM: number } | null) =>
      n ? { city: publicCity(n.item), distanceM: n.distanceM } : null;
    return {
      status: 'outside',
      city: null,
      nearest: view(found.nearest),
      nearestActive: view(nearestActive.nearest),
    };
  }

  async update(id: string, input: z.output<typeof UpdateCityBody>): Promise<City> {
    this.citiesCache = null;
    const bbox = input.boundary ? bboxOf(input.boundary) : null;
    const res = await this.db.kysely
      .updateTable('cities')
      .set({
        ...(input.nameUz !== undefined ? { name_uz: input.nameUz } : {}),
        ...(input.nameRu !== undefined ? { name_ru: input.nameRu } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.center ? { center_lat: input.center.lat, center_lng: input.center.lng } : {}),
        ...(input.boundary && bbox
          ? {
              boundary: JSON.stringify(input.boundary),
              min_lat: bbox.minLat,
              max_lat: bbox.maxLat,
              min_lng: bbox.minLng,
              max_lng: bbox.maxLng,
            }
          : {}),
        ...(input.tariff !== undefined
          ? { tariff: input.tariff === null ? null : JSON.stringify(input.tariff) }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .executeTakeFirst();
    this.citiesCache = null;
    if (!res.numUpdatedRows) throw new NotFoundException('Shahar topilmadi');
    return this.city(id);
  }

  /** Boxes of every city, for the driver location filter (every GPS fix: from the cache). */
  async areas(): Promise<BBox[]> {
    return (await this.cities()).map((c) => c.bbox);
  }
}
