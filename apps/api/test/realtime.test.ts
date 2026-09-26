import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { REDIS } from '../src/core/redis/redis.token.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { RealtimePublisher } from '../src/modules/realtime/realtime.publisher.js';
import {
  api,
  createDriver,
  createTestApp,
  GULISTON,
  orderRide,
  quiesce,
  signIn,
  signInAdmin,
} from './helpers.js';

type Event = { type: string; rideId?: string; status?: string; offerId?: string; reason?: string };

/** An open event stream collecting what it receives. */
async function openStream(base: string, token: string) {
  const ticket = await fetch(`${base}/v1/stream/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json() as Promise<{ ticket: string }>);
  const controller = new AbortController();
  const res = await fetch(`${base}/v1/stream?ticket=${ticket.ticket}`, {
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const events: Event[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)) as Event);
        }
      }
    } catch {
      // aborted
    }
  })();
  await waitFor(() => events.some((e) => e.type === 'ready'));
  return { events, ticket: ticket.ticket, close: () => controller.abort() };
}

async function waitFor(check: () => boolean, ms = 3000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting for a realtime event');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('realtime', () => {
  let app: INestApplication;
  let base: string;
  let outbox: OutboxDispatcher;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const db = app.get(Database);
    outbox = new OutboxDispatcher(db, [new RealtimePublisher(db, app.get<Redis>(REDIS))]);
    admin = api(app, (await signInAdmin(app)).accessToken);
    // events left by earlier setup are not what these tests look at
    while ((await outbox.runOnce()) > 0);
    await quiesce(app);
  });
  afterAll(() => app.close());

  const drain = async () => {
    while ((await outbox.runOnce()) > 0);
  };

  it('follows a ride: rider, driver and operators hear what concerns them, nobody else', async () => {
    const rider = await signIn(app);
    const driver = await createDriver(app);
    const stranger = await signIn(app);
    const adminSession = await signInAdmin(app);
    const [riderStream, driverStream, strangerStream, opsStream] = await Promise.all([
      openStream(base, rider.accessToken),
      openStream(base, driver.session.accessToken),
      openStream(base, stranger.accessToken),
      openStream(base, adminSession.accessToken),
    ]);
    try {
      const { id } = await orderRide(app, rider);
      await drain();
      await waitFor(() =>
        riderStream.events.some((e) => e.rideId === id && e.status === 'searching'),
      );
      await waitFor(() => opsStream.events.some((e) => e.rideId === id));

      // the dispatcher offers the ride: only the driver hears of the offer
      await app.get(DispatchService).tick();
      await drain();
      await waitFor(() =>
        driverStream.events.some((e) => e.type === 'offer.new' && e.rideId === id),
      );
      const offerId = driverStream.events.find((e) => e.type === 'offer.new')!.offerId!;
      expect(riderStream.events.some((e) => e.type === 'offer.new')).toBe(false);

      await driver.http.post(`/v1/driver/offers/${offerId}/accept`).expect(200);
      await drain();
      await waitFor(() => riderStream.events.some((e) => e.status === 'driver_assigned'));
      await waitFor(() => driverStream.events.some((e) => e.status === 'driver_assigned'));

      // the car's position goes straight to the rider, without the outbox
      await driver.http
        .post('/v1/driver/location')
        .send({ lat: GULISTON.lat + 0.0005, lng: GULISTON.lng, heading: 45 })
        .expect(204);
      await waitFor(() => riderStream.events.some((e) => e.type === 'driver.location'));
      expect(riderStream.events.find((e) => e.type === 'driver.location')).toMatchObject({
        rideId: id,
        lat: GULISTON.lat + 0.0005,
        heading: 45,
      });

      // SOS: operators are alerted
      await api(app, rider.accessToken).post(`/v1/rides/${id}/sos`).send({}).expect(201);
      await drain();
      await waitFor(() => opsStream.events.some((e) => e.type === 'sos' && e.rideId === id));
      await waitFor(() =>
        opsStream.events.some((e) => e.type === 'ride.attention' && e.reason === 'sos'),
      );
      expect(riderStream.events.some((e) => e.type === 'sos')).toBe(false);

      await new Promise((r) => setTimeout(r, 100));
      expect(strangerStream.events.map((e) => e.type)).toEqual(['ready']);
    } finally {
      for (const s of [riderStream, driverStream, strangerStream, opsStream]) s.close();
    }
  });

  it('tells a driver about their account and a ride taken away', async () => {
    const driver = await createDriver(app, { online: false });
    const stream = await openStream(base, driver.session.accessToken);
    try {
      await admin
        .post(`/v1/admin/drivers/${driver.id}/block`)
        .send({ reason: 'Tekshiruv' })
        .expect(200);
      await drain();
      await waitFor(() =>
        stream.events.some((e) => e.type === 'driver.updated' && e.status === 'blocked'),
      );
      await admin
        .post(`/v1/admin/drivers/${driver.id}/unblock`)
        .send({ reason: 'Tekshirildi' })
        .expect(200);
      await driver.http.post('/v1/driver/shift').send({ online: true }).expect(200);
      await driver.http.post('/v1/driver/location').send(GULISTON).expect(204);

      const { id } = await orderRide(app, await signIn(app));
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      await drain();
      await waitFor(() => stream.events.some((e) => e.rideId === id));
      const other = await createDriver(app);
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: other.id }).expect(200);
      await drain();
      await waitFor(() => stream.events.filter((e) => e.rideId === id).length >= 2);
    } finally {
      stream.close();
    }
  });

  it('accepts a ticket once, and only a fresh one', async () => {
    const rider = await signIn(app);
    const stream = await openStream(base, rider.accessToken);
    stream.close();
    const reused = await fetch(`${base}/v1/stream?ticket=${stream.ticket}`);
    expect(reused.status).toBe(401);
    expect((await fetch(`${base}/v1/stream?ticket=nope`)).status).toBe(401);
    expect((await fetch(`${base}/v1/stream/ticket`, { method: 'POST' })).status).toBe(401);
  });
});
