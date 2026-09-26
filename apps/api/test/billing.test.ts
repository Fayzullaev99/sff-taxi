import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BusinessCalendar } from '../src/core/clock/business-calendar.js';
import { tashkentMonth } from '../src/lib/commission.js';
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
} from './helpers.js';

const YANGIYER = { lat: 40.2701, lng: 68.8166 };

describe('billing', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    // after the launch promo, with small caps so a few rides reach them
    await admin
      .put('/v1/admin/settings/billing')
      .send({ ...DEFAULT_BILLING, promo_until: null, daily_cap: 1000, weekly_cap: 5000 })
      .expect(200);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/billing').send(DEFAULT_BILLING).expect(200);
    await app.close();
  });

  /** A whole ride for `driver`: ordered, assigned by an operator, driven and completed. */
  async function ride(driver: DriverFixture, dropoff = MID) {
    const rider = await signIn(app);
    const { id } = await orderRide(app, rider, { pickup: GULISTON, dropoff });
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/start`).expect(200);
    const done = await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
    return done.body as {
      id: string;
      fare: { total: number };
      earnings: { commission: number; commissionNote: string | null; tax: number; net: number };
    };
  }

  it('takes 5% on city rides up to the daily cap, and always the 1% tax', async () => {
    const d = await createDriver(app, { topup: 20_000 });
    const first = await ride(d);
    expect(first.fare.total).toBe(7000);
    expect(first.earnings).toEqual({
      fare: 7000,
      commission: 350,
      commissionNote: null,
      tax: 70,
      net: 6580,
    });
    expect((await ride(d)).earnings.commission).toBe(350);
    // 700 charged today, the cap is 1000
    expect((await ride(d)).earnings).toMatchObject({
      commission: 300,
      commissionNote: 'daily_cap',
      tax: 70,
    });
    expect((await ride(d)).earnings).toMatchObject({
      commission: 0,
      commissionNote: 'daily_cap',
      tax: 70,
    });

    const balance = await d.http.get('/v1/driver/balance').expect(200);
    expect(balance.body.balance).toBe(20_000 - 1000 - 4 * 70);
    const kinds = balance.body.entries.map((e: { kind: string; amount: number }) => [
      e.kind,
      e.amount,
    ]);
    expect(kinds.filter(([k]: [string]) => k === 'commission')).toEqual([
      ['commission', -300],
      ['commission', -350],
      ['commission', -350],
    ]);
    expect(kinds.filter(([k]: [string]) => k === 'tax')).toHaveLength(4);

    const today = await d.http.get('/v1/driver/earnings').expect(200);
    expect(today.body).toMatchObject({
      rides: 4,
      fares: 28_000,
      cash: 28_000,
      commission: 1000,
      tax: 280,
      net: 26_720,
    });
    const week = await d.http.get('/v1/driver/earnings?period=week').expect(200);
    expect(week.body.rides).toBe(4);
  });

  it('takes no commission on city rides during a pass, but always on intercity rides', async () => {
    const d = await createDriver(app, { topup: 30_000 });
    await d.http.post('/v1/driver/passes').send({ kind: 'day' }).expect(201);
    const city = await ride(d);
    expect(city.earnings).toMatchObject({ commission: 0, commissionNote: 'pass', tax: 70 });

    const intercity = await ride(d, YANGIYER);
    const fare = intercity.fare.total;
    expect(fare).toBeGreaterThan(40_000);
    expect(intercity.earnings).toMatchObject({
      commission: Math.min(10_000, Math.round(fare * 0.05)),
      commissionNote: null,
      tax: Math.round(fare / 100),
    });
  });

  it('reports the withheld tax per driver for the month and records its remittance', async () => {
    const d = await createDriver(app, { topup: 10_000 });
    await ride(d);
    await ride(d);
    // the month of the business calendar (pinned in vitest.config.ts)
    const period = tashkentMonth(app.get(BusinessCalendar).at());
    const report = await admin.get(`/v1/admin/billing/taxes?period=${period}`).expect(200);
    const mine = report.body.drivers.find((r: { driverId: string }) => r.driverId === d.id);
    const view = await admin.get(`/v1/admin/drivers/${d.id}`).expect(200);
    expect(mine).toEqual({
      driverId: d.id,
      fullName: 'Aziz Karimov',
      pinfl: view.body.pinfl,
      rides: 2,
      base: 14_000,
      amount: 140,
      remitted: false,
    });
    expect(report.body.totals.amount).toBeGreaterThanOrEqual(140);

    await admin.get('/v1/admin/billing/taxes?period=2026-13').expect(400);
    const remit = await admin
      .post('/v1/admin/billing/taxes/remit')
      .send({ period, reference: 'To‘lov topshiriqnomasi #815' })
      .expect(200);
    expect(remit.body.rows).toBeGreaterThanOrEqual(2);
    const after = await admin.get(`/v1/admin/billing/taxes?period=${period}`).expect(200);
    expect(after.body.drivers.every((r: { remitted: boolean }) => r.remitted)).toBe(true);

    const rider = await signIn(app);
    await api(app, rider.accessToken).get(`/v1/admin/billing/taxes?period=${period}`).expect(403);
  });

  it('stops offers and shifts once fees push the balance below the minimum', async () => {
    const d = await createDriver(app);
    await admin
      .post(`/v1/admin/billing/drivers/${d.id}/ledger`)
      .send({ kind: 'adjustment', amount: -9990, note: 'Oldingi qarz' })
      .expect(201);
    await ride(d);
    const me = await d.http.get('/v1/driver/me').expect(200);
    // -9990 - 70 tax - 300 commission (the daily cap is per driver, this driver's first ride)
    expect(me.body.balance).toBeLessThan(-10_000);
    expect(me.body.blockers).toContain('Balans juda past');
    await d.http.post('/v1/driver/shift').send({ online: false }).expect(200);
    await d.http.post('/v1/driver/shift').send({ online: true }).expect(403);
  });
});
