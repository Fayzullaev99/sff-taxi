import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../core/db/database.js';
import { distanceM } from '../../lib/distance.js';
import { distanceToPolygonM, type Point } from '../../lib/geo.js';
import type { RideClass } from '../../lib/tariff.js';
import { GeoService } from './geo.service.js';

/** Where fixed-price routes start and end: the towns (and Tashkent) with their zones. */
interface Zone {
  id: string;
  slug: string;
  name: string;
  center: Point;
  cityId: string | null;
  radiusM: number;
}

export interface RoutePrice {
  /** One person in a shared car. */
  seat: number | null;
  /** The whole car, nobody else taken. */
  car: number | null;
}

/** A fixed route between the ends of a trip, as a quote carries it. */
export interface RouteQuote {
  from: { id: string; slug: string; name: string; cityId: string | null };
  to: { id: string; slug: string; name: string; cityId: string | null };
  /** Per class; a class without a row has no fixed price (the tariff applies). */
  prices: Partial<Record<RideClass, RoutePrice & { id: string }>>;
}

const soum = z.number().int().min(1000).max(10_000_000);

export const RouteFareBody = z
  .object({
    from: z.string().trim().min(1).max(60),
    to: z.string().trim().min(1).max(60),
    class: z.enum(['economy', 'comfort']).default('economy'),
    seatPrice: soum.nullable(),
    carPrice: soum.nullable(),
    isActive: z.boolean().default(true),
    /** Also save the way back at the same prices. */
    bothWays: z.boolean().default(false),
  })
  .refine((b) => b.seatPrice !== null || b.carPrice !== null, {
    message: 'O‘rindiq yoki butun mashina narxi kerak',
    path: ['seatPrice'],
  })
  .refine((b) => b.seatPrice === null || b.carPrice === null || b.carPrice >= b.seatPrice, {
    message: 'Butun mashina bir o‘rindiqdan arzon bo‘lmaydi',
    path: ['carPrice'],
  })
  .refine((b) => b.from !== b.to, { message: 'Yo‘nalish bir joyda boshlanib tugamaydi' });
export type RouteFareBody = z.output<typeof RouteFareBody>;

const ZONES_TTL_MS = 30_000;

/**
 * Fixed prices between towns and districts (Yangiyer -> Guliston 10 000 per seat): per km a
 * long ride costs one person too much, so operators fix the route's seat and car prices. A
 * trip gets the route's price when its pickup is in the first point's zone and its drop-off
 * in the second's: the town boundary widened by the point's radius, or a circle around it.
 */
@Injectable()
export class RouteFaresService {
  private zonesCache: { zones: Zone[]; until: number } | null = null;

  constructor(
    private readonly db: Database,
    private readonly geo: GeoService,
  ) {}

