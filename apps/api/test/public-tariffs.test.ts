import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TARIFF } from '../src/lib/tariff.js';
import { api, createTestApp, GULISTON, signInAdmin } from './helpers.js';

/**
 * GET /v1/tariffs?lat&lng at the launch city: the public price list the landing site
 * (apps/landing src/tariffs.ts) and the ads quote. A change of this shape must be mirrored
 * there, so the fields the site reads are pinned here.
 */
describe('public tariffs for the landing site', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/tariff').send(DEFAULT_TARIFF).expect(200);
    await app.close();
  });

  it('is public and mirrors the launch tariff at Guliston', async () => {
    const res = await api(app)
      .get(`/v1/tariffs?lat=${GULISTON.lat}&lng=${GULISTON.lng}`)
      .expect(200);
    expect(res.body.serviceable).toBe(true);
    expect(res.body.city).toBe('Guliston');
    const { tariff } = res.body;
    expect(Object.keys(tariff.classes).sort()).toEqual([
      'business',
      'comfort',
      'economy',
      'minivan',
    ]);
    expect(tariff.classes.economy).toMatchObject({
      enabled: true,
      bands: [
        { up_to_m: 2000, price: 5000 },
        { up_to_m: 4000, price: 7000 },
        { up_to_m: 7000, price: 10_000 },
      ],
      beyond_per_km: 900,
      outside_per_km: 1500,
      intercity_per_km: 1700,
      intercity_min: 25_000,
    });
    // launch: minivan and business wait for enough cars
    expect(tariff.classes.minivan.enabled).toBe(false);
    expect(tariff.classes.business.enabled).toBe(false);
    expect(tariff).toMatchObject({
      night: { percent: 20, from: '23:00', to: '06:00' },
      waiting: { free_minutes: 2, per_minute: 500 },
      options: { child_seat: 2000, luggage: 2000, pets: 3000, ac: 0 },
      stops: { per_stop: 1000, free_minutes: 3 },
      seats: { share_percent: 30, front_extra_percent: 10 },
      cancellation_fee: 3000,
      intercity_from_km: 20,
    });
    // nothing a rider could misuse: no ids of people, no phones
    expect(JSON.stringify(res.body)).not.toMatch(/phone|user_id|driver_id/);
  });

  it('follows the operators’ tariff', async () => {
    const tariff = structuredClone(DEFAULT_TARIFF);
    tariff.classes.minivan.enabled = true;
    tariff.classes.economy.bands[0]!.price = 5500;
    await admin.put('/v1/admin/settings/tariff').send(tariff).expect(200);

    const res = await api(app)
      .get(`/v1/tariffs?lat=${GULISTON.lat}&lng=${GULISTON.lng}`)
      .expect(200);
    expect(res.body.tariff.classes.minivan.enabled).toBe(true);
    expect(res.body.tariff.classes.economy.bands[0].price).toBe(5500);
  });

  it('says so outside the service area', async () => {
    // Tashkent: no active city there at launch
    const res = await api(app).get('/v1/tariffs?lat=41.3111&lng=69.2797').expect(200);
    expect(res.body).toMatchObject({ serviceable: false, tariff: null });
  });
});
