import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ENV, type Env } from '../../config/env.js';
import { REDIS } from '../../core/redis/redis.token.js';
import { type BBox, locate, type Point } from '../../lib/geo.js';
import { type City, GeoService, publicCity } from './geo.service.js';

export type GeoLang = 'uz' | 'ru';

/** One address as the apps show it. */
export interface GeoAddress {
  /** The line to show first: "Mustaqillik ko‘chasi, 12". */
  title: string;
  /** Where it is: "Guliston, Sirdaryo viloyati". */
  subtitle: string | null;
  street: string | null;
  house: string | null;
  /** Mahalla / district / neighbourhood when the provider knows it. */
  district: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  /** Provider's object kind: house, street, district, locality, ... */
  kind: string | null;
}

export interface GeocodeBias {
  center: Point;
  bbox: BBox;
}

export interface GeocodingProvider {
  readonly name: 'yandex' | 'nominatim';
  /** How long answers may be cached. */
  readonly cacheSeconds: number;
  search(q: string, bias: GeocodeBias, lang: GeoLang, limit: number): Promise<GeoAddress[]>;
  reverse(p: Point, lang: GeoLang): Promise<GeoAddress | null>;
}

const UPSTREAM_TIMEOUT_MS = 4000;
const join = (parts: (string | null | undefined)[], sep = ', ') =>
  parts.filter((s): s is string => Boolean(s)).join(sep) || null;

// Yandex -------------------------------------------------------------------------------

interface YandexGeoObject {
  name?: string;
  description?: string;
  Point?: { pos?: string };
  metaDataProperty?: {
    GeocoderMetaData?: {
      kind?: string;
      text?: string;
      Address?: { formatted?: string; Components?: { kind: string; name: string }[] };
    };
  };
}

/** Yandex Geocoder HTTP API 1.x (https://yandex.com/maps-api/docs/geocoder-api/). */
export class YandexGeocoder implements GeocodingProvider {
  readonly name = 'yandex' as const;
  // Yandex's terms restrict storing results: keep them for a day only
  readonly cacheSeconds = 24 * 3600;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {}

  async search(q: string, bias: GeocodeBias, lang: GeoLang, limit: number) {
    // the city's box plus ~10 km around it, so nearby villages are found too
    const padLat = 0.09;
    const padLng = 0.12;
    return this.request({
      geocode: q,
      results: String(limit),
      ll: `${bias.center.lng},${bias.center.lat}`,
      spn: `${(bias.bbox.maxLng - bias.bbox.minLng + 2 * padLng).toFixed(4)},${(bias.bbox.maxLat - bias.bbox.minLat + 2 * padLat).toFixed(4)}`,
      rspn: '1',
      lang: lang === 'ru' ? 'ru_RU' : 'uz_UZ',
    });
  }

  async reverse(p: Point, lang: GeoLang) {
    const [first] = await this.request({
      geocode: `${p.lng},${p.lat}`,
      results: '1',
      lang: lang === 'ru' ? 'ru_RU' : 'uz_UZ',
    });
    return first ?? null;
  }

