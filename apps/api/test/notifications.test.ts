import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import type { OutboxEvent } from '../src/core/outbox/handler.js';
import type { ConsoleSmsProvider } from '../src/core/sms/console.provider.js';
import { SMS_PROVIDER } from '../src/core/sms/sms.provider.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { NotificationsHandler } from '../src/modules/notifications/notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import { type Fake, startFake } from './fakes.js';
import {
  ADMIN_PHONE,
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  FAR,
  GULISTON,
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
  ttl?: number;
  data?: Record<string, unknown>;
}

let counter = 0;
const token = (tag = 'x') => `ExponentPushToken[${tag}${Date.now()}${counter++}abcdef]`;
const CAR = '20 [A-Z] \\d{3} [A-Z]{2}';

describe('notifications', () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let handler: NotificationsHandler;
  let outbox: OutboxDispatcher;
  let db: Database['kysely'];

  beforeAll(async () => {
    fake = await startFake();
    Object.assign(process.env, fake.env());
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    handler = new NotificationsHandler(app.get(Database), app.get(Notifier), app.get(ENV));
    outbox = new OutboxDispatcher(app.get(Database), [handler]);
    while ((await outbox.runOnce()) > 0);
    await quiesce(app);
  });
  afterAll(async () => {
    await app?.close();
    await fake?.close();
  });

  const drain = async () => {
    while ((await outbox.runOnce()) > 0);
  };
  const pushed = (to: string) =>
    fake
      .hitsOf('/expo/send')
      .flatMap((h) => h.body as PushSent[])
      .filter((m) => m.to === to);
  const smsTo = (phone: string) =>
    app
      .get<ConsoleSmsProvider>(SMS_PROVIDER)
      .sent.filter((m) => m.to === phone)
      .map((m) => m.text);

  async function device(session: Session, appName: 'rider' | 'driver', t = token(), locale = 'uz') {
    await api(app, session.accessToken)
      .put('/v1/devices')
      .send({ token: t, app: appName, platform: 'android', locale })
      .expect(204);
    return t;
  }

  it('registers push tokens per app and moves a token to whoever signs in', async () => {
    const rider = await signIn(app);
    await api(app, rider.accessToken)
      .put('/v1/devices')
      .send({ token: 'not-a-token', app: 'rider', platform: 'android' })
      .expect(400);
    const t = await device(rider, 'rider');
    const other = await signIn(app);
    await device(other, 'rider', t);
    const rows = await db
      .selectFrom('push_devices')
      .select('user_id')
      .where('token', '=', t)
      .execute();
    expect(rows).toHaveLength(1);
    // the first account cannot remove the token it no longer holds
    await api(app, rider.accessToken)
      .delete(`/v1/devices/${encodeURIComponent(t)}`)
      .expect(204);
    expect(
      await db.selectFrom('push_devices').select('id').where('token', '=', t).execute(),
    ).toHaveLength(1);
    await api(app, other.accessToken)
      .delete(`/v1/devices/${encodeURIComponent(t)}`)
      .expect(204);
    expect(
      await db.selectFrom('push_devices').select('id').where('token', '=', t).execute(),
    ).toEqual([]);
  });

  it('pushes the driver an urgent offer and the rider every step of the ride', async () => {
    const rider = await signIn(app);
    const driver: DriverFixture = await createDriver(app);
    const riderToken = await device(rider, 'rider');
    const driverToken = await device(driver.session, 'driver', token(), 'ru');
    const { id } = await orderRide(app, rider);

    await app.get(DispatchService).tick();
    await drain();
    // the approval (the device was registered before the worker got to it), then the offer
    const offer = pushed(driverToken).find((m) => m.data?.kind === 'offer');
    expect(offer).toMatchObject({ title: 'Новый заказ: 7 000 so‘m' });
    expect(offer!.ttl).toBeGreaterThan(5);
    expect(offer!.ttl).toBeLessThanOrEqual(15);
    expect(offer!.data).toMatchObject({ kind: 'offer', rideId: id });

    const offers = await driver.http.get('/v1/driver/offers').expect(200);
    await driver.http.post(`/v1/driver/offers/${offers.body[0].id}/accept`).expect(200);
    await drain();
    const assigned = pushed(riderToken).find((m) => m.title === 'Haydovchi topildi');
    expect(assigned!.body).toMatch(
      new RegExp(`^oq Chevrolet Cobalt, ${CAR}, ~\\d+ daqiqada yetib keladi$`),
    );

    await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/start`).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
    await drain();
    expect(pushed(riderToken).map((m) => m.title)).toEqual([
      'Haydovchi topildi',
      'Haydovchi yetib keldi',
      'Safar yakunlandi',
    ]);
    expect(pushed(riderToken).at(-1)!.body).toBe('To‘lov: 7 000 so‘m. Safarni baholang.');
    const log = await db
      .selectFrom('notifications')
      .select(['kind', 'status'])
      .where('ride_id', '=', id)
      .where('status', '=', 'sent')
      .execute();
    expect(log.map((n) => n.kind).sort()).toEqual([
      'completed',
      'driver_arrived',
      'driver_assigned',
      'offer',
    ]);
  });

  it('texts a caller who ordered by phone: car, plate and the driver’s number', async () => {
    const phone = uniquePhone();
    const driver = await createDriver(app);
    const ride = await admin
      .post('/v1/admin/rides')
      .send({ riderPhone: phone, pickup: { ...GULISTON, address: 'Bozor' }, dropoff: FAR })
      .expect(201);
    const n = ride.body.number as number;
    await admin
      .post(`/v1/admin/rides/${ride.body.id}/assign`)
      .send({ driverId: driver.id })
      .expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.body.id}/arrive`).expect(200);
    await admin
      .post(`/v1/admin/rides/${ride.body.id}/cancel`)
      .send({ reason: 'Mijoz rad etdi' })
      .expect(200);
    await drain();
    const texts = smsTo(phone);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(
      new RegExp(`^SFF Taxi #${n}: oq Chevrolet Cobalt, ${CAR}\\. Haydovchi: \\+998\\d{9}$`),
    );
    expect(texts[1]).toMatch(
      new RegExp(`^SFF Taxi #${n}: haydovchi yetib keldi, oq Chevrolet Cobalt, ${CAR}\\.$`),
    );
    expect(texts[2]).toBe(`SFF Taxi #${n}: buyurtma bekor qilindi (Mijoz rad etdi).`);
  });

  it('tells a driver the rider cancelled, and about decisions on the account', async () => {
    const rider = await signIn(app);
    const driver = await createDriver(app);
    const driverToken = await device(driver.session, 'driver');
    const { id } = await orderRide(app, rider);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    await api(app, rider.accessToken).post(`/v1/rides/${id}/cancel`).send({}).expect(200);
    await admin
      .post(`/v1/admin/drivers/${driver.id}/block`)
      .send({ reason: 'Hujjat tekshiruvi' })
      .expect(200);
    await admin
      .post(`/v1/admin/drivers/${driver.id}/unblock`)
      .send({ reason: 'Tekshirildi' })
      .expect(200);
    await drain();
    expect(pushed(driverToken).map((m) => [m.title, m.body])).toEqual([
      ['Ariza tasdiqlandi', 'Liniyaga chiqishingiz mumkin.'],
      ['Yo‘lovchi bekor qildi', expect.stringMatching(/^#\d+ buyurtma bekor qilindi\.$/)],
      ['Hisob bloklandi', 'Hujjat tekshiruvi'],
      ['Hisob blokdan chiqarildi', 'Yana liniyaga chiqishingiz mumkin.'],
    ]);
  });

  it('texts operators on SOS', async () => {
    const rider = await signIn(app);
    const driver = await createDriver(app);
    const { id } = await orderRide(app, rider);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    const before = smsTo(ADMIN_PHONE).length;
    await api(app, rider.accessToken).post(`/v1/rides/${id}/sos`).send({}).expect(201);
    await drain();
    const texts = smsTo(ADMIN_PHONE).slice(before);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/^SFF Taxi SOS! Safar #\d+, yo‘lovchi \+998\d{9}\. Panelni oching\.$/);
    expect(texts[0]).toContain(rider.phone);
  });

  it('sends once per event, retries when the push service is down, forgets dead tokens', async () => {
    const rider = await signIn(app);
    const live = await device(rider, 'rider');
    const dead = await device(rider, 'rider', token('Dead'));
    const driver = await createDriver(app);
    const { id } = await orderRide(app, rider);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    const row = await db
      .selectFrom('outbox')
      .select(['id', 'topic', 'payload', 'created_at'])
      .where('topic', '=', 'ride.status_changed')
      .where((eb) => eb(eb.ref('payload', '->>').key('rideId'), '=', id))
      .executeTakeFirstOrThrow();
    const event: OutboxEvent = {
      id: row.id,
      topic: row.topic,
      payload: row.payload,
      createdAt: row.created_at,
    };

    fake.mode.expo = 'fail';
    await expect(handler.handle(event)).rejects.toThrow(/expo/);
    const sent = () =>
      db
        .selectFrom('notifications')
        .select('status')
        .where('dedupe_key', 'like', `event:${event.id}:%`)
        .execute();
    // nothing recorded: the outbox retries the event
    expect(await sent()).toEqual([]);
    fake.mode.expo = 'ok';
    await handler.handle(event);
    await handler.handle(event);
    // one failed attempt and one delivery; the repeat sent nothing
    expect(pushed(live)).toHaveLength(2);
    expect(await sent()).toEqual([{ status: 'sent' }]);
    expect(
      await db.selectFrom('push_devices').select('id').where('token', '=', dead).execute(),
    ).toEqual([]);
  });
});
