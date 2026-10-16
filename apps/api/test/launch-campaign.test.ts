import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import {
  applyLaunchCampaign,
  describeCampaign,
  LAUNCH_CAMPAIGN,
} from '../src/lib/launch-campaign.js';
import { PromosService } from '../src/modules/promos/promos.service.js';
import { DEFAULT_PROMO, SettingsService } from '../src/modules/settings/settings.module.js';
import { ADMIN_PHONE, api, createTestApp, signIn, signInAdmin } from './helpers.js';

/** scripts/launch-campaign.ts: the GULISTON code and the referral settings, idempotently. */
describe('launch campaign', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let deps: Parameters<typeof applyLaunchCampaign>[0];
  const inviteUrl = 'https://taxi.example.uz/invite/';

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    const user = await app
      .get(Database)
      .kysely.selectFrom('users')
      .select(['id', 'phone', 'full_name'])
      .where('phone', '=', ADMIN_PHONE)
      .executeTakeFirstOrThrow();
    deps = {
      promos: app.get(PromosService),
      settings: app.get(SettingsService),
      admin: { userId: user.id, phone: user.phone, fullName: user.full_name, isAdmin: true },
    };
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/promo').send(DEFAULT_PROMO).expect(200);
    await app.close();
  });

  it('describes the plan for a dry run', () => {
    const text = describeCampaign(LAUNCH_CAMPAIGN, 'https://taxi.example.uz/invite');
    expect(text).toContain('GULISTON: 50% up to 10000');
    expect(text).toContain('first ride only');
    expect(text).toContain('https://taxi.example.uz/invite/CODE');
  });

  it('creates the code and the settings, then updates them in place', async () => {
    const first = await applyLaunchCampaign(deps, LAUNCH_CAMPAIGN, inviteUrl);
    expect(first.promo).toMatchObject({ action: 'created', code: 'GULISTON' });
    expect(first.settings.invite_url).toBe('https://taxi.example.uz/invite');
    expect(first.settings).toMatchObject(LAUNCH_CAMPAIGN.referral);

    const second = await applyLaunchCampaign(deps, LAUNCH_CAMPAIGN, inviteUrl);
    expect(second.promo).toEqual({ ...first.promo, action: 'updated' });

    const list = await admin.get('/v1/admin/promos?q=GULISTON').expect(200);
    const codes = list.body.filter((p: { code: string }) => p.code === 'GULISTON');
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({
      kind: 'percent',
      value: 50,
      maxDiscount: 10_000,
      firstRideOnly: true,
      perRiderLimit: 1,
      services: ['taxi'],
      isActive: true,
    });
    expect(codes[0].validUntil).toBe('2026-12-31T18:59:59.000Z');
  });

  it('is a code new riders can enter, and the invitation links point at the landing site', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const added = await rider.post('/v1/promos').send({ code: 'guliston' }).expect(200);
    expect(added.body.added).toEqual({ kind: 'promo', code: 'GULISTON' });
    expect(added.body.wallet.promos[0]).toMatchObject({ code: 'GULISTON', usable: true });

    const wallet = await rider.get('/v1/promos').expect(200);
    const { code, url, deepLink, shareText } = wallet.body.referral;
    expect(url).toBe(`https://taxi.example.uz/invite/${code}`);
    expect(deepLink).toBe(`sfftaxi://invite/${code}`);
    expect(shareText).toContain(url);
  });
});
