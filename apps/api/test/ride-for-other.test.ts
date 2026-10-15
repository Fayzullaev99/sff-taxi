import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import type { ConsoleSmsProvider } from '../src/core/sms/console.provider.js';
import { SMS_PROVIDER } from '../src/core/sms/sms.provider.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { NotificationsHandler } from '../src/modules/notifications/notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import { type Fake, startFake } from './fakes.js';
import {
  api,
  createDriver,
  createTestApp,
  GULISTON,
  MID,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
  uniquePhone,
} from './helpers.js';

describe('ordering for someone else', { timeout: 120_000 }, () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];
  let outbox: OutboxDispatcher;

  beforeAll(async () => {
    fake = await startFake();
    Object.assign(process.env, fake.env());
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    const handler = new NotificationsHandler(app.get(Database), app.get(Notifier), app.get(ENV));
    outbox = new OutboxDispatcher(app.get(Database), [handler]);
    while ((await outbox.runOnce()) > 0);
  });
  afterAll(async () => {
    await app?.close();
    await fake?.close();
  });
  beforeEach(() => quiesce(app));

  const drain = async () => {
    while ((await outbox.runOnce()) > 0);
  };
  const smsTo = (phone: string) =>
    app
      .get<ConsoleSmsProvider>(SMS_PROVIDER)
      .sent.filter((m) => m.to === phone)
      .map((m) => m.text);

  async function quote(rider: Session, body: Record<string, unknown> = {}) {
    return (
      await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, options: [], ...body })
        .expect(200)
    ).body;
  }

  function order(rider: Session, quoteId: string, body: Record<string, unknown> = {}) {
    return api(app, rider.accessToken)
      .post('/v1/rides')
      .send({
        quoteId,
        class: 'economy',
        pickup: { address: 'Mustaqillik 12', landmark: null },
        dropoff: { address: 'Vokzal', landmark: null },
        comment: null,
        clientRequestId: randomUUID(),
        ...body,
      });
  }

  it('lets the driver see and call the passenger, texts them the car and the live link', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const mama = uniquePhone();
    const q = await quote(rider);
    const ride = (
      await order(rider, q.quoteId, { passenger: { name: 'Onam', phone: mama.slice(4) } }).expect(
        201,
      )
    ).body;
    expect(ride.passenger).toEqual({ name: 'Onam', phone: mama });

    // the offer says it is for someone else (no phone yet)
    await app.get(DispatchService).tick();
    const [offer] = (await driver.http.get('/v1/driver/offers').expect(200)).body;
    expect(offer.ride.passengerName).toBe('Onam');
    expect(JSON.stringify(offer)).not.toContain(mama);
    await driver.http.post(`/v1/driver/offers/${offer.id}/accept`).expect(200);
    const current = (await driver.http.get('/v1/driver/rides/current').expect(200)).body.ride;
    expect(current.passenger).toEqual({ name: 'Onam', phone: mama });
    expect(current.rider.phone).toBe(rider.phone);

    await drain();
    const [assigned] = smsTo(mama);
    expect(assigned).toMatch(
      new RegExp(`^SFF Taxi #${ride.number}: sizga .+\\. Haydovchi: \\+998`),
    );
    const token = /\/t\/([\w-]+)$/.exec(assigned!)?.[1];
    expect(token).toBeTruthy();
    // the link is the ride's share link: the orderer's share gives the same one
    const link = await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/share`).expect(200);
    expect(link.body.token).toBe(token);
    await api(app).get(`/v1/share/${token}`).expect(200);

    await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
    await drain();
    expect(smsTo(mama)[1]).toMatch(/haydovchi yetib keldi/);

    // the orderer keeps tracking and pays: the ride is theirs
    const seen = (await api(app, rider.accessToken).get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(seen.passenger.name).toBe('Onam');
    await driver.http.post(`/v1/driver/rides/${ride.id}/start`).send({}).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
    const after = (await driver.http.get(`/v1/driver/rides/${ride.id}`).expect(200)).body;
    expect(after.passenger).toEqual({ name: 'Onam', phone: null });

    // and finds the passenger again on the next order
    const recent = (await api(app, rider.accessToken).get('/v1/rides/passengers').expect(200)).body;
    expect(recent).toEqual([{ name: 'Onam', phone: mama, lastRideAt: expect.any(String) }]);
    // operators see it and find the ride by the passenger's phone
    const detail = (await admin.get(`/v1/admin/rides/${ride.id}`).expect(200)).body;
    expect(detail.passenger).toEqual({ name: 'Onam', phone: mama });
    const found = (await admin.get(`/v1/admin/rides?status=all&q=${mama.slice(-7)}`).expect(200))
      .body;
    expect(found.map((r: { id: string }) => r.id)).toContain(ride.id);
  });

  it('refuses a parcel or the orderer’s own phone, and texts the passenger a cancellation', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const q = await quote(rider);
    const own = await order(rider, q.quoteId, {
      passenger: { name: 'Men', phone: rider.phone },
    }).expect(400);
    expect(own.body.message).toContain('o‘zingiz uchun');
    const parcel = await quote(rider, { service: 'delivery', parcel: { weightKg: 1 } });
    const sent = await order(rider, parcel.quoteId, {
      recipient: { name: 'Ali', phone: uniquePhone() },
      passenger: { name: 'Ali', phone: uniquePhone() },
    }).expect(400);
    expect(sent.body.message).toBe('Boshqa odam uchun buyurtma faqat taksi uchun');

    const friend = uniquePhone();
    const ride = (
      await order(rider, q.quoteId, { passenger: { name: 'Do‘stim', phone: friend } }).expect(201)
    ).body;
    // cancelled before a car was found: nothing to tell the passenger
    await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/cancel`).send({}).expect(200);
    await drain();
    expect(smsTo(friend)).toEqual([]);

    const q2 = await quote(rider);
    const ride2 = (
      await order(rider, q2.quoteId, { passenger: { name: 'Do‘stim', phone: friend } }).expect(201)
    ).body;
    await admin
      .post(`/v1/admin/rides/${ride2.id}/assign`)
      .send({ driverId: driver.id })
      .expect(200);
    await api(app, rider.accessToken).post(`/v1/rides/${ride2.id}/cancel`).send({}).expect(200);
    await drain();
    const texts = smsTo(friend);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe(`SFF Taxi #${ride2.number}: buyurtma bekor qilindi.`);
    // the table refuses a name without a phone whatever the code does
    await expect(
      db
        .updateTable('rides')
        .set({ passenger_name: 'X', passenger_phone: null })
        .where('id', '=', ride2.id)
        .execute(),
    ).rejects.toThrow(/rides_passenger_check/);
  });

  it('takes a passenger in a phone order and texts them, not only the caller', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const caller = uniquePhone();
    const grandson = uniquePhone();
    const ride = (
      await admin
        .post('/v1/admin/rides')
        .send({
          riderPhone: caller,
          riderName: 'Buvijon',
          pickup: { ...GULISTON, address: 'Bozor', landmark: null },
          dropoff: { ...MID, address: 'Vokzal', landmark: null },
          passenger: { name: 'Nevaram', phone: grandson },
          options: [],
        })
        .expect(201)
    ).body;
    expect(ride.passenger).toEqual({ name: 'Nevaram', phone: grandson });
    await admin.post(`/v1/admin/rides/${ride.id}/assign`).send({ driverId: driver.id }).expect(200);
    await drain();
    expect(smsTo(grandson)[0]).toContain('sizga');
    expect(smsTo(caller)[0]).toContain('Haydovchi');
  });
});
