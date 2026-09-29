import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { REDIS } from '../src/core/redis/redis.token.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { NotificationsHandler } from '../src/modules/notifications/notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import {
  REALTIME_CHANNEL,
  type RealtimeMessage,
  RealtimePublisher,
} from '../src/modules/realtime/realtime.publisher.js';
import { RidesService } from '../src/modules/rides/rides.service.js';
import { type Fake, startFake } from './fakes.js';
import { payWithPayme } from './payments-helpers.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  orderRide,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
  uniquePhone,
} from './helpers.js';

interface PushSent {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const near = (metres: number) => ({ lat: GULISTON.lat + metres / 110_574, lng: GULISTON.lng });
let counter = 0;
const token = () => `ExponentPushToken[w3${Date.now()}${counter++}abcdef]`;

describe('app gaps, wave 3: driver app, pushes and owed cancellation fees', () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];
  let outbox: OutboxDispatcher;
  let sub: Redis;
  const heard: RealtimeMessage[] = [];

  beforeAll(async () => {
    fake = await startFake();
    // pushes go to the fake Expo; routing stays the straight-line estimate
    const env = fake.env();
    process.env.PUSH_PROVIDER = env.PUSH_PROVIDER;
    process.env.EXPO_PUSH_BASE_URL = env.EXPO_PUSH_BASE_URL;
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    outbox = new OutboxDispatcher(app.get(Database), [
      new NotificationsHandler(app.get(Database), app.get(Notifier), app.get(ENV)),
      new RealtimePublisher(app.get(Database), app.get(REDIS)),
    ]);
    sub = new Redis(process.env.REDIS_URL!);
    await sub.subscribe(REALTIME_CHANNEL);
    sub.on('message', (_c, raw: string) => heard.push(JSON.parse(raw) as RealtimeMessage));
    while ((await outbox.runOnce()) > 0);
  });
  afterAll(async () => {
    delete process.env.PUSH_PROVIDER;
    delete process.env.EXPO_PUSH_BASE_URL;
    await sub?.quit();
    await app?.close();
    await fake?.close();
  });

  const drain = async () => {
    while ((await outbox.runOnce()) > 0);
    await new Promise((r) => setTimeout(r, 100));
  };
  const pushed = (to: string) =>
    fake
      .hitsOf('/expo/send')
      .flatMap((h) => h.body as PushSent[])
      .filter((m) => m.to === to);
  async function device(session: Session, appName: 'rider' | 'driver') {
    const t = token();
    await api(app, session.accessToken)
      .put('/v1/devices')
      .send({ token: t, app: appName, platform: 'android', locale: 'uz' })
      .expect(204);
    return t;
  }
  const events = (type: string) =>
    heard.filter((m) => (m.event as { type: string }).type === type) as (RealtimeMessage & {
      event: Record<string, unknown>;
    })[];

  async function cardRide(rider: Session) {
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
    return ride.body as { id: string; payment: { id: string } };
  }

