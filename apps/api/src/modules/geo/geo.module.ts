import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { AdminOnly, Meta, Public, type RequestMeta } from '../../core/auth/auth-context.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { RateLimiter } from '../../core/redis/rate-limiter.js';
import { GeoCoreModule } from './geo-core.module.js';
import { GeocodingService } from './geocoding.service.js';
import { GeoService, publicCity, UpdateCityBody } from './geo.service.js';

const Lat = z.coerce.number().min(-90).max(90);
const Lng = z.coerce.number().min(-180).max(180);
const Lang = z.enum(['uz', 'ru']).default('uz');
const PointQuery = z.object({ lat: Lat, lng: Lng });
const ReverseQuery = PointQuery.extend({ lang: Lang });
const SearchQuery = z
  .object({
    q: z.string().trim().min(2).max(200),
    lat: Lat.optional(),
    lng: Lng.optional(),
    lang: Lang,
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), 'lat va lng birga beriladi');

/** Default map zoom: a small city fits the screen at 13. */
const DEFAULT_ZOOM = 13;

@Controller('geo')
@Public()
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly geocoding: GeocodingService,
    private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Service areas: active cities and the upcoming ones ("tez orada"). */
  @Get('cities')
  @RateLimit({ name: 'geo:cities', by: 'ip', max: 120, windowSeconds: 60 })
  async cities() {
    return (await this.geo.cities()).map(publicCity);
  }

  /** Which city a point is in; outside every one, the nearest ("we do not work here yet"). */
  @Get('resolve')
  @RateLimit({ name: 'geo:resolve', by: 'ip', max: 120, windowSeconds: 60 })
  resolve(@Query(new ZodPipe(PointQuery)) q: z.output<typeof PointQuery>) {
    return this.geo.resolve(q);
  }

  /** Address suggestions for what the rider types, biased to their city. */
  @Get('search')
  async search(
    @Query(new ZodPipe(SearchQuery)) q: z.output<typeof SearchQuery>,
    @Meta() meta: RequestMeta,
  ) {
    await this.limit(meta);
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    return this.geocoding.search(q.q, near, q.lang);
  }

  /** The address at a map pin. */
  @Get('reverse')
  async reverse(
    @Query(new ZodPipe(ReverseQuery)) q: z.output<typeof ReverseQuery>,
    @Meta() meta: RequestMeta,
  ) {
    await this.limit(meta);
    return this.geocoding.reverse(q, q.lang);
  }

  /** How the apps should draw maps: provider, tiles, default view and service areas. */
  @Get('config')
  async config() {
    const cities = await this.geo.cities();
    const launch = cities.find((c) => c.isActive) ?? cities[0];
    const yandexKey = this.env.YANDEX_MAPS_JS_KEY;
    return {
      provider: yandexKey ? 'yandex' : 'osm',
      yandex: yandexKey ? { apiKey: yandexKey, lang: 'uz_UZ' } : null,
      // the fallback, and for web panels without a Yandex key
      osm: {
        tileUrl: this.env.MAP_TILE_URL,
        attribution: this.env.MAP_TILE_ATTRIBUTION,
        maxZoom: 19,
      },
      geocoder: this.geocoding.providerName,
      defaultCenter: launch?.center ?? null,
      defaultZoom: DEFAULT_ZOOM,
      cities: cities.map((c) => ({ ...publicCity(c), boundary: c.boundary })),
    };
  }

  private limit(meta: RequestMeta) {
    return this.limiter.consume({
      name: 'geo:search',
      subject: meta.ip ?? 'unknown',
      max: this.env.GEOCODER_IP_LIMIT_PER_MINUTE,
      windowSeconds: 60,
    });
  }
}

@Controller('admin/geo')
@AdminOnly()
export class AdminGeoController {
  constructor(private readonly geo: GeoService) {}

  /** Cities with their boundaries and tariff overrides. */
  @Get('cities')
  cities() {
    return this.geo.cities();
  }

  @Patch('cities/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateCityBody)) body: z.output<typeof UpdateCityBody>,
  ) {
    return this.geo.update(id, body);
  }
}

@Module({
  imports: [GeoCoreModule],
  controllers: [GeoController, AdminGeoController],
})
export class GeoModule {}