  private async request(params: Record<string, string>): Promise<GeoAddress[]> {
    const url = new URL(this.url);
    url.search = new URLSearchParams({ apikey: this.apiKey, format: 'json', ...params }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Yandex Geocoder HTTP ${res.status}`);
    const body = (await res.json()) as {
      response?: { GeoObjectCollection?: { featureMember?: { GeoObject: YandexGeoObject }[] } };
    };
    const members = body.response?.GeoObjectCollection?.featureMember ?? [];
    return members.map((m) => YandexGeocoder.parse(m.GeoObject)).filter((a) => a !== null);
  }

  static parse(o: YandexGeoObject): GeoAddress | null {
    const [lng, lat] = (o.Point?.pos ?? '').split(' ').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const meta = o.metaDataProperty?.GeocoderMetaData;
    const parts = meta?.Address?.Components ?? [];
    const last = (kind: string) => parts.filter((c) => c.kind === kind).at(-1)?.name ?? null;
    return {
      title: o.name ?? meta?.text ?? '',
      subtitle: o.description ?? null,
      street: last('street'),
      house: last('house'),
      district: last('district'),
      locality: last('locality'),
      lat: lat!,
      lng: lng!,
      kind: meta?.kind ?? null,
    };
  }
}

// Nominatim ----------------------------------------------------------------------------

interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
  error?: string;
}

/**
 * OpenStreetMap Nominatim (https://nominatim.org/release-docs/latest/api/). The public
 * server allows at most 1 request per second for the whole application, so calls are
 * spaced through Redis across every API instance.
 */
export class NominatimGeocoder implements GeocodingProvider {
  readonly name = 'nominatim' as const;
  readonly cacheSeconds = 30 * 24 * 3600;
  static readonly INTERVAL_MS = 1000;
  /** A request waits at most this long for its turn before giving up. */
  static readonly MAX_WAIT_MS = 3000;

  constructor(
    private readonly baseUrl: string,
    private readonly contactEmail: string,
    private readonly redis: Redis,
  ) {}

  search(q: string, bias: GeocodeBias, lang: GeoLang, limit: number) {
    const b = bias.bbox;
    return this.request('search', {
      q,
      limit: String(limit),
      countrycodes: 'uz',
      // a preference, not a filter (bounded=0)
      viewbox: `${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}`,
      bounded: '0',
      'accept-language': lang === 'ru' ? 'ru,uz' : 'uz,ru',
    }).then((rows) => (rows as NominatimPlace[]).map((r) => NominatimGeocoder.parse(r)));
  }

  async reverse(p: Point, lang: GeoLang) {
    const r = (await this.request('reverse', {
      lat: String(p.lat),
      lon: String(p.lng),
      zoom: '18',
      'accept-language': lang === 'ru' ? 'ru,uz' : 'uz,ru',
    })) as NominatimPlace;
    return r.error || !r.lat ? null : NominatimGeocoder.parse(r);
  }

  private async request(path: 'search' | 'reverse', params: Record<string, string>) {
    await this.takeTurn();
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/${path}`);
    url.search = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      email: this.contactEmail,
      ...params,
    }).toString();
    const res = await fetch(url, {
      headers: { 'User-Agent': `SFF-Taxi/1.0 (${this.contactEmail})` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return (await res.json()) as unknown;
  }

  /** One request per INTERVAL_MS across all instances: a Redis key held for the interval. */
  private async takeTurn(): Promise<void> {
    const deadline = Date.now() + NominatimGeocoder.MAX_WAIT_MS;
    for (;;) {
      const got = await this.redis.set(
        'geo:nominatim:turn',
        '1',
        'PX',
        NominatimGeocoder.INTERVAL_MS,
        'NX',
      );
      if (got) return;
      const wait = Math.max(await this.redis.pttl('geo:nominatim:turn'), 10);
      if (Date.now() + wait > deadline) throw new Error('Nominatim rate limit: no free slot');
      await sleep(wait);
    }
  }

  static parse(r: NominatimPlace): GeoAddress {
    const a = r.address ?? {};
    const street = a.road ?? a.pedestrian ?? a.footway ?? a.residential ?? null;
    const house = a.house_number ?? null;
    const district = a.neighbourhood ?? a.quarter ?? a.suburb ?? a.city_district ?? null;
    const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? null;
    const title =
      join([street, house]) ??
      r.name ??
      r.display_name?.split(',')[0]?.trim() ??
      r.display_name ??
      '';
    return {
      title,
      subtitle: join([district, locality, a.state]),
      street,
      house,
      district,
      locality,
      lat: Number(r.lat),
      lng: Number(r.lon),
      kind: r.addresstype ?? r.type ?? null,
    };
  }
}

// Service ------------------------------------------------------------------------------

export const SEARCH_LIMIT = 8;

/**
 * Address suggestions and reverse geocoding with caching, provider fallback and each
 * result marked with the service area it falls in.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  readonly providers: GeocodingProvider[];

  constructor(
    @Inject(ENV) env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly geo: GeoService,
  ) {
    const nominatim = env.GEOCODER_CONTACT_EMAIL
      ? new NominatimGeocoder(env.NOMINATIM_URL, env.GEOCODER_CONTACT_EMAIL, redis)
      : null;
    const yandex = env.YANDEX_GEOCODER_KEY
      ? new YandexGeocoder(env.YANDEX_GEOCODER_URL, env.YANDEX_GEOCODER_KEY)
      : null;
    this.providers =
      env.GEOCODER === 'yandex'
        ? [yandex, nominatim].filter((p) => p !== null)
        : env.GEOCODER === 'nominatim' && nominatim
          ? [nominatim]
          : [];
  }

  get providerName(): string {
    return this.providers[0]?.name ?? 'none';
  }

  async search(q: string, near: Point | null, lang: GeoLang) {
    const cities = await this.geo.cities();
    const biasCity =
      (near && cities.find((c) => locate(near, [area(c)]).inside)) ??
      cities.find((c) => c.isActive) ??
      cities[0];
    if (!biasCity) return [];
    const text = q.trim().replace(/\s+/g, ' ');
    const cacheKey = `geo:gc:search:${lang}:${biasCity.slug}:${hash(text.toLowerCase())}`;
    const results = await this.cached(cacheKey, (p) =>
      p.search(text, { center: biasCity.center, bbox: biasCity.bbox }, lang, SEARCH_LIMIT),
    );
    return (results ?? []).slice(0, SEARCH_LIMIT).map((r) => this.annotate(r, cities));
  }

  async reverse(p: Point, lang: GeoLang) {
    const cities = await this.geo.cities();
    // ~11 m: close enough for "what is here", and repeated pins hit the cache
    const point = { lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4) };
    const cacheKey = `geo:gc:reverse:${lang}:${point.lat},${point.lng}`;
    const address = this.providers.length
      ? await this.cached(cacheKey, (provider) => provider.reverse(point, lang))
      : null;
    const city = cities.find((c) => locate(p, [area(c)]).inside) ?? null;
    return {
      address,
      city: city ? publicCity(city) : null,
      serviceable: Boolean(city?.isActive),
    };
  }

  /** The first provider that answers; its answer is cached for as long as it allows. */
  private async cached<T>(
    cacheKey: string,
    ask: (p: GeocodingProvider) => Promise<T>,
  ): Promise<T | null> {
    if (!this.providers.length) return null;
    const hit = await this.redis.get(cacheKey);
    if (hit) return (JSON.parse(hit) as { v: T }).v;
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        const value = await ask(provider);
        await this.redis.set(cacheKey, JSON.stringify({ v: value }), 'EX', provider.cacheSeconds);
        return value;
      } catch (err) {
        lastError = err;
        this.logger.warn(`Geocoder ${provider.name} failed: ${(err as Error).message}`);
      }
    }
    this.logger.error(`No geocoder answered: ${(lastError as Error | undefined)?.message}`);
    throw new ServiceUnavailableException('Manzil qidiruvi vaqtincha ishlamayapti');
  }

  private annotate(r: GeoAddress, cities: City[]) {
    const city = cities.find((c) => locate(r, [area(c)]).inside) ?? null;
    return {
      ...r,
      cityId: city?.id ?? null,
      serviceable: Boolean(city?.isActive),
    };
  }
}

const area = (c: City) => ({ item: c, boundary: c.boundary, bbox: c.bbox });
const hash = (s: string) => createHash('sha1').update(s).digest('hex');
