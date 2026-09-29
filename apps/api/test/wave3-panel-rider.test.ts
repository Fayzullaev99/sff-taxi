import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { REDIS } from '../src/core/redis/redis.token.js';
import { FiscalService } from '../src/modules/fiscal/fiscal.service.js';
import { checkoutUrl, returnUrl } from '../src/modules/payments/payment-config.js';
import { uuidFloor } from '../src/modules/rides/rides.service.js';
import { PositionsJob } from '../src/modules/realtime/positions.job.js';
import {
  REALTIME_CHANNEL,
  type RealtimeBus,
  type RealtimeMessage,
  RealtimePublisher,
} from '../src/modules/realtime/realtime.publisher.js';
import type { ObjectStorage } from '../src/modules/uploads/object-storage.js';
import { DEFAULT_BOOKING } from '../src/modules/settings/settings.module.js';
import { OBJECT_STORAGE } from '../src/modules/uploads/uploads.service.js';
import { payWithPayme } from './payments-helpers.js';
import {
  api,
  createDriver,
  createTestApp,
  GULISTON,
  MID,
  NEAR,
  orderRide,
  quiesce,
  signIn,
  signInAdmin,
  uniquePhone,
  startPin,
} from './helpers.js';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const near = (metres: number) => ({ lat: GULISTON.lat + metres / 110_574, lng: GULISTON.lng });