  private async zones(): Promise<Zone[]> {
    if (this.zonesCache && this.zonesCache.until > Date.now()) return this.zonesCache.zones;
    const rows = await this.db.kysely
      .selectFrom('intercity_points')
      .select(['id', 'slug', 'name_uz', 'lat', 'lng', 'city_id', 'zone_radius_m'])
      .where('is_active', '=', true)
      .execute();
    const zones = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name_uz,
      center: { lat: r.lat, lng: r.lng },
      cityId: r.city_id,
      radiusM: r.zone_radius_m,
    }));
    this.zonesCache = { zones, until: Date.now() + ZONES_TTL_MS };
    return zones;
  }

  /** The zone a point is in (the nearest when zones overlap), or null. */
  async zoneAt(p: Point): Promise<Zone | null> {
    const [zones, cities] = await Promise.all([this.zones(), this.geo.cities()]);
    const byId = new Map(cities.map((c) => [c.id, c]));
    let best: { zone: Zone; d: number } | null = null;
    for (const zone of zones) {
      const city = zone.cityId ? byId.get(zone.cityId) : undefined;
      const d = city
        ? distanceToPolygonM(p, city.boundary)
        : distanceM(p.lat, p.lng, zone.center.lat, zone.center.lng);
      if (d > zone.radiusM) continue;
      if (!best || d < best.d) best = { zone, d };
    }
    return best?.zone ?? null;
  }

  /** The fixed route between a trip's ends, or null (the tariff prices it). */
  async match(pickup: Point, dropoff: Point): Promise<RouteQuote | null> {
    const [from, to] = await Promise.all([this.zoneAt(pickup), this.zoneAt(dropoff)]);
    if (!from || !to || from.id === to.id) return null;
    const rows = await this.db.kysely
      .selectFrom('route_fares')
      .select(['id', 'class', 'seat_price', 'car_price'])
      .where('from_point_id', '=', from.id)
      .where('to_point_id', '=', to.id)
      .where('is_active', '=', true)
      .execute();
    if (!rows.length) return null;
    const point = (z: Zone) => ({ id: z.id, slug: z.slug, name: z.name, cityId: z.cityId });
    return {
      from: point(from),
      to: point(to),
      prices: Object.fromEntries(
        rows.map((r) => [r.class, { id: r.id, seat: r.seat_price, car: r.car_price }]),
      ),
    };
  }

  /** Every route with its prices, for the operators' table and the riders' route chips. */
  async list(opts: { activeOnly: boolean }) {
    const rows = await this.db.kysely
      .selectFrom('route_fares as f')
      .innerJoin('intercity_points as a', 'a.id', 'f.from_point_id')
      .innerJoin('intercity_points as b', 'b.id', 'f.to_point_id')
      .select([
        'f.id',
        'f.class',
        'f.seat_price as seatPrice',
        'f.car_price as carPrice',
        'f.is_active as isActive',
        'f.updated_at as updatedAt',
        'a.slug as fromSlug',
        'a.name_uz as fromName',
        'a.lat as fromLat',
        'a.lng as fromLng',
        'b.slug as toSlug',
        'b.name_uz as toName',
        'b.lat as toLat',
        'b.lng as toLng',
      ])
      .$if(opts.activeOnly, (q) => q.where('f.is_active', '=', true))
      .orderBy('a.sort')
      .orderBy('b.sort')
      .orderBy('f.class')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      class: r.class,
      seatPrice: r.seatPrice,
      carPrice: r.carPrice,
      isActive: r.isActive,
      updatedAt: r.updatedAt,
      from: { slug: r.fromSlug, name: r.fromName, lat: r.fromLat, lng: r.fromLng },
      to: { slug: r.toSlug, name: r.toName, lat: r.toLat, lng: r.toLng },
    }));
  }

  /** Creates or changes a route's prices (and the way back when asked). */
  async save(operatorId: string, body: RouteFareBody) {
    const points = await this.db.kysely
      .selectFrom('intercity_points')
      .select(['id', 'slug'])
      .where('slug', 'in', [body.from, body.to])
      .execute();
    const id = (slug: string) => {
      const p = points.find((x) => x.slug === slug);
      if (!p) throw new BadRequestException(`Bunday manzil yo‘q: ${slug}`);
      return p.id;
    };
    const pairs = [[id(body.from), id(body.to)]];
    if (body.bothWays) pairs.push([id(body.to), id(body.from)]);
    for (const [from, to] of pairs) {
      await this.db.kysely
        .insertInto('route_fares')
        .values({
          from_point_id: from!,
          to_point_id: to!,
          class: body.class,
          seat_price: body.seatPrice,
          car_price: body.carPrice,
          is_active: body.isActive,
          updated_by: operatorId,
        })
        .onConflict((oc) =>
          oc.columns(['from_point_id', 'to_point_id', 'class']).doUpdateSet({
            seat_price: body.seatPrice,
            car_price: body.carPrice,
            is_active: body.isActive,
            updated_by: operatorId,
            updated_at: new Date(),
          }),
        )
        .execute();
    }
    return this.list({ activeOnly: false });
  }

  async remove(id: string): Promise<void> {
    // rides keep a reference to the price they were ordered at: deactivate those instead
    const used = await this.db.kysely
      .selectFrom('rides')
      .select('id')
      .where('route_fare_id', '=', id)
      .limit(1)
      .executeTakeFirst();
    const res = used
      ? await this.db.kysely
          .updateTable('route_fares')
          .set({ is_active: false, updated_at: new Date() })
          .where('id', '=', id)
          .executeTakeFirst()
      : await this.db.kysely.deleteFrom('route_fares').where('id', '=', id).executeTakeFirst();
    const n = 'numUpdatedRows' in res ? res.numUpdatedRows : res.numDeletedRows;
    if (!n) throw new NotFoundException('Yo‘nalish topilmadi');
  }
}
