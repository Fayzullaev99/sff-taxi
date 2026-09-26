import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDIS } from '../src/core/redis/redis.token.js';
import { DEFAULT_TARIFF } from '../src/lib/tariff.js';
import { type Fake, startFake } from './fakes.js';
import { api, createTestApp, GULISTON, signIn, signInAdmin } from './helpers.js';

const YANGIYER = { lat: 40.2701, lng: 68.8166 };
const SAMARKAND = { lat: 39.6542, lng: 66.9597 };

describe('geo', () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let cityIds: Record<string, string>;

  beforeAll(async () => {
    fake = await startFake();
    // read by loadEnv when the app starts
    Object.assign(process.env, fake.env(), {
      GEOCODER_IP_LIMIT_PER_MINUTE: '40',
      YANDEX_MAPS_JS_KEY: 'test-yandex-maps-js-key',
    });
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    const cities = await admin.get('/v1/admin/geo/cities').expect(200);
    cityIds = Object.fromEntries(
      cities.body.map((c: { slug: string; id: string }) => [c.slug, c.id]),
    );
  });
  afterAll(async () => {
    await app?.close();
    await fake?.close();
  });

  describe('cities', () => {
    it('lists the launch city and the upcoming ones', async () => {
      const res = await api(app).get('/v1/geo/cities').expect(200);
      expect(res.body).toHaveLength(11);
      expect(res.body[0]).toMatchObject({
        slug: 'guliston',
        name: 'Guliston',
        nameRu: 'Гулистан',
        isActive: true,
        upcoming: false,
      });
      expect(res.body.find((c: { slug: string }) => c.slug === 'yangiyer')).toMatchObject({
        isActive: false,
        upcoming: true,
      });
      expect(res.body[0]).not.toHaveProperty('boundary');
    });

    it('resolves a point inside, in an upcoming city, and outside with the nearest', async () => {
      const inside = await api(app)
        .get(`/v1/geo/resolve?lat=${GULISTON.lat}&lng=${GULISTON.lng}`)
        .expect(200);
      expect(inside.body).toMatchObject({ status: 'inside', city: { slug: 'guliston' } });

      const upcoming = await api(app)
        .get(`/v1/geo/resolve?lat=${YANGIYER.lat}&lng=${YANGIYER.lng}`)
        .expect(200);
      expect(upcoming.body).toMatchObject({ status: 'upcoming', city: { slug: 'yangiyer' } });

      const nearby = await api(app).get('/v1/geo/resolve?lat=40.44&lng=68.78').expect(200);
      expect(nearby.body).toMatchObject({
        status: 'outside',
        nearestActive: { city: { slug: 'guliston' } },
      });
      expect(nearby.body.nearestActive.distanceM).toBeGreaterThan(2500);
      expect(nearby.body.nearestActive.distanceM).toBeLessThan(4500);

      const far = await api(app)
        .get(`/v1/geo/resolve?lat=${SAMARKAND.lat}&lng=${SAMARKAND.lng}`)
        .expect(200);
      expect(far.body.status).toBe('outside');
      await api(app).get('/v1/geo/resolve?lat=100&lng=0').expect(400);
    });

    it('gives the apps their map setup with the service areas', async () => {
      const res = await api(app).get('/v1/geo/config').expect(200);
      expect(res.body).toMatchObject({
        provider: 'yandex',
        yandex: { apiKey: 'test-yandex-maps-js-key' },
        geocoder: 'yandex',
        defaultZoom: 13,
      });
      expect(res.body.defaultCenter.lat).toBeCloseTo(40.496, 3);
      expect(res.body.cities).toHaveLength(11);
      expect(res.body.cities[0].boundary[0].length).toBeGreaterThan(3);
    });

    it('lets operators edit a city: activation, boundary and its own tariff', async () => {
      const own = structuredClone(DEFAULT_TARIFF);
      own.classes.economy.bands[0]!.price = 4500;
      const res = await admin
        .patch(`/v1/admin/geo/cities/${cityIds.yangiyer}`)
        .send({ isActive: true, tariff: own })
        .expect(200);
      expect(res.body).toMatchObject({ slug: 'yangiyer', isActive: true });
      expect(res.body.tariff.classes.economy.bands[0].price).toBe(4500);

      // a tariff that does not validate is refused with the field named
      const bad = structuredClone(own);
      bad.night.from = '25:00';
      const refused = await admin
        .patch(`/v1/admin/geo/cities/${cityIds.yangiyer}`)
        .send({ tariff: bad })
        .expect(400);
      expect(refused.body.issues[0].path).toBe('tariff.night.from');

      const back = await admin
        .patch(`/v1/admin/geo/cities/${cityIds.yangiyer}`)
        .send({ isActive: false, tariff: null })
        .expect(200);
      expect(back.body).toMatchObject({ isActive: false, tariff: null });

      const rider = await signIn(app);
      await api(app, rider.accessToken)
        .patch(`/v1/admin/geo/cities/${cityIds.yangiyer}`)
        .send({ isActive: true })
        .expect(403);
      await admin
        .patch('/v1/admin/geo/cities/00000000-0000-7000-8000-000000000000')
        .send({ sort: 3 })
        .expect(404);
    });
  });

  describe('address search', () => {
    it('suggests addresses from Yandex, biased to the city, marked serviceable', async () => {
      const res = await api(app)
        .get(
          `/v1/geo/search?q=${encodeURIComponent('Mustaqillik 12')}&lat=${GULISTON.lat}&lng=${GULISTON.lng}`,
        )
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({
        title: 'Mustaqillik koʻchasi, 12',
        street: 'Mustaqillik koʻchasi',
        house: '12',
        serviceable: true,
        cityId: cityIds.guliston,
      });
      expect(res.body[1]).toMatchObject({ serviceable: false, cityId: cityIds.yangiyer });
      expect(Object.fromEntries(fake.hitsOf('/yandex').at(-1)!.query)).toMatchObject({
        apikey: 'test-yandex-geocoder-key',
        geocode: 'Mustaqillik 12',
        lang: 'uz_UZ',
      });

      // the same search (any spacing or case) is answered from the cache
      const count = fake.hitsOf('/yandex').length;
      await api(app).get('/v1/geo/search?q=mustaqillik%20%20%2012').expect(200);
      expect(fake.hitsOf('/yandex').length).toBe(count);
    });

    it('turns a map pin into an address', async () => {
      const res = await api(app).get('/v1/geo/reverse?lat=40.4965&lng=68.776').expect(200);
      expect(res.body).toMatchObject({
        address: { street: 'Mustaqillik koʻchasi', house: '12' },
        city: { slug: 'guliston' },
        serviceable: true,
      });
    });

    it('falls back to Nominatim, one request per second, and says when nobody answers', async () => {
      fake.mode.yandex = 'fail';
      try {
        const before = fake.hitsOf('/nominatim').length;
        const first = await api(app).get('/v1/geo/search?q=Navoiy%207').expect(200);
        expect(first.body[0]).toMatchObject({ title: 'Navoiy koʻchasi, 7', serviceable: true });
        await api(app).get('/v1/geo/reverse?lat=40.5&lng=68.77&lang=ru').expect(200);
        const calls = fake.hitsOf('/nominatim').slice(before);
        expect(calls.map((c) => c.path)).toEqual(['/nominatim/search', '/nominatim/reverse']);
        expect(calls[0]!.headers['user-agent']).toBe('SFF-Taxi/1.0 (ops@example.com)');
        expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(950);

        const redis = app.get<Redis>(REDIS);
        const ttls = await Promise.all((await redis.keys('geo:gc:*')).map((k) => redis.ttl(k)));
        expect(Math.max(...ttls)).toBeGreaterThan(29 * 24 * 3600);

        fake.mode.nominatim = 'fail';
        const down = await api(app).get('/v1/geo/search?q=Beruniy%201').expect(503);
        expect(down.body.message).toMatch(/vaqtincha/);
      } finally {
        fake.mode.yandex = 'ok';
        fake.mode.nominatim = 'ok';
      }
    });

    it('limits address searches per IP', async () => {
      let status = 200;
      for (let i = 0; i < 45 && status === 200; i++) {
        status = (await api(app).get('/v1/geo/search?q=Mustaqillik%2012')).status;
      }
      expect(status).toBe(429);
    });
  });
});
