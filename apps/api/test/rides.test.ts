import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  FAR,
  GULISTON,
  MID,
  NEAR,
  orderRide,
  signIn,
  signInAdmin,
  uniquePhone,
} from './helpers.js';

const VILLAGE = { lat: 40.44, lng: 68.78 }; // ~3.5 km south of Guliston
const SAMARKAND = { lat: 39.6542, lng: 66.9597 };

describe('rides', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
  });
  afterAll(() => app.close());

  /** Moves a ride timestamp into the past, as if that much time had passed. */
  async function backdate(rideId: string, column: 'arrived_at' | 'assigned_at', seconds: number) {
    await db
      .updateTable('rides')
      .set({ [column]: new Date(Date.now() - seconds * 1000) })
      .where('id', '=', rideId)
      .execute();
  }

  async function assigned(opts: Parameters<typeof orderRide>[2] = {}) {
    const rider = await signIn(app);
    const driver = await createDriver(app);
    const { id, ride, quote } = await orderRide(app, rider, opts);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    return { rider, driver, id, ride, quote, r: api(app, rider.accessToken) };
  }

  describe('quotes', () => {
    it('prices a city trip in both classes by the fixed bands', async () => {
      const rider = await signIn(app);
      const res = await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, options: ['luggage'] })
        .expect(200);
      expect(res.body).toMatchObject({
        kind: 'city',
        city: { slug: 'guliston' },
        routeSource: 'estimate',
        options: ['luggage'],
        paymentMethods: ['cash', 'card'],
        waiting: { free_minutes: 2, per_minute: 500 },
        cancellationFee: 3000,
        fares: {
          economy: { kind: 'city', base: 7000, options: { luggage: 2000 }, total: 9000 },
          comfort: { base: 8800, total: 10_800 },
        },
      });
      expect(res.body.distanceM).toBeGreaterThan(2000);
      expect(res.body.distanceM).toBeLessThan(4000);
      expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    });

    it('serves villages around the city and says where it does not work', async () => {
      const rider = api(app, (await signIn(app)).accessToken);
      const village = await rider
        .post('/v1/rides/quote')
        .send({ pickup: VILLAGE, dropoff: GULISTON })
        .expect(200);
      expect(village.body.fares.economy.outsideM).toBeGreaterThan(3000);
      expect(village.body.fares.economy.outside).toBeGreaterThan(0);

      const far = await rider
        .post('/v1/rides/quote')
        .send({ pickup: SAMARKAND, dropoff: GULISTON })
        .expect(422);
      expect(far.body).toMatchObject({
        message: 'Bu hududda hozircha ishlamaymiz',
        resolved: { status: 'outside' },
      });
      await rider.post('/v1/rides/quote').send({ pickup: GULISTON, dropoff: GULISTON }).expect(400);
      await rider
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, options: ['massage'] })
        .expect(400);
    });

    it('prices a trip to Yangiyer as intercity with the seat share', async () => {
      const rider = api(app, (await signIn(app)).accessToken);
      const res = await rider
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: { lat: 40.2701, lng: 68.8166 } })
        .expect(200);
      expect(res.body.kind).toBe('intercity');
      const km = Math.ceil(res.body.distanceM / 1000);
      expect(res.body.fares.economy.total).toBe(Math.max(25_000, km * 1700));
      expect(res.body.fares.economy.seat.rear).toBe(
        Math.ceil((res.body.fares.economy.total * 0.3) / 100) * 100,
      );
    });

    it('publishes the tariff where a ride would start', async () => {
      const here = await api(app)
        .get(`/v1/tariffs?lat=${GULISTON.lat}&lng=${GULISTON.lng}`)
        .expect(200);
      expect(here.body).toMatchObject({
        serviceable: true,
        city: 'Guliston',
        paymentMethods: ['cash', 'card'],
      });
      expect(here.body.tariff.classes.economy.bands[0]).toEqual({ up_to_m: 2000, price: 5000 });
      const there = await api(app)
        .get(`/v1/tariffs?lat=${SAMARKAND.lat}&lng=${SAMARKAND.lng}`)
        .expect(200);
      expect(there.body).toMatchObject({ serviceable: false, tariff: null });
    });
  });

  describe('ordering', () => {
    it('orders exactly the quoted price, once per clientRequestId', async () => {
      const rider = await signIn(app);
      const r = api(app, rider.accessToken);
      const quote = await r
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: FAR })
        .expect(200);
      const body = {
        quoteId: quote.body.quoteId,
        class: 'comfort',
        pickup: { address: 'Mustaqillik 12', landmark: '5-maktab qarshisi' },
        dropoff: { address: 'GulDU' },
        comment: 'Darvoza oldida kutaman',
        clientRequestId: randomUUID(),
      };
      const first = await r.post('/v1/rides').send(body).expect(201);
      expect(first.body).toMatchObject({
        status: 'searching',
        channel: 'app',
        class: 'comfort',
        kind: 'city',
        pickup: { address: 'Mustaqillik 12', landmark: '5-maktab qarshisi', lat: GULISTON.lat },
        dropoff: { address: 'GulDU', landmark: null },
        comment: 'Darvoza oldida kutaman',
        fare: { quoted: quote.body.fares.comfort.total, waiting: 0, total: null },
        paymentMethod: 'cash',
        driver: null,
        canCancel: true,
        cancelFeeNow: 0,
      });
      expect(first.body.number).toBeGreaterThan(10_000);
      expect(first.body.events.map((e: { type: string }) => e.type)).toEqual(['requested']);

      const retry = await r.post('/v1/rides').send(body).expect(200);
      expect(retry.body.id).toBe(first.body.id);

      const other = await r
        .post('/v1/rides')
        .send({ ...body, clientRequestId: randomUUID() })
        .expect(409);
      expect(other.body).toMatchObject({ rideId: first.body.id });
      expect((await r.get('/v1/rides/current').expect(200)).body.ride.id).toBe(first.body.id);
    });

    it('refuses an expired or foreign quote', async () => {
      const rider = await signIn(app);
      const r = api(app, rider.accessToken);
      const quote = await r
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: NEAR })
        .expect(200);
      const order = (over: Record<string, unknown> = {}) => ({
        quoteId: quote.body.quoteId,
        class: 'economy',
        clientRequestId: randomUUID(),
        ...over,
      });
      // card rides: test/payments.test.ts (prepaid before dispatch)
      const stranger = api(app, (await signIn(app)).accessToken);
      await stranger.post('/v1/rides').send(order()).expect(404);
      await db
        .updateTable('quotes')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', quote.body.quoteId)
        .execute();
      const expired = await r.post('/v1/rides').send(order()).expect(410);
      expect(expired.body.message).toMatch(/eskirdi/);
    });
  });

  describe('the trip', () => {
    it('goes searching -> assigned -> arrived -> in progress -> completed with paid waiting', async () => {
      const { rider, driver, id, r } = await assigned({ dropoff: MID });
      const seen = await r.get(`/v1/rides/${id}`).expect(200);
      expect(seen.body).toMatchObject({
        status: 'driver_assigned',
        driver: { id: driver.id, name: 'Aziz Karimov', rating: 4.8 },
        vehicle: { make: 'Chevrolet', model: 'Cobalt', colour: 'oq' },
      });
      expect(seen.body.vehicle.plateFormatted).toMatch(/^20 [A-Z] \d{3} [A-Z]{2}$/);
      expect(seen.body.driver.location).toMatchObject({ lat: GULISTON.lat });

      const current = await driver.http.get('/v1/driver/rides/current').expect(200);
      expect(current.body.ride).toMatchObject({
        id,
        rider: { phone: rider.phone, rating: 4.8, noShows: 0 },
        pickup: { landmark: 'Bozor yonida' },
      });

      await driver.http.post(`/v1/driver/rides/${id}/start`).expect(409);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      await backdate(id, 'arrived_at', 5 * 60 + 10);
      const started = await driver.http.post(`/v1/driver/rides/${id}/start`).expect(200);
      // 2 free minutes, then 500 so'm for each started minute: 3 min 10 s -> 4 minutes
      expect(started.body.fare.waiting).toBe(2000);
      await r.post(`/v1/rides/${id}/cancel`).send({}).expect(409);

      const done = await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
      const quoted = done.body.fare.quoted as number;
      expect(done.body).toMatchObject({
        status: 'completed',
        fare: { quoted, waiting: 2000, total: quoted + 2000 },
        paymentStatus: 'paid',
        // the launch promo: no commission, the 1% tax is withheld all the same
        earnings: {
          fare: quoted + 2000,
          commission: 0,
          commissionNote: 'promo',
          tax: Math.round((quoted + 2000) / 100),
        },
      });
      // a repeat after a lost answer is not an error: the ride is simply shown again
      const again = await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
      expect(again.body.fare.total).toBe(quoted + 2000);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);

      const view = await r.get(`/v1/rides/${id}`).expect(200);
      expect(view.body.events.map((e: { type: string }) => e.type)).toEqual([
        'requested',
        'assigned',
        'arrived',
        'started',
        'completed',
      ]);
      expect((await driver.http.get('/v1/driver/rides/current').expect(200)).body.ride).toBeNull();
      expect((await r.get('/v1/rides/current').expect(200)).body.ride).toBeNull();
      const history = await r.get('/v1/rides').expect(200);
      expect(history.body.items[0]).toMatchObject({ id, status: 'completed' });
      const driven = await driver.http.get('/v1/driver/rides').expect(200);
      expect(driven.body.items[0]).toMatchObject({ id, earnings: { commission: 0 } });
      const me = await driver.http.get('/v1/driver/me').expect(200);
      expect(me.body.stats.ridesCompleted).toBe(1);
      expect(me.body.balance).toBe(-Math.round((quoted + 2000) / 100));
    });

    it('keeps rides to the people in them', async () => {
      const { id, driver } = await assigned();
      const stranger = await signIn(app);
      await api(app, stranger.accessToken).get(`/v1/rides/${id}`).expect(404);
      const otherDriver = await createDriver(app);
      await otherDriver.http.post(`/v1/driver/rides/${id}/arrive`).expect(404);
      await otherDriver.http.get(`/v1/driver/rides/${id}`).expect(404);
      await driver.http.get(`/v1/driver/rides/${id}`).expect(200);
    });

    it('never gives a busy driver a second ride', async () => {
      const { driver } = await assigned();
      const other = await signIn(app);
      const { id } = await orderRide(app, other);
      const busy = await admin
        .post(`/v1/admin/rides/${id}/assign`)
        .send({ driverId: driver.id })
        .expect(409);
      expect(busy.body.message).toMatch(/faol buyurtma bor/);
    });
  });

  describe('cancellation', () => {
    it('is free for the rider until the driver waited the free minutes, then costs the fee', async () => {
      const early = await assigned();
      const free = await early.r
        .post(`/v1/rides/${early.id}/cancel`)
        .send({ reason: 'Rejam o‘zgardi' })
        .expect(200);
      expect(free.body).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'rider',
        cancelReason: 'Rejam o‘zgardi',
        fare: { cancellationFee: 0 },
        canCancel: false,
      });
      await early.r.post(`/v1/rides/${early.id}/cancel`).send({}).expect(409);

      const late = await assigned();
      await late.driver.http.post(`/v1/driver/rides/${late.id}/arrive`).expect(200);
      expect((await late.r.get(`/v1/rides/${late.id}`).expect(200)).body.cancelFeeNow).toBe(0);
      await backdate(late.id, 'arrived_at', 121);
      expect((await late.r.get(`/v1/rides/${late.id}`).expect(200)).body.cancelFeeNow).toBe(3000);
      const paid = await late.r.post(`/v1/rides/${late.id}/cancel`).send({}).expect(200);
      expect(paid.body.fare.cancellationFee).toBe(3000);
      // the driver is free again
      const next = await orderRide(app, await signIn(app));
      await admin
        .post(`/v1/admin/rides/${next.id}/assign`)
        .send({ driverId: late.driver.id })
        .expect(200);
    });

    it('sends the ride back to dispatch when the driver drops it, and counts it', async () => {
      const { driver, id, r } = await assigned();
      await driver.http
        .post(`/v1/driver/rides/${id}/cancel`)
        .send({ reasonCode: 'car_problem', note: 'Balon teshildi' })
        .expect(204);
      const back = await r.get(`/v1/rides/${id}`).expect(200);
      expect(back.body).toMatchObject({ status: 'searching', driver: null, vehicle: null });
      expect(back.body.events.at(-1)).toMatchObject({
        type: 'driver_released',
        actor: 'driver',
        data: { reason: 'Avtomobil nosoz: Balon teshildi', driverId: driver.id },
      });
      const me = await driver.http.get('/v1/driver/me').expect(200);
      expect(me.body.stats.ridesCancelled).toBe(1);
      expect(me.body.priority.reliability).toBeLessThan(1);
    });

    it('lets the driver end the ride as a no-show only after waiting', async () => {
      const { driver, id, r, rider } = await assigned();
      await driver.http
        .post(`/v1/driver/rides/${id}/cancel`)
        .send({ reasonCode: 'rider_no_show' })
        .expect(409);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      const early = await driver.http
        .post(`/v1/driver/rides/${id}/cancel`)
        .send({ reasonCode: 'rider_no_show' })
        .expect(409);
      expect(early.body.message).toBe('Yo‘lovchini kamida 5 daqiqa kuting');
      await backdate(id, 'arrived_at', 5 * 60);
      await driver.http
        .post(`/v1/driver/rides/${id}/cancel`)
        .send({ reasonCode: 'rider_no_show' })
        .expect(204);
      const done = await r.get(`/v1/rides/${id}`).expect(200);
      expect(done.body).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelReason: 'Yo‘lovchi chiqmadi',
        fare: { cancellationFee: 3000 },
      });
      // the next driver sees the no-show
      const again = await orderRide(app, rider);
      const d2: DriverFixture = await createDriver(app);
      await admin.post(`/v1/admin/rides/${again.id}/assign`).send({ driverId: d2.id }).expect(200);
      const card = await d2.http.get(`/v1/driver/rides/${again.id}`).expect(200);
      expect(card.body.rider.noShows).toBe(1);
      expect((await driver.http.get('/v1/driver/me').expect(200)).body.stats.ridesCancelled).toBe(
        0,
      );
    });
  });

  describe('operators', () => {
    it('orders by phone for a caller without the app, and the caller can follow it later', async () => {
      const phone = uniquePhone();
      const res = await admin
        .post('/v1/admin/rides')
        .send({
          riderPhone: phone.slice(4),
          riderName: 'Karim aka',
          pickup: { ...GULISTON, address: 'Markaziy bozor', landmark: 'Go‘sht rastasi' },
          dropoff: { ...FAR, address: 'Shifoxona', landmark: null },
          class: 'economy',
          comment: 'Keksa kishi, yordam kerak',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'searching',
        channel: 'phone',
        rider: { phone, name: 'Karim aka' },
        pickup: { address: 'Markaziy bozor', landmark: 'Go‘sht rastasi' },
        dispatch: { stage: 'direct', directOffers: 0 },
        offers: [],
      });
      expect(res.body.events[0]).toMatchObject({ type: 'requested', actor: 'operator' });
      // one open ride per caller
      await admin
        .post('/v1/admin/rides')
        .send({ riderPhone: phone, pickup: GULISTON, dropoff: NEAR })
        .expect(409);

      const caller = await signIn(app, phone);
      const current = await api(app, caller.accessToken).get('/v1/rides/current').expect(200);
      expect(current.body.ride.id).toBe(res.body.id);

      const list = await admin.get(`/v1/admin/rides?q=${phone.slice(-7)}`).expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).toEqual([res.body.id]);
      const byNumber = await admin.get(`/v1/admin/rides?q=${res.body.number}`).expect(200);
      expect(byNumber.body[0].id).toBe(res.body.id);

      await admin.post(`/v1/admin/rides/${res.body.id}/cancel`).send({}).expect(400);
      const cancelled = await admin
        .post(`/v1/admin/rides/${res.body.id}/cancel`)
        .send({ reason: 'Mijoz qayta qo‘ng‘iroq qildi' })
        .expect(200);
      expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledBy: 'operator' });
      const all = await admin.get('/v1/admin/rides?status=cancelled').expect(200);
      expect(all.body.some((x: { id: string }) => x.id === res.body.id)).toBe(true);
    });

    it('reassigns a ride from one driver to another', async () => {
      const { id, driver } = await assigned();
      const second = await createDriver(app);
      const moved = await admin
        .post(`/v1/admin/rides/${id}/assign`)
        .send({ driverId: second.id })
        .expect(200);
      expect(moved.body.driver.id).toBe(second.id);
      expect(moved.body.events.slice(-2).map((e: { type: string }) => e.type)).toEqual([
        'driver_released',
        'assigned',
      ]);
      expect((await driver.http.get('/v1/driver/rides/current').expect(200)).body.ride).toBeNull();
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: second.id }).expect(409);

      const rider = await signIn(app);
      await api(app, rider.accessToken).get('/v1/admin/rides').expect(403);
    });
  });
});
