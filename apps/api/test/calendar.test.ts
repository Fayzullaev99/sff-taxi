import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BusinessCalendar } from '../src/core/clock/business-calendar.js';
import { Database } from '../src/core/db/database.js';
import { DEFAULT_BILLING } from '../src/modules/settings/settings.module.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  orderRide,
  signIn,
  signInAdmin,
  startPin,
} from './helpers.js';

/**
 * Time-of-day and calendar boundaries of the business rules, driven through the pinned
 * business calendar (src/core/clock/business-calendar.ts): the night add-on, the Tashkent
 * day and week of the commission caps, the tax month and the end of the launch promo.
 */
describe('business calendar boundaries', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let calendar: BusinessCalendar;
  const pin = (tashkent: string) => calendar.pin(new Date(`${tashkent}+05:00`));

  beforeAll(async () => {
    app = await createTestApp();
    calendar = app.get(BusinessCalendar);
    admin = api(app, (await signInAdmin(app)).accessToken);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/billing').send(DEFAULT_BILLING).expect(200);
    calendar.pin(new Date(process.env.TEST_CALENDAR_AT!));
    await app.close();
  });

  it('adds the night add-on from 23:00 to 06:00 Tashkent time, and only then', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const economy = async (at: string) => {
      pin(at);
      const quote = await rider
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      return quote.body.fares.economy as { total: number; night: number };
    };
    expect(await economy('2026-10-14T22:59:00')).toMatchObject({ total: 7000, night: 0 });
    expect(await economy('2026-10-14T23:00:00')).toMatchObject({ total: 8400, night: 1400 });
    expect(await economy('2026-10-15T05:59:00')).toMatchObject({ total: 8400, night: 1400 });
    expect(await economy('2026-10-15T06:00:00')).toMatchObject({ total: 7000, night: 0 });
  });

  describe('commission and tax', () => {
    let driver: DriverFixture;

    /** A whole city ride (7 000 so'm) for the driver; returns its id and charges. */
    async function ride() {
      const rider = await signIn(app);
      const { id } = await orderRide(app, rider, { pickup: GULISTON, dropoff: MID });
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      const pin = await startPin(app, id);
      await driver.http.post(`/v1/driver/rides/${id}/start`).send({ pin }).expect(200);
      const done = await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
      return {
        id,
        ...(done.body.earnings as { commission: number; commissionNote: string | null }),
      };
    }

    /** Moves a ride's completion back by `seconds` of real time. */
    const backdate = (id: string, seconds: number) =>
      app
        .get(Database)
        .kysely.updateTable('rides')
        .set({ completed_at: sql<Date>`completed_at - make_interval(secs => ${seconds})` })
        .where('id', '=', id)
        .execute();

    const taxPeriod = async (id: string) =>
      (
        await app
          .get(Database)
          .kysely.selectFrom('tax_withholdings')
          .select('period')
          .where('ride_id', '=', id)
          .executeTakeFirstOrThrow()
      ).period;

    beforeAll(async () => {
      // one ride fills both caps
      await admin
        .put('/v1/admin/settings/billing')
        .send({ ...DEFAULT_BILLING, promo_until: null, daily_cap: 350, weekly_cap: 350 })
        .expect(200);
      driver = await createDriver(app, { topup: 100_000 });
    });

    it('starts the daily and weekly caps again at Tashkent midnight on Monday', async () => {
      // Monday 19 Oct 2026, just after midnight
      pin('2026-10-19T00:00:30');
      const sunday = await ride();
      // 350 fills both caps exactly
      expect(sunday.commission).toBe(350);
      // that ride really ended a minute ago: Sunday 23:59:30, the previous day and week
      await backdate(sunday.id, 60);
      const monday = await ride();
      expect(monday.commission).toBe(350);
      // the next one the same Monday hits the caps
      const again = await ride();
      expect(again).toMatchObject({ commission: 0 });
      expect(['daily_cap', 'weekly_cap']).toContain(again.commissionNote);
    });

    it('withholds the tax in the Tashkent month of the ride', async () => {
      pin('2026-10-31T23:59:30');
      const october = await ride();
      pin('2026-11-01T00:00:30');
      const november = await ride();
      expect(await taxPeriod(october.id)).toBe('2026-10');
      expect(await taxPeriod(november.id)).toBe('2026-11');
    });

    it('ends the launch promo after its last Tashkent day', async () => {
      await admin
        .put('/v1/admin/settings/billing')
        .send({ ...DEFAULT_BILLING, daily_cap: 0, weekly_cap: 0 })
        .expect(200);
      // daytime on both sides (no night add-on): only the date matters here
      pin('2026-12-31T18:00:00');
      expect(await ride()).toMatchObject({ commission: 0, commissionNote: 'promo' });
      pin('2027-01-01T08:00:00');
      expect(await ride()).toMatchObject({ commission: 350, commissionNote: null });
    });
  });
});