  describe('pushes', () => {
    beforeEach(() => quiesce(app));

    it('pushes riders a refund and an operator’s answer, drivers a paid top-up and an appeal answer', async () => {
      const rider = await signIn(app);
      const riderToken = await device(rider, 'rider');
      const ride = await cardRide(rider);
      await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/cancel`).send({}).expect(200);
      await drain();
      expect(pushed(riderToken).map((m) => m.title)).toContain('Pul qaytarilmoqda');
      await admin
        .post(`/v1/admin/payments/${ride.payment.id}/refunded`)
        .send({ reference: 'Click 5521' })
        .expect(200);
      await drain();
      expect(pushed(riderToken).find((m) => m.title === 'Pul qaytarildi')).toMatchObject({
        data: { kind: 'refunded', rideId: ride.id },
      });

      const complaint = await api(app, rider.accessToken)
        .post(`/v1/rides/${ride.id}/complaints`)
        .send({ type: 'price', text: 'Qaytarish qachon?' })
        .expect(201);
      await drain();
      // the rider's own message is no news to the rider
      expect(pushed(riderToken).filter((m) => m.data?.kind === 'complaint_answered')).toEqual([]);
      await admin
        .post(`/v1/admin/complaints/${complaint.body.id}/messages`)
        .send({ text: 'Qaytarildi' })
        .expect(201);
      await admin
        .post(`/v1/admin/complaints/${complaint.body.id}/resolve`)
        .send({ resolution: 'refund' })
        .expect(200);
      await drain();
      expect(
        pushed(riderToken)
          .filter((m) => m.data?.complaintId === complaint.body.id)
          .map((m) => m.title),
      ).toEqual(['Murojaatingizga javob', 'Murojaat ko‘rib chiqildi']);

      const driver = await createDriver(app, { online: false });
      const driverToken = await device(driver.session, 'driver');
      const topup = await driver.http
        .post('/v1/driver/topups')
        .send({ amount: 40_000 })
        .expect(201);
      await payWithPayme(app, topup.body.id, 40_000);
      await drain();
      expect(pushed(driverToken).find((m) => m.data?.kind === 'topup_paid')).toMatchObject({
        title: 'Balans to‘ldirildi',
        body: '40 000 so‘m hisobingizga tushdi.',
        data: { intentId: topup.body.id },
      });
      expect(events('topup.updated').find((m) => m.event.intentId === topup.body.id)).toMatchObject(
        { to: { userIds: [driver.id] }, event: { status: 'paid', amount: 40_000 } },
      );

      await admin
        .post(`/v1/admin/drivers/${driver.id}/block`)
        .send({ reason: 'Tekshiruv' })
        .expect(200);
      const appeal = await driver.http
        .post('/v1/driver/appeals')
        .send({ text: 'Iltimos, qayta ko‘rib chiqing' })
        .expect(201);
      await admin
        .post(`/v1/admin/drivers/appeals/${appeal.body.id}/resolve`)
        .send({ resolution: 'Ofisga keling' })
        .expect(200);
      await drain();
      expect(pushed(driverToken).find((m) => m.data?.kind === 'appeal_resolved')).toMatchObject({
        data: { appealId: appeal.body.id },
      });
    });
  });

  describe('driver app', () => {
    beforeEach(() => quiesce(app));

    it('says on the offer that a ride is ordered for later', async () => {
      const driver = await createDriver(app, { at: near(300) });
      const phone = uniquePhone();
      const at = new Date(Date.now() + 2 * 3600_000);
      const quote = await admin
        .post('/v1/admin/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, scheduledFor: at.toISOString() })
        .expect(200);
      const ride = await admin
        .post('/v1/admin/rides')
        .send({ riderPhone: phone, quoteId: quote.body.quoteId, pickup: {}, dropoff: {} })
        .expect(201);
      // 15 minutes before its time the search starts
      const due = new Date(at.getTime() - 14 * 60_000);
      await app.get(RidesService).activateScheduled(due);
      // the driver keeps sending positions meanwhile (fresh for the eligibility check)
      await driver.http.post('/v1/driver/location').send(near(310)).expect(204);
      heard.length = 0;
      await app.get(DispatchService).processRide(ride.body.id, new Date());
      const offers = await driver.http.get('/v1/driver/offers').expect(200);
      expect(offers.body[0].ride).toMatchObject({
        id: ride.body.id,
        scheduledFor: at.toISOString(),
      });
      await drain();
      expect(events('offer.new').find((m) => m.event.rideId === ride.body.id)).toMatchObject({
        event: { scheduledFor: at.toISOString() },
      });
      // a ride now says null
      await quiesce(app);
      await driver.http.post('/v1/driver/shift').send({ online: true }).expect(200);
      await driver.http.post('/v1/driver/location').send(near(300)).expect(204);
      const now = await orderRide(app, await signIn(app));
      await app.get(DispatchService).processRide(now.id, new Date());
      const again = await driver.http.get('/v1/driver/offers').expect(200);
      expect(again.body[0].ride).toMatchObject({ id: now.id, scheduledFor: null });
    });

    it('publishes the trip board’s timing rules and the documents’ file types', async () => {
      const driver = await createDriver(app, { online: false });
      const config = await driver.http.get('/v1/driver/config').expect(200);
      expect(config.body.intercity).toEqual({
        publishMinMinutesAhead: 15,
        publishMaxDaysAhead: 7,
        tripSpacingHours: 2,
        boardingOpensMinutes: 60,
        priceBandPercent: 15,
        freeCancelMinutes: 60,
        lateCancelFeePercent: 30,
        maxSeats: 3,
        maxRearSeats: 2,
        alongRouteMaxKm: 15,
      });
      const me = await driver.http.get('/v1/driver/me').expect(200);
      // legacy URL documents: the type by the extension
      expect(me.body.documents[0]).toMatchObject({ contentType: 'image/jpeg' });
      await driver.http
        .put('/v1/driver/documents/insurance')
        .send({ url: 'https://files.example.uz/polis.pdf' })
        .expect(200);
      const after = await driver.http.get('/v1/driver/me').expect(200);
      expect(
        after.body.documents.find((d: { kind: string }) => d.kind === 'insurance'),
      ).toMatchObject({ contentType: 'application/pdf' });
    });

    it('lists trips by departure and lets the driver edit one until the first booking', async () => {
      const driver = await createDriver(app, { online: false });
      const publish = (minutes: number) =>
        driver.http
          .post('/v1/driver/intercity/trips')
          .send({ from: 'guliston', to: 'toshkent', departureAt: inMinutes(minutes), seats: 3 })
          .expect(201);
      const late = await publish(600);
      const soon = await publish(180);
      const all = await driver.http.get('/v1/driver/intercity/trips').expect(200);
      expect(all.body.items.map((t: { id: string }) => t.id)).toEqual([late.body.id, soon.body.id]);
      const upcoming = await driver.http
        .get('/v1/driver/intercity/trips?scope=upcoming')
        .expect(200);
      expect(upcoming.body.items.map((t: { id: string }) => t.id)).toEqual([
        soon.body.id,
        late.body.id,
      ]);
      const fares = await driver.http
        .get('/v1/driver/intercity/fares?from=guliston&to=toshkent')
        .expect(200);
      const edited = await driver.http
        .patch(`/v1/driver/intercity/trips/${soon.body.id}`)
        .send({ departureAt: inMinutes(240), seats: 2, priceRear: fares.body.band.max })
        .expect(200);
      expect(edited.body).toMatchObject({
        seats: { total: 2 },
        price: { rear: fares.body.band.max },
      });
      await driver.http
        .patch(`/v1/driver/intercity/trips/${soon.body.id}`)
        .send({ priceRear: fares.body.band.max + 100 })
        .expect(422);
      await driver.http
        .patch(`/v1/driver/intercity/trips/${soon.body.id}`)
        .send({ departureAt: inMinutes(560) })
        .expect(409);
      await driver.http.patch(`/v1/driver/intercity/trips/${soon.body.id}`).send({}).expect(400);
      // someone else's trip is not theirs to edit
      const other = await createDriver(app, { online: false });
      await other.http
        .patch(`/v1/driver/intercity/trips/${soon.body.id}`)
        .send({ seats: 1 })
        .expect(404);
      const rider = await signIn(app);
      await api(app, rider.accessToken)
        .post(`/v1/intercity/trips/${soon.body.id}/bookings`)
        .send({ seats: 1, clientRequestId: randomUUID() })
        .expect(201);
      await driver.http
        .patch(`/v1/driver/intercity/trips/${soon.body.id}`)
        .send({ comment: 'Konditsioner bor' })
        .expect(409);
    });
  });

  describe('owed cancellation fees', () => {
    beforeEach(() => quiesce(app));

    /** A cash ride the rider cancels after the driver waited past the free minutes. */
    async function owedFee(rider: Session, driver: DriverFixture) {
      const { id } = await orderRide(app, rider, { pickup: GULISTON, dropoff: MID });
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      await db
        .updateTable('rides')
        .set({ arrived_at: new Date(Date.now() - 5 * 60_000) })
        .where('id', '=', id)
        .execute();
      const cancelled = await api(app, rider.accessToken)
        .post(`/v1/rides/${id}/cancel`)
        .send({})
        .expect(200);
      expect(cancelled.body.fare).toMatchObject({
        cancellationFee: 3000,
        cancellationFeeStatus: 'owed',
      });
      return id;
    }
    const ledger = (driverId: string, kind: string) =>
      db
        .selectFrom('driver_ledger')
        .select(['amount', 'ride_id'])
        .where('driver_id', '=', driverId)
        .where('kind', '=', kind as never)
        .execute();

    it('adds an owed fee to the next cash ride as its own line and pays it to the waiting driver', async () => {
      const rider = await signIn(app);
      const waited = await createDriver(app, { at: GULISTON });
      const cancelledId = await owedFee(rider, waited);
      const http = api(app, rider.accessToken);
      const quote = await http
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      expect(quote.body.owedFee).toMatchObject({
        amount: 3000,
        collectedWith: 'cash',
        rides: [{ rideId: cancelledId, amount: 3000 }],
      });
      // the fares themselves are untouched: the fee is a separate line
      const plain = quote.body.fares.economy.total as number;
      const ride = await http
        .post('/v1/rides')
        .send({ quoteId: quote.body.quoteId, class: 'economy', clientRequestId: randomUUID() })
        .expect(201);
      expect(ride.body.fare).toMatchObject({ quoted: plain, owedFee: 3000 });
      // attached: not shown again on another quote meanwhile
      const meanwhile = await http
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      expect(meanwhile.body.owedFee).toBeNull();

      const collector = await createDriver(app, { at: GULISTON });
      await admin
        .post(`/v1/admin/rides/${ride.body.id}/assign`)
        .send({ driverId: collector.id })
        .expect(200);
      const current = await collector.http.get('/v1/driver/rides/current').expect(200);
      expect(current.body.ride).toMatchObject({
        collectCash: plain + 3000,
        fare: { owedFee: 3000 },
      });
      for (const step of ['arrive', 'start', 'complete']) {
        await collector.http.post(`/v1/driver/rides/${ride.body.id}/${step}`).expect(200);
      }
      expect(await ledger(waited.id, 'cancel_fee')).toEqual([
        { amount: 3000, ride_id: cancelledId },
      ]);
      expect(await ledger(collector.id, 'cancel_fee_collected')).toEqual([
        { amount: -3000, ride_id: ride.body.id },
      ]);
      const old = await admin.get(`/v1/admin/rides/${cancelledId}`).expect(200);
      expect(old.body.owedFees.own).toMatchObject({
        amount: 3000,
        status: 'collected',
        collectingRideId: ride.body.id,
      });
      const next = await admin.get(`/v1/admin/rides/${ride.body.id}`).expect(200);
      expect(next.body.owedFees.collects).toEqual([
        expect.objectContaining({ rideId: cancelledId, amount: 3000, status: 'collected' }),
      ]);
      expect(
        (await http.post('/v1/rides/quote').send({ pickup: GULISTON, dropoff: MID }).expect(200))
          .body.owedFee,
      ).toBeNull();
    });

    it('keeps the fee owed when the collecting ride is cancelled or paid by card; operators waive it', async () => {
      const rider = await signIn(app);
      const waited = await createDriver(app, { at: GULISTON });
      const cancelledId = await owedFee(rider, waited);
      // a card ride does not collect it
      const card = await cardRide(rider);
      const cardView = await api(app, rider.accessToken).get(`/v1/rides/${card.id}`).expect(200);
      expect(cardView.body.fare.owedFee).toBe(0);
      await api(app, rider.accessToken).post(`/v1/rides/${card.id}/cancel`).send({}).expect(200);
      // a cash ride takes it; cancelling that ride leaves it owed again
      const { id } = await orderRide(app, rider);
      expect((await admin.get(`/v1/admin/rides/${id}`).expect(200)).body.fare.owedFee).toBe(3000);
      await api(app, rider.accessToken).post(`/v1/rides/${id}/cancel`).send({}).expect(200);
      const lookup = await admin
        .post('/v1/admin/customers/lookup')
        .send({ phone: rider.phone })
        .expect(200);
      expect(lookup.body.owedFee).toMatchObject({ amount: 3000 });

      // attached to a new ride, then waived: that ride collects nothing
      const again = await orderRide(app, rider);
      await admin
        .post(`/v1/admin/rides/${cancelledId}/fee/waive`)
        .send({ note: 'Mijoz uzr so‘radi, birinchi marta' })
        .expect(200);
      const view = await admin.get(`/v1/admin/rides/${again.id}`).expect(200);
      expect(view.body.fare.owedFee).toBe(0);
      const old = await admin.get(`/v1/admin/rides/${cancelledId}`).expect(200);
      expect(old.body.owedFees.own).toMatchObject({
        status: 'waived',
        waiveNote: expect.any(String),
      });
      await admin
        .post(`/v1/admin/rides/${cancelledId}/fee/waive`)
        .send({ note: 'Yana' })
        .expect(409);
      // a phone order collects owed fees too (the caller's account)
      await api(app, rider.accessToken).post(`/v1/rides/${again.id}/cancel`).send({}).expect(200);
      const second = await owedFee(rider, waited);
      const phoneRide = await admin
        .post('/v1/admin/rides')
        .send({
          riderPhone: rider.phone,
          pickup: { ...GULISTON, address: 'Uy' },
          dropoff: { ...MID, address: 'Bozor' },
        })
        .expect(201);
      expect(phoneRide.body.owedFees.collects).toEqual([
        expect.objectContaining({ rideId: second, amount: 3000 }),
      ]);
    });
  });
});
