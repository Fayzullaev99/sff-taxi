import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BILLING, DEFAULT_DISPATCH } from '../src/modules/settings/settings.module.js';
import { api, createTestApp, GULISTON, MID, signIn, signInAdmin } from './helpers.js';
import { TEST_TARIFF } from './test-tariff.js';

describe('settings', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
  });
  afterAll(async () => {
    // later test files expect the defaults
    await admin.put('/v1/admin/settings/tariff').send(TEST_TARIFF).expect(200);
    await admin.put('/v1/admin/settings/dispatch').send(DEFAULT_DISPATCH).expect(200);
    await admin.put('/v1/admin/settings/billing').send(DEFAULT_BILLING).expect(200);
    await app.close();
  });

  it('starts from the market-analysis defaults (no night add-on in tests)', async () => {
    expect((await admin.get('/v1/admin/settings/tariff').expect(200)).body).toEqual(TEST_TARIFF);
    expect((await admin.get('/v1/admin/settings/dispatch').expect(200)).body).toMatchObject({
      offer_timeout_seconds: 15,
      direct_offers: 3,
      broadcast_radius_m: 3000,
    });
    expect((await admin.get('/v1/admin/settings/billing').expect(200)).body).toMatchObject({
      commission_percent: 5,
      daily_cap: 10_000,
      tax_percent: 1,
    });
  });

  it('changes the tariff for new quotes only, validated', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const before = await rider
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID })
      .expect(200);
    expect(before.body.fares.economy.total).toBe(7000);

    const cheaper = structuredClone(TEST_TARIFF);
    cheaper.classes.economy.bands[1]!.price = 6500;
    await admin.put('/v1/admin/settings/tariff').send(cheaper).expect(200);
    const after = await rider
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID })
      .expect(200);
    expect(after.body.fares.economy.total).toBe(6500);

    const broken = structuredClone(TEST_TARIFF) as unknown as Record<string, unknown>;
    delete broken.waiting;
    const refused = await admin.put('/v1/admin/settings/tariff').send(broken).expect(400);
    expect(refused.body.issues[0]).toEqual({ path: 'waiting', message: 'Majburiy maydon' });
  });

  it('validates dispatch and billing rules', async () => {
    await admin
      .put('/v1/admin/settings/dispatch')
      .send({ ...DEFAULT_DISPATCH, broadcast_radius_m: 9000 })
      .expect(400);
    await admin
      .put('/v1/admin/settings/dispatch')
      .send({ ...DEFAULT_DISPATCH, offer_timeout_seconds: 20 })
      .expect(200);
    await admin
      .put('/v1/admin/settings/billing')
      .send({ ...DEFAULT_BILLING, min_balance: 5 })
      .expect(400);
    const off = await admin
      .put('/v1/admin/settings/billing')
      .send({ ...DEFAULT_BILLING, promo_until: null })
      .expect(200);
    expect(off.body.promo_until).toBeNull();
    const rider = await signIn(app);
    await api(app, rider.accessToken)
      .put('/v1/admin/settings/billing')
      .send(DEFAULT_BILLING)
      .expect(403);
  });
});
