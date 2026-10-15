import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { REDIS } from '../src/core/redis/redis.token.js';
import { EngagementNotificationsHandler } from '../src/modules/notifications/engagement-notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import {
  REALTIME_CHANNEL,
  type RealtimeMessage,
  RealtimePublisher,
} from '../src/modules/realtime/realtime.publisher.js';
import { type Fake, startFake } from './fakes.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  orderRide,
  type Session,
  signIn,
  signInAdmin,
} from './helpers.js';

interface PushSent {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

describe('ride chat', () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let driver: DriverFixture;
  let outbox: OutboxDispatcher;
  let sub: Redis;
  const heard: RealtimeMessage[] = [];

  beforeAll(async () => {
    fake = await startFake();
    const env = fake.env();
    process.env.PUSH_PROVIDER = env.PUSH_PROVIDER;
    process.env.EXPO_PUSH_BASE_URL = env.EXPO_PUSH_BASE_URL;
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    driver = await createDriver(app, { online: false });
    outbox = new OutboxDispatcher(app.get(Database), [
      new EngagementNotificationsHandler(app.get(Database), app.get(Notifier)),
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
  let tokenSeq = 0;
  async function device(session: Session, appName: 'rider' | 'driver') {
    const token = `ExponentPushToken[chat${Date.now()}${tokenSeq++}abcdef]`;
    await api(app, session.accessToken)
      .put('/v1/devices')
      .send({ token, app: appName, platform: 'android', locale: 'uz' })
      .expect(204);
    return token;
  }
  const pushed = (to: string) =>
    fake
      .hitsOf('/expo/send')
      .flatMap((h) => h.body as PushSent[])
      .filter((m) => m.to === to);
  const events = (type: string) =>
    heard.filter((m) => (m.event as { type: string }).type === type) as (RealtimeMessage & {
      event: Record<string, unknown>;
    })[];

  async function assignedRide(rider = undefined as Session | undefined) {
    const r = rider ?? (await signIn(app));
    // a free driver for every ride (the last one may still be on theirs)
    driver = await createDriver(app, { online: false });
    const { id } = await orderRide(app, r);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    return { rider: r, id, riderHttp: api(app, r.accessToken) };
  }

  it('lets the rider and the driver talk during the ride, live and by push', async () => {
    const { rider, id, riderHttp } = await assignedRide();
    const riderToken = await device(rider, 'rider');
    const driverToken = await device(driver.session, 'driver');

    const open = await riderHttp.get(`/v1/rides/${id}/messages`).expect(200);
    expect(open.body).toMatchObject({
      writable: true,
      unread: 0,
      messages: [],
      counterpart: { role: 'driver', name: 'Aziz Karimov' },
    });
    expect(open.body.quickReplies).toContainEqual({ key: 'coming_out', text: 'Chiqyapman' });

    // a quick reply from the driver, a typed answer from the rider
    const quick = await driver.http
      .post(`/v1/driver/rides/${id}/messages`)
      .send({ quickReply: 'arrived' })
      .expect(201);
    expect(quick.body).toMatchObject({ text: 'Yetib keldim', mine: true, authorRole: 'driver' });
    const clientMessageId = randomUUID();
    const typed = await riderHttp
      .post(`/v1/rides/${id}/messages`)
      .send({ text: '  Podyezd 3,​ kod 45\u0007 ', clientMessageId })
      .expect(201);
    expect(typed.body.text).toBe('Podyezd 3, kod 45');
    // a retry after a lost answer is the same message
    const again = await riderHttp
      .post(`/v1/rides/${id}/messages`)
      .send({ text: 'Podyezd 3, kod 45', clientMessageId })
      .expect(201);
    expect(again.body.id).toBe(typed.body.id);

    const riderView = await riderHttp.get(`/v1/rides/${id}/messages`).expect(200);
    expect(riderView.body.unread).toBe(1);
    expect(
      riderView.body.messages.map((m: { mine: boolean; text: string }) => [m.mine, m.text]),
    ).toEqual([
      [false, 'Yetib keldim'],
      [true, 'Podyezd 3, kod 45'],
    ]);
    const driverView = await driver.http.get(`/v1/driver/rides/${id}/messages`).expect(200);
    expect(driverView.body.unread).toBe(1);
    expect(driverView.body.counterpart.role).toBe('rider');

    await drain();
    // realtime: the message to the other side (and the author's other devices), with its text
    const live = events('chat.message').filter((m) => m.event.rideId === id);
    expect(live.map((m) => m.event.text)).toEqual(['Yetib keldim', 'Podyezd 3, kod 45']);
    expect(live[0]!.to.userIds).toContain(driver.id);
    expect(live[0]!.to.admins).toBeFalsy();
    // pushes: the rider hears the driver, the driver hears the rider
    expect(pushed(riderToken).find((p) => p.data?.kind === 'chat')).toMatchObject({
      title: 'Haydovchi: Aziz',
      body: 'Yetib keldim',
      data: { kind: 'chat', rideId: id },
    });
    expect(pushed(driverToken).find((p) => p.data?.kind === 'chat')).toMatchObject({
      title: 'Yo‘lovchidan xabar',
      body: 'Podyezd 3, kod 45',
    });

    // read receipts: the rider reads, the driver's message shows read
    const read = await riderHttp.post(`/v1/rides/${id}/messages/read`).expect(200);
    expect(read.body.read).toBe(1);
    expect((await riderHttp.get(`/v1/rides/${id}/messages`).expect(200)).body.unread).toBe(0);
    const seen = await driver.http.get(`/v1/driver/rides/${id}/messages`).expect(200);
    expect(seen.body.messages[0].readAt).not.toBeNull();
    await drain();
    expect(events('chat.read').find((m) => m.event.rideId === id)).toMatchObject({
      to: { userIds: [driver.id] },
      event: { readerRole: 'rider' },
    });

    // operators read the whole chat in the ride detail
    const panel = await admin.get(`/v1/admin/rides/${id}/messages`).expect(200);
    expect(panel.body.messages).toHaveLength(2);
    expect(panel.body.messages[1]).toMatchObject({
      authorRole: 'rider',
      authorPhone: rider.phone,
      text: 'Podyezd 3, kod 45',
    });
  });

  it('closes 30 minutes after the ride and is never open to strangers', async () => {
    const { id, riderHttp } = await assignedRide();
    const stranger = api(app, (await signIn(app)).accessToken);
    await stranger.get(`/v1/rides/${id}/messages`).expect(404);
    await stranger.post(`/v1/rides/${id}/messages`).send({ text: 'salom' }).expect(404);
    // empty, too long, both or neither, an unknown quick reply
    await riderHttp.post(`/v1/rides/${id}/messages`).send({ text: '​ ' }).expect(400);
    await riderHttp
      .post(`/v1/rides/${id}/messages`)
      .send({ text: 'x'.repeat(501) })
      .expect(400);
    await riderHttp
      .post(`/v1/rides/${id}/messages`)
      .send({ text: 'a', quickReply: 'coming_out' })
      .expect(400);
    await riderHttp.post(`/v1/rides/${id}/messages`).send({ quickReply: 'arrived' }).expect(400);

    await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/start`).send({}).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
    // right after the ride: still open (a forgotten bag)
    await riderHttp.post(`/v1/rides/${id}/messages`).send({ text: 'Sumkam qoldi' }).expect(201);
    await app
      .get(Database)
      .kysely.updateTable('rides')
      .set({ completed_at: new Date(Date.now() - 31 * 60_000) })
      .where('id', '=', id)
      .execute();
    const closed = await riderHttp.get(`/v1/rides/${id}/messages`).expect(200);
    expect(closed.body).toMatchObject({ writable: false, closesAt: expect.any(String) });
    expect(closed.body.messages).toHaveLength(1);
    const refused = await riderHttp
      .post(`/v1/rides/${id}/messages`)
      .send({ text: 'Yana' })
      .expect(403);
    expect(refused.body.message).toMatch(/Suhbat yopiq/);
  });

  it('keeps a replaced driver out of the next driver’s conversation', async () => {
    const { id, riderHttp } = await assignedRide();
    await driver.http
      .post(`/v1/driver/rides/${id}/messages`)
      .send({ quickReply: 'traffic' })
      .expect(201);
    const other = await createDriver(app, { online: false });
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: other.id }).expect(200);
    await driver.http.get(`/v1/driver/rides/${id}/messages`).expect(404);
    const fresh = await other.http.get(`/v1/driver/rides/${id}/messages`).expect(200);
    expect(fresh.body.messages).toEqual([]);
    // the rider keeps the whole history
    expect(
      (await riderHttp.get(`/v1/rides/${id}/messages`).expect(200)).body.messages,
    ).toHaveLength(1);
    // a searching ride (driver dropped it) has nobody to write to
    await other.http
      .post(`/v1/driver/rides/${id}/cancel`)
      .send({ reasonCode: 'car_problem' })
      .expect(204);
    await riderHttp.post(`/v1/rides/${id}/messages`).send({ text: 'Hey' }).expect(403);
  });

  it('limits how fast one person can write', async () => {
    const { riderHttp, id } = await assignedRide();
    let limited = 0;
    for (let i = 0; i < 22; i++) {
      const res = await riderHttp.post(`/v1/rides/${id}/messages`).send({ text: `#${i}` });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
