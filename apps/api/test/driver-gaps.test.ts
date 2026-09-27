import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { DEFAULT_BILLING } from '../src/modules/settings/settings.module.js';
import {
  api,
  application,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  orderRide,
  quiesce,
  signIn,
  signInAdmin,
} from './helpers.js';

/** What the driver app reported missing after its first release. */
describe('driver app gaps', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];
  let dispatch: DispatchService;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    dispatch = app.get(DispatchService);
  });
  afterAll(() => app.close());

  const near = (metres: number) => ({ lat: GULISTON.lat + metres / 110_574, lng: GULISTON.lng });
  const offersOf = async (d: DriverFixture) =>
    (await d.http.get('/v1/driver/offers').expect(200)).body as {
      id: string;
      kind: string;
      ride: { id: string };
    }[];
  const counters = async (d: DriverFixture) =>
    db
      .selectFrom('drivers')
      .select(['offers_received', 'offers_accepted'])
      .where('user_id', '=', d.id)
      .executeTakeFirstOrThrow();
  const closedEvents = async (rideId: string) =>
    (
      await db
        .selectFrom('outbox')
        .select('payload')
        .where('topic', '=', 'ride.offer_closed')
        .execute()
    )
      .map((e) => e.payload as { rideId: string; driverId: string; status: string })
      .filter((p) => p.rideId === rideId);

  it('publishes the apps’ configuration and the rules a driver works under', async () => {
    const config = await api(app).get('/v1/config').expect(200);
    expect(config.body).toMatchObject({
      // unset: no forced update (a default would lock builds out)
      minAppVersion: { rider: null, driver: null },
      features: { cardPayments: true, intercity: true, maskedCalls: false },
      cardProviders: ['payme', 'click'],
    });
    expect(config.body.support).toHaveProperty('phone');
    const driver = await createDriver(app, { online: false });
    const rules = await driver.http.get('/v1/driver/config').expect(200);
    expect(rules.body).toMatchObject({
      billing: {
        promoUntil: DEFAULT_BILLING.promo_until,
        commissionPercent: 5,
        dailyCap: 10_000,
        weeklyCap: 55_000,
        passes: { day: 9000, week: 50_000 },
        minBalance: -10_000,
      },
      rides: { noShowAfterMinutes: 5, freeWaitingMinutes: 2, cancellationFee: 3000 },
      topups: { min: 5000 },
    });
    expect(rules.body.declineReasons.too_far).toBeTruthy();
    await api(app).get('/v1/driver/config').expect(401);
  });

  describe('offers', () => {
    beforeEach(() => quiesce(app));

    it('counts only offers made to the driver alone in the acceptance rate', async () => {
      const a = await createDriver(app, { at: near(300) });
      const b = await createDriver(app, { at: near(600) });
      const { id } = await orderRide(app, await signIn(app));
      // straight to the broadcast: both see it, A takes it
      await db
        .updateTable('rides')
        .set({ dispatch_stage: 'broadcast' })
        .where('id', '=', id)
        .execute();
      await dispatch.processRide(id);
      const [offerA] = await offersOf(a);
      expect(offerA).toMatchObject({ kind: 'broadcast', ride: { id } });
      expect((await offersOf(b))[0]?.kind).toBe('broadcast');
      await a.http.post(`/v1/driver/offers/${offerA!.id}/accept`).expect(200);
      // B lost a race it never had to answer: nothing against B
      expect(await counters(b)).toEqual({ offers_received: 0, offers_accepted: 0 });
      expect(await counters(a)).toEqual({ offers_received: 1, offers_accepted: 1 });
      // and B's screen is told the offer is gone
      expect(await offersOf(b)).toEqual([]);
      expect(await closedEvents(id)).toContainEqual(
        expect.objectContaining({ driverId: b.id, status: 'withdrawn' }),
      );
    });

    it('stores why a driver let a direct offer pass, and counts the offer', async () => {
      const d = await createDriver(app, { at: near(300) });
      const { id } = await orderRide(app, await signIn(app));
      await dispatch.processRide(id);
      const [offer] = await offersOf(d);
      expect(offer).toMatchObject({ kind: 'direct' });
      expect(await counters(d)).toEqual({ offers_received: 1, offers_accepted: 0 });
      await d.http
        .post(`/v1/driver/offers/${offer!.id}/decline`)
        .send({ reason: 'too_far' })
        .expect(204);
      const view = await admin.get(`/v1/admin/rides/${id}`).expect(200);
      expect(view.body.offers[0]).toMatchObject({ status: 'declined', declineReason: 'too_far' });
      // an app that sends no body still declines
      const other = await orderRide(app, await signIn(app));
      await dispatch.processRide(other.id);
      const [second] = await offersOf(d);
      await d.http.post(`/v1/driver/offers/${second!.id}/decline`).expect(204);
    });

    it('closes pending offers on the drivers’ screens when an operator assigns or cancels', async () => {
      const offered = await createDriver(app, { at: near(300) });
      const chosen = await createDriver(app, { at: near(2000) });
      const assigned = await orderRide(app, await signIn(app));
      await dispatch.processRide(assigned.id);
      expect((await offersOf(offered))[0]?.ride.id).toBe(assigned.id);
      await admin
        .post(`/v1/admin/rides/${assigned.id}/assign`)
        .send({ driverId: chosen.id })
        .expect(200);
      expect(await closedEvents(assigned.id)).toEqual([
        expect.objectContaining({ driverId: offered.id, status: 'withdrawn' }),
      ]);

      const cancelled = await orderRide(app, await signIn(app));
      await dispatch.processRide(cancelled.id);
      expect((await offersOf(offered))[0]?.ride.id).toBe(cancelled.id);
      await admin
        .post(`/v1/admin/rides/${cancelled.id}/cancel`)
        .send({ reason: 'Mijoz qo‘ng‘iroq qildi' })
        .expect(200);
      expect(await closedEvents(cancelled.id)).toEqual([
        expect.objectContaining({ driverId: offered.id, status: 'withdrawn' }),
      ]);
    });

    it('never gives luggage to a car with the gas tank in its trunk', async () => {
      const tank = await createDriver(app, {
        at: near(200),
        vehicle: { features: ['ac', 'big_trunk'], cngInTrunk: true },
      });
      const free = await createDriver(app, {
        at: near(900),
        vehicle: { features: ['big_trunk'] },
      });
      const me = await tank.http.get('/v1/driver/me').expect(200);
      expect(me.body.vehicle).toMatchObject({ cngInTrunk: true, luggage: false });
      const { id } = await orderRide(app, await signIn(app), { options: ['luggage'] });
      await dispatch.processRide(id);
      expect(await offersOf(tank)).toEqual([]);
      expect((await offersOf(free))[0]?.ride.id).toBe(id);
      // an operator who moved the tank corrects the car
      const fixed = await admin
        .patch(`/v1/admin/drivers/${tank.id}/vehicle`)
        .send({ cngInTrunk: false })
        .expect(200);
      expect(fixed.body.vehicle).toMatchObject({ cngInTrunk: false, luggage: true });
    });
  });

  it('lets a rejected or blocked driver appeal, once at a time, and operators answer', async () => {
    const session = await signIn(app, undefined, 'driver');
    const http = api(app, session.accessToken);
    const applied = await http.post('/v1/driver/application').send(application()).expect(200);
    const id = applied.body.id as string;
    // pending drivers have nothing to appeal yet
    await http.post('/v1/driver/appeals').send({ text: 'Iltimos ko‘rib chiqing' }).expect(409);
    await admin
      .post(`/v1/admin/drivers/${id}/reject`)
      .send({ reason: 'Hujjatlar o‘qilmaydi' })
      .expect(200);
    const appeal = await http
      .post('/v1/driver/appeals')
      .send({ text: 'Hujjatlarni qayta yukladim, tiniq rasmlar' })
      .expect(201);
    expect(appeal.body).toMatchObject({ status: 'open', statusAt: 'rejected' });
    await http.post('/v1/driver/appeals').send({ text: 'Yana bir marta so‘rayman' }).expect(409);

    const queue = await admin.get('/v1/admin/drivers/appeals').expect(200);
    expect(queue.body.find((a: { id: string }) => a.id === appeal.body.id)).toMatchObject({
      driverId: id,
      driverStatus: 'rejected',
      statusReason: 'Hujjatlar o‘qilmaydi',
    });
    const resolved = await admin
      .post(`/v1/admin/drivers/appeals/${appeal.body.id}/resolve`)
      .send({ resolution: 'Hujjatlar qabul qilindi, arizani qayta yuboring' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    await admin
      .post(`/v1/admin/drivers/appeals/${appeal.body.id}/resolve`)
      .send({ resolution: 'twice' })
      .expect(404);
    const mine = await http.get('/v1/driver/appeals').expect(200);
    expect(mine.body[0]).toMatchObject({
      status: 'resolved',
      resolution: 'Hujjatlar qabul qilindi, arizani qayta yuboring',
    });
    const alerted = await db
      .selectFrom('outbox')
      .select('payload')
      .where('topic', '=', 'driver.appeal')
      .execute();
    expect(alerted.map((e) => (e.payload as { appealId: string }).appealId)).toContain(
      appeal.body.id,
    );
  });
});