const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8335';
const EXTRA_ENV = {
  STORAGE_S3_ENDPOINT: S3_ENDPOINT,
  STORAGE_S3_BUCKET: 'sff-taxi-test',
  STORAGE_S3_ACCESS_KEY: 'taxi_dev_access',
  STORAGE_S3_SECRET_KEY: 'taxi_dev_secret_0123456789',
  STORE_URL_ANDROID_RIDER: 'https://play.google.com/store/apps/details?id=uz.sff.taxi',
  STORE_URL_IOS_DRIVER: 'https://apps.apple.com/app/id1234567890',
};
async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
const s3Up = await reachable(S3_ENDPOINT);
if (!s3Up && process.env.CI === 'true') throw new Error(`S3 not reachable at ${S3_ENDPOINT}`);
// a 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('app gaps, wave 3: operator panel and rider app', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];
  let outbox: OutboxDispatcher;
  let sub: Redis;
  const heard: RealtimeMessage[] = [];

  beforeAll(async () => {
    Object.assign(process.env, EXTRA_ENV);
    app = await createTestApp();
    if (s3Up) await app.get<ObjectStorage>(OBJECT_STORAGE).ensureBucket();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    outbox = new OutboxDispatcher(app.get(Database), [
      new RealtimePublisher(app.get(Database), app.get(REDIS)),
    ]);
    sub = new Redis(process.env.REDIS_URL!);
    await sub.subscribe(REALTIME_CHANNEL);
    sub.on('message', (_c, raw: string) => heard.push(JSON.parse(raw) as RealtimeMessage));
    // seats booked without a deposit here (test/intercity-deposits.test.ts has them)
    await admin
      .put('/v1/admin/settings/booking')
      .send({ ...DEFAULT_BOOKING, deposit_percent: 0 })
      .expect(200);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    await sub.quit();
    await app.close();
    for (const key of Object.keys(EXTRA_ENV)) delete process.env[key];
  });

  const drain = async () => {
    while ((await outbox.runOnce()) > 0);
    // pub/sub delivery is asynchronous
    await new Promise((r) => setTimeout(r, 100));
  };
  const events = <T extends RealtimeMessage['event']['type']>(type: T) =>
    heard
      .map((m) => m as RealtimeMessage & { event: { type: string } })
      .filter((m) => m.event.type === type) as (RealtimeMessage & {
      event: Extract<RealtimeMessage['event'], { type: T }>;
    })[];
  const topics = async (topic: string) =>
    (await db.selectFrom('outbox').select('payload').where('topic', '=', topic).execute()).map(
      (e) => e.payload,
    );

  describe('operator panel', () => {
    beforeEach(() => quiesce(app));

    it('orders a ride for later by phone from a quote with scheduledFor, next to an open ride', async () => {
      const config = await api(app).get('/v1/config').expect(200);
      expect(config.body.features.scheduledPhoneOrders).toBe(true);

      const phone = uniquePhone();
      // the caller already has a ride now
      await admin
        .post('/v1/admin/rides')
        .send({
          riderPhone: phone,
          pickup: { ...GULISTON, address: 'Bozor' },
          dropoff: { ...MID, address: 'Vokzal' },
        })
        .expect(201);
      const at = new Date(Date.now() + 3 * 3600_000);
      const quote = await admin
        .post('/v1/admin/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, scheduledFor: at.toISOString() })
        .expect(200);
      expect(quote.body.scheduledFor).toBe(at.toISOString());
      // an operator's quote shows no owed fees of the operator's own account
      expect(quote.body.owedFee).toBeNull();
      const body = {
        riderPhone: phone,
        quoteId: quote.body.quoteId,
        pickup: { address: 'Uy', landmark: 'Maktab yonida' },
        dropoff: { address: 'Vokzal', landmark: null },
        clientRequestId: randomUUID(),
      };
      const later = await admin.post('/v1/admin/rides').send(body).expect(201);
      expect(later.body).toMatchObject({
        status: 'scheduled',
        channel: 'phone',
        scheduledFor: at.toISOString(),
      });
      // a double click is the same ride
      const again = await admin.post('/v1/admin/rides').send(body).expect(200);
      expect(again.body.id).toBe(later.body.id);
    });

    it('books seats for a caller once per clientRequestId, and a rider’s double tap once', async () => {
      const driver = await createDriver(app, { online: false });
      const trip = await driver.http
        .post('/v1/driver/intercity/trips')
        .send({ from: 'guliston', to: 'toshkent', departureAt: inMinutes(300), seats: 3 })
        .expect(201);
      const body = { riderPhone: uniquePhone(), seats: 1, clientRequestId: randomUUID() };
      const first = await admin
        .post(`/v1/admin/intercity/trips/${trip.body.id}/bookings`)
        .send(body)
        .expect(201);
      const second = await admin
        .post(`/v1/admin/intercity/trips/${trip.body.id}/bookings`)
        .send(body)
        .expect(200);
      expect(second.body.id).toBe(first.body.id);
      // without a key every request is a booking (old panels)
      const legacy = await admin
        .post(`/v1/admin/intercity/trips/${trip.body.id}/bookings`)
        .send({ riderPhone: uniquePhone(), seats: 1 })
        .expect(201);
      expect(legacy.body.id).not.toBe(first.body.id);

      const rider = await signIn(app);
      const key = randomUUID();
      const taps = await Promise.all(
        [1, 2, 3].map(() =>
          api(app, rider.accessToken)
            .post(`/v1/intercity/trips/${trip.body.id}/bookings`)
            .send({ seats: 1, clientRequestId: key }),
        ),
      );
      expect(taps.map((t) => t.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(taps.map((t) => t.body.id)).size).toBe(1);
      const seats = await db
        .selectFrom('intercity_trips')
        .select('seats_booked')
        .where('id', '=', trip.body.id)
        .executeTakeFirstOrThrow();
      expect(seats.seats_booked).toBe(3);
    });

    it('lists card payments (ride prepayments and top-ups) with filters and totals', async () => {
      const driver = await createDriver(app, { online: false });
      const topup = await driver.http
        .post('/v1/driver/topups')
        .send({ amount: 25_000 })
        .expect(201);
      const rider = await signIn(app);
      const quote = await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      const ride = await api(app, rider.accessToken)
        .post('/v1/rides')
        .send({
          quoteId: quote.body.quoteId,
          class: 'economy',
          paymentMethod: 'card',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      await payWithPayme(app, ride.body.payment.id, ride.body.payment.amount);

      const topups = await admin
        .get(`/v1/admin/payments/intents?purpose=topup&status=pending&driverId=${driver.id}`)
        .expect(200);
      expect(topups.body.items).toEqual([
        expect.objectContaining({
          id: topup.body.id,
          purpose: 'topup',
          status: 'pending',
          amount: 25_000,
          driverId: driver.id,
          phone: driver.session.phone,
        }),
      ]);
      const paid = await admin
        .get(`/v1/admin/payments/intents?status=paid&phone=${encodeURIComponent(rider.phone)}`)
        .expect(200);
      expect(paid.body.items).toEqual([
        expect.objectContaining({
          id: ride.body.payment.id,
          purpose: 'ride',
          provider: 'payme',
          rideId: ride.body.id,
          rideNumber: ride.body.number,
        }),
      ]);
      // expired or cancelled: "failed"
      await db
        .updateTable('payment_intents')
        .set({ status: 'expired' })
        .where('id', '=', topup.body.id)
        .execute();
      const failed = await admin
        .get(`/v1/admin/payments/intents?status=failed&driverId=${driver.id}`)
        .expect(200);
      expect(failed.body.items.map((i: { id: string }) => i.id)).toEqual([topup.body.id]);
      const summary = await admin.get('/v1/admin/payments/intents/summary').expect(200);
      expect(summary.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ purpose: 'ride', status: 'paid', count: expect.any(Number) }),
        ]),
      );
      await admin.get('/v1/admin/payments/intents?status=bogus').expect(400);
    });

    it('shows each driver’s card money owed in the list, the detail and the payouts screen', async () => {
      const driver = await createDriver(app, { at: GULISTON });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const quote = await http
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      const ride = await http
        .post('/v1/rides')
        .send({
          quoteId: quote.body.quoteId,
          class: 'economy',
          paymentMethod: 'card',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      await payWithPayme(app, ride.body.payment.id, ride.body.payment.amount);
      await admin
        .post(`/v1/admin/rides/${ride.body.id}/assign`)
        .send({ driverId: driver.id })
        .expect(200);
      for (const step of ['arrive', 'start', 'complete']) {
        await driver.http.post(`/v1/driver/rides/${ride.body.id}/${step}`).expect(200);
      }
      const fare = ride.body.fare.quoted as number;
      await admin
        .post(`/v1/admin/billing/drivers/${driver.id}/ledger`)
        .send({ kind: 'payout', amount: 2000, note: 'Karta 8600…1234, #77' })
        .expect(201);

      const list = await admin
        .get(`/v1/admin/drivers?q=${driver.session.phone.slice(4)}`)
        .expect(200);
      expect(list.body[0]).toMatchObject({ id: driver.id, cardOwed: fare - 2000 });
      const detail = await admin.get(`/v1/admin/drivers/${driver.id}`).expect(200);
      expect(detail.body.cardMoney).toMatchObject({
        credited: fare,
        paidOut: 2000,
        owed: fare - 2000,
      });
      // the balance also carries the ride's tax: a payout is limited by it
      expect(detail.body.cardMoney.payableNow).toBe(Math.min(fare - 2000, detail.body.balance));
      const payouts = await admin.get('/v1/admin/drivers/payouts').expect(200);
      expect(
        payouts.body.find((p: { driverId: string }) => p.driverId === driver.id),
      ).toMatchObject({
        owed: fare - 2000,
        paidOut: 2000,
        fullName: 'Aziz Karimov',
        lastPayoutAt: expect.any(String),
      });
    });

    it('retries one fiscal receipt, never a sent one', async () => {
      const driver = await createDriver(app, { at: GULISTON });
      const rider = await signIn(app);
      const { id } = await orderRide(app, rider);
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      for (const step of ['arrive', 'start', 'complete']) {
        await driver.http.post(`/v1/driver/rides/${id}/${step}`).expect(200);
      }
      expect(await app.get(FiscalService).issue({ rideId: id })).toBe('skipped');
      const receipt = await db
        .selectFrom('fiscal_receipts')
        .select('id')
        .where('ride_id', '=', id)
        .executeTakeFirstOrThrow();
      const retried = await admin.post(`/v1/admin/fiscal/receipts/${receipt.id}/retry`).expect(200);
      expect(retried.body).toMatchObject({ id: receipt.id, rideId: id, status: 'pending' });
      expect((await topics('fiscal.receipt_due')).filter((p) => p.rideId === id)).toHaveLength(2);
      await db
        .updateTable('fiscal_receipts')
        .set({ status: 'sent', sent_at: new Date() })
        .where('id', '=', receipt.id)
        .execute();
      await admin.post(`/v1/admin/fiscal/receipts/${receipt.id}/retry`).expect(409);
      await admin.post(`/v1/admin/fiscal/receipts/${randomUUID()}/retry`).expect(404);
      await admin.get(`/v1/admin/fiscal/receipts/${receipt.id}`).expect(200);
    });

    it('tells the map which drivers went offline, with an empty batch when nobody is left', async () => {
      await db.updateTable('drivers').set({ is_online: false }).execute();
      const a = await createDriver(app, { at: near(200) });
      const b = await createDriver(app, { at: near(400) });
      const sent: RealtimeMessage[] = [];
      const bus = { publish: (m: RealtimeMessage) => Promise.resolve(void sent.push(m)) };
      const job = new PositionsJob(app.get(Database), bus as unknown as RealtimeBus);
      const batch = (i: number) =>
        sent[i]!.event as Extract<RealtimeMessage['event'], { type: 'drivers.positions' }>;
      const t0 = new Date();
      expect(await job.runOnce(t0)).toBe(2);
      expect(batch(0).offline).toEqual([]);
      await b.http.post('/v1/driver/shift').send({ online: false }).expect(200);
      expect(await job.runOnce(new Date(t0.getTime() + 5000))).toBe(1);
      expect(batch(1).drivers.map((d) => d.id)).toEqual([a.id]);
      expect(batch(1).offline).toEqual([b.id]);
      await a.http.post('/v1/driver/shift').send({ online: false }).expect(200);
      await job.runOnce(new Date(t0.getTime() + 10_000));
      // nobody left: the batch is sent anyway, empty, naming who left
      expect(batch(2)).toMatchObject({ drivers: [], offline: [a.id] });
      // then quiet, with an empty batch once a minute
      await job.runOnce(new Date(t0.getTime() + 15_000));
      expect(sent).toHaveLength(3);
      await job.runOnce(new Date(t0.getTime() + 75_000));
      expect(sent).toHaveLength(4);
      expect(batch(3)).toMatchObject({ drivers: [], offline: [] });
    });

    it('labels decline and release reason codes in Uzbek for operators', async () => {
      const reasons = await admin.get('/v1/admin/reasons').expect(200);
      expect(reasons.body.decline.too_far).toBe('Juda uzoq');
      expect(reasons.body.driverCancel.car_problem).toBe('Avtomobil nosoz');

      const first = await createDriver(app, { at: near(300) });
      const rider = await signIn(app);
      const { id } = await orderRide(app, rider);
      const { DispatchService } = await import('../src/modules/dispatch/dispatch.service.js');
      await app.get(DispatchService).tick();
      const offers = await first.http.get('/v1/driver/offers').expect(200);
      await first.http
        .post(`/v1/driver/offers/${offers.body[0].id}/decline`)
        .send({ reason: 'too_far' })
        .expect(204);
      const second = await createDriver(app, { at: near(600) });
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: second.id }).expect(200);
      await second.http
        .post(`/v1/driver/rides/${id}/cancel`)
        .send({ reasonCode: 'car_problem', note: 'G‘ildirak teshildi' })
        .expect(204);
      const view = await admin.get(`/v1/admin/rides/${id}`).expect(200);
      expect(view.body.offers[0]).toMatchObject({
        declineReason: 'too_far',
        declineReasonLabel: 'Juda uzoq',
      });
      const declined = view.body.events.find((e: { type: string }) => e.type === 'offer_declined');
      expect(declined.reasonLabel).toBe('Juda uzoq');
      const released = view.body.events.find((e: { type: string }) => e.type === 'driver_released');
      expect(released).toMatchObject({
        data: { reasonCode: 'car_problem', reason: 'Avtomobil nosoz: G‘ildirak teshildi' },
        reasonLabel: 'Avtomobil nosoz',
      });
      expect(view.body.reasonLabels.decline.break).toBe('Dam olyapman');
    });
  });

  describe('ride lists (load test fixes)', () => {
    it('bounds the day filter by time-ordered ids and finds rides by a phone fragment', async () => {
      const at = new Date();
      expect(uuidFloor(at) <= uuidv7({ msecs: at.getTime() })).toBe(true);
      expect(uuidFloor(new Date(at.getTime() + 1)) > uuidv7({ msecs: at.getTime() })).toBe(true);
      const rider = await signIn(app);
      const { id } = await orderRide(app, rider);
      const day = (offset: number) =>
        new Date(Date.now() + 5 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
      const today = await admin
        .get(`/v1/admin/rides?status=all&from=${day(0)}&to=${day(0)}`)
        .expect(200);
      expect(today.body.map((r: { id: string }) => r.id)).toContain(id);
      const tomorrow = await admin.get(`/v1/admin/rides?status=all&from=${day(1)}`).expect(200);
      expect(tomorrow.body.map((r: { id: string }) => r.id)).not.toContain(id);
      const yesterday = await admin.get(`/v1/admin/rides?status=all&to=${day(-1)}`).expect(200);
      expect(yesterday.body.map((r: { id: string }) => r.id)).not.toContain(id);
      const byPhone = await admin
        .get(`/v1/admin/rides?status=all&q=${rider.phone.slice(-6)}`)
        .expect(200);
      expect(byPhone.body.map((r: { id: string }) => r.id)).toContain(id);
      // lists leave the tariff snapshot out; the ride view still has its rules
      expect(byPhone.body[0]).not.toHaveProperty('tariff');
      await admin.post(`/v1/admin/rides/${id}/cancel`).send({ reason: 'Sinov' }).expect(200);
    });
  });

  describe('rider app', () => {
    beforeEach(() => quiesce(app));

    it('publishes intercity cancellation rules, store links and card providers', async () => {
      const config = await api(app).get('/v1/config').expect(200);
      expect(config.body).toMatchObject({
        intercity: { freeCancelMinutes: 60, lateCancelFeePercent: 30 },
        storeUrls: {
          rider: { android: EXTRA_ENV.STORE_URL_ANDROID_RIDER, ios: null },
          driver: { android: null, ios: EXTRA_ENV.STORE_URL_IOS_DRIVER },
        },
      });
      const rider = await signIn(app);
      const quote = await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      expect(quote.body.cardProviders).toEqual(['payme', 'click']);

      const driver = await createDriver(app, { online: false });
      const trip = await driver.http
        .post('/v1/driver/intercity/trips')
        .send({ from: 'guliston', to: 'toshkent', departureAt: inMinutes(90), seats: 3 })
        .expect(201);
      const view = await api(app, rider.accessToken)
        .get(`/v1/intercity/trips/${trip.body.id}`)
        .expect(200);
      expect(view.body.cancelRules).toMatchObject({
        freeCancelMinutes: 60,
        lateCancelFeePercent: 30,
      });
      const booked = await api(app, rider.accessToken)
        .post(`/v1/intercity/trips/${trip.body.id}/bookings`)
        .send({ seats: 1, clientRequestId: randomUUID() })
        .expect(201);
      // 90 minutes ahead: free for another half hour
      expect(booked.body.cancelFeeNow).toBe(0);
      expect(new Date(booked.body.cancelFreeUntil).getTime()).toBe(
        new Date(trip.body.departureAt).getTime() - 60 * 60_000,
      );
      await db
        .updateTable('intercity_trips')
        .set({ departure_at: new Date(Date.now() + 30 * 60_000) })
        .where('id', '=', trip.body.id)
        .execute();
      const late = await api(app, rider.accessToken)
        .get(`/v1/intercity/bookings/${booked.body.id}`)
        .expect(200);
      expect(late.body.cancelFeeNow).toBe(Math.round((booked.body.price * 0.3) / 100) * 100);
    });

    it('sends each payment back to its own app, the shared URL as the fallback', () => {
      const env = loadEnv({
        ...process.env,
        PAYMENT_RETURN_URL: 'https://taxi.sff.uz/paid/{intentId}',
        PAYMENT_RETURN_URL_TOPUP: 'sff-taxi-driver://topup?id={intentId}',
      });
      expect(returnUrl(env, 'topup', 'abc')).toBe('sff-taxi-driver://topup?id=abc');
      expect(returnUrl(env, 'ride', 'abc')).toBe('https://taxi.sff.uz/paid/abc');
      const rideOnly = loadEnv({
        ...process.env,
        PAYMENT_RETURN_URL: '',
        PAYMENT_RETURN_URL_RIDE: 'sfftaxi://payments/{intentId}',
      });
      expect(returnUrl(rideOnly, 'topup', 'abc')).toBeNull();
      expect(checkoutUrl(rideOnly, 'click', 'abc', 7000, 'ride')).toContain(
        encodeURIComponent('sfftaxi://payments/abc'),
      );
      expect(checkoutUrl(rideOnly, 'click', 'abc', 7000, 'topup')).not.toContain('return_url');
    });

    it('tells the rider about a refund and an operator’s answer, the driver about an appeal', async () => {
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const quote = await http
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      const ride = await http
        .post('/v1/rides')
        .send({
          quoteId: quote.body.quoteId,
          class: 'economy',
          paymentMethod: 'card',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      await payWithPayme(app, ride.body.payment.id, ride.body.payment.amount);
      await http.post(`/v1/rides/${ride.body.id}/cancel`).send({}).expect(200);
      await admin
        .post(`/v1/admin/payments/${ride.body.payment.id}/refunded`)
        .send({ reference: 'Click reversal 991' })
        .expect(200);
      await drain();
      const refunds = events('ride.refund').filter((m) => m.event.rideId === ride.body.id);
      expect(refunds.map((m) => m.event.status)).toEqual(['refund_pending', 'refunded']);
      expect(refunds[0]!.to).toMatchObject({ admins: true, userIds: [expect.any(String)] });

      // an operator answers a complaint: the rider's stream (and push) hear it
      const complaint = await http
        .post(`/v1/rides/${ride.body.id}/complaints`)
        .send({ type: 'price', text: 'Pulim qachon qaytadi?' })
        .expect(201);
      await admin
        .post(`/v1/admin/complaints/${complaint.body.id}/messages`)
        .send({ text: 'Pul qaytarildi, 1-3 kun ichida kartaga tushadi' })
        .expect(201);
      const changed = (await topics('complaint.changed')).filter(
        (p) => p.complaintId === complaint.body.id,
      );
      expect(changed.map((p) => p.by)).toEqual(['rider', 'operator']);

      // an appeal's answer reaches the driver
      const driver = await createDriver(app, { online: false });
      await admin
        .post(`/v1/admin/drivers/${driver.id}/block`)
        .send({ reason: 'Hujjatlar tekshiruvi' })
        .expect(200);
      const appeal = await driver.http
        .post('/v1/driver/appeals')
        .send({ text: 'Hujjatlarim joyida, iltimos qayta ko‘ring' })
        .expect(201);
      await admin
        .post(`/v1/admin/drivers/appeals/${appeal.body.id}/resolve`)
        .send({ resolution: 'Ertaga ofisga keling' })
        .expect(200);
      await drain();
      expect(
        events('appeal.updated').find((m) => m.event.appealId === appeal.body.id),
      ).toMatchObject({ to: { userIds: [driver.id], admins: true } });
    });

    it('shows the road ETA to the destination during the trip, refreshed with positions', async () => {
      const driver = await createDriver(app, { at: GULISTON });
      const rider = await signIn(app);
      const { id } = await orderRide(app, rider, { pickup: GULISTON, dropoff: MID });
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      const before = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(before.body.destinationEta).toBeNull();
      const pin = await startPin(app, id);
      await driver.http.post(`/v1/driver/rides/${id}/start`).send({ pin }).expect(200);
      heard.length = 0;
      await driver.http.post('/v1/driver/location').send(near(150)).expect(204);
      await new Promise((r) => setTimeout(r, 100));
      const loc = events('driver.location').find((m) => m.event.rideId === id);
      expect(loc!.event.etaS).toBeNull();
      expect(loc!.event.destinationEtaS).toBeGreaterThan(0);
      const view = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(view.body.driverEta).toBeNull();
      expect(view.body.destinationEta).toMatchObject({ etaS: loc!.event.destinationEtaS });
    });

    it.runIf(s3Up)('takes up to three complaint photos from the uploads module', async () => {
      const driver = await createDriver(app, { at: GULISTON });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const { id } = await orderRide(app, rider);
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      for (const step of ['arrive', 'start', 'complete']) {
        await driver.http.post(`/v1/driver/rides/${id}/${step}`).expect(200);
      }
      const upload = async (purpose: string) => {
        const created = await http
          .post('/v1/uploads')
          .send({ purpose, contentType: 'image/png', sizeBytes: PNG.length })
          .expect(201);
        const put = await fetch(created.body.upload.url, {
          method: 'PUT',
          headers: created.body.upload.headers,
          body: PNG,
        });
        expect(put.status).toBe(200);
        await http.post(`/v1/uploads/${created.body.id}/complete`).expect(200);
        return created.body.id as string;
      };
      const config = await http.get('/v1/uploads/config').expect(200);
      expect(config.body.purposes.complaint_photo.contentTypes).not.toContain('application/pdf');
      // photos only: a PDF is refused for this purpose
      await http
        .post('/v1/uploads')
        .send({ purpose: 'complaint_photo', contentType: 'application/pdf', sizeBytes: 100 })
        .expect(400);
      const photos = [await upload('complaint_photo'), await upload('complaint_photo')];
      const doc = await upload('document');
      await http
        .post(`/v1/rides/${id}/complaints`)
        .send({ type: 'lost_item', text: 'Sumka qoldi', photoUploadIds: [doc] })
        .expect(400);
      const opened = await http
        .post(`/v1/rides/${id}/complaints`)
        .send({ type: 'lost_item', text: 'Sumka qoldi', photoUploadIds: photos })
        .expect(201);
      expect(opened.body.photos).toHaveLength(2);
      expect(opened.body.photos[0]).toMatchObject({ uploadId: photos[0], url: expect.any(String) });
      // the operator sees them too
      const seen = await admin.get(`/v1/admin/complaints/${opened.body.id}`).expect(200);
      expect(seen.body.photos.map((p: { uploadId: string }) => p.uploadId)).toEqual(photos);
      // one more in the thread is fine, a fourth is not
      const third = await upload('complaint_photo');
      await http
        .post(`/v1/complaints/${opened.body.id}/messages`)
        .send({ text: 'Yana bir rasm', photoUploadIds: [third] })
        .expect(201);
      const fourth = await upload('complaint_photo');
      await http
        .post(`/v1/complaints/${opened.body.id}/messages`)
        .send({ text: 'Va yana', photoUploadIds: [fourth] })
        .expect(400);
      // someone else's photo is not attachable
      const other = await signIn(app);
      await api(app, other.accessToken)
        .post(`/v1/complaints/${opened.body.id}/messages`)
        .send({ text: 'x' })
        .expect(404);
    });

    it('hides a recent destination until the rider goes there again', async () => {
      const session = await signIn(app);
      const rider = api(app, session.accessToken);
      const ride = async (dropoff: { lat: number; lng: number }) => {
        const { id } = await orderRide(app, session, { pickup: GULISTON, dropoff });
        await admin.post(`/v1/admin/rides/${id}/cancel`).send({ reason: 'Sinov' }).expect(200);
      };
      await ride(MID);
      await ride(NEAR);
      const recent = await rider.get('/v1/places/recent').expect(200);
      expect(recent.body).toHaveLength(2);
      const mid = recent.body.find((p: { lat: number }) => p.lat === MID.lat);
      expect(mid.key).toBe(`${MID.lat.toFixed(4)},${MID.lng.toFixed(4)}`);
      await rider.post('/v1/places/recent/hide').send({ key: mid.key }).expect(204);
      await rider.post('/v1/places/recent/hide').send({}).expect(400);
      const after = await rider.get('/v1/places/recent').expect(200);
      expect(after.body.map((p: { lat: number }) => p.lat)).toEqual([NEAR.lat]);
      // by coordinates too
      await rider.post('/v1/places/recent/hide').send(NEAR).expect(204);
      expect((await rider.get('/v1/places/recent').expect(200)).body).toEqual([]);
      // going there again brings it back
      await ride(MID);
      const back = await rider.get('/v1/places/recent').expect(200);
      expect(back.body.map((p: { lat: number }) => p.lat)).toEqual([MID.lat]);
      await rider.delete('/v1/places/recent/hidden').expect(204);
      expect((await rider.get('/v1/places/recent').expect(200)).body).toHaveLength(2);
    });
  });
});
