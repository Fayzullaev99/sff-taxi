import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { BlockedDriverHandler } from '../src/modules/drivers/blocked-driver.handler.js';
import { IntercityService } from '../src/modules/intercity/intercity.service.js';
import { RidesService } from '../src/modules/rides/rides.service.js';
import { DEFAULT_BOOKING } from '../src/modules/settings/settings.module.js';
import {
  api,
  createDriver,
  createTestApp,
  orderRide,
  signIn,
  signInAdmin,
  startPin,
} from './helpers.js';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const tashkentDay = (iso: string) =>
  new Date(new Date(iso).getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

/** Review 2026-10: location and phone privacy, blocked drivers, batched trip views. */
describe('review 2026-10', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];
  let blocked: BlockedDriverHandler;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    blocked = new BlockedDriverHandler(app.get(RidesService), app.get(IntercityService));
    await admin
      .put('/v1/admin/settings/booking')
      .send({ ...DEFAULT_BOOKING, deposit_percent: 0 })
      .expect(200);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    await app.close();
  });

  /** What the worker does with the "blocked" event (twice: delivery is at-least-once). */
  async function runBlockedHandler(driverId: string) {
    const event = await db
      .selectFrom('outbox')
      .select(['id', 'payload', 'created_at'])
      .where('topic', '=', 'driver.status_changed')
      .where(sql`payload->>'driverId'`, '=', driverId)
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    const e = {
      id: event.id,
      topic: 'driver.status_changed',
      payload: event.payload as Record<string, unknown>,
      createdAt: event.created_at,
    };
    await blocked.handle(e);
    // at-least-once delivery: a repeat changes nothing
    await blocked.handle(e);
  }

  it('shows the driver’s phone and live position only while the ride is on, and the rider’s too', async () => {
    const riderSession = await signIn(app);
    const rider = api(app, riderSession.accessToken);
    const driver = await createDriver(app);
    const { id } = await orderRide(app, riderSession);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);

    const during = await rider.get(`/v1/rides/${id}`).expect(200);
    expect(during.body.driver.phone).toMatch(/^\+998/);
    expect(during.body.driver.location).not.toBeNull();
    const driverDuring = await driver.http.get(`/v1/driver/rides/${id}`).expect(200);
    expect(driverDuring.body.rider.phone).toMatch(/^\+998/);

    await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
    await driver.http
      .post(`/v1/driver/rides/${id}/start`)
      .send({ pin: await startPin(app, id) })
      .expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);

    const after = await rider.get(`/v1/rides/${id}`).expect(200);
    expect(after.body.status).toBe('completed');
    expect(after.body.driver).toMatchObject({ name: expect.any(String), phone: null });
    expect(after.body.driver.location).toBeNull();
    const driverAfter = await driver.http.get(`/v1/driver/rides/${id}`).expect(200);
    expect(driverAfter.body.rider).toMatchObject({ phone: null });
    // operators keep everything
    const operator = await admin.get(`/v1/admin/rides/${id}`).expect(200);
    expect(operator.body.driver.phone).toMatch(/^\+998/);
  });

  it('gives a blocked driver’s ride that has not started to another car', async () => {
    const riderSession = await signIn(app);
    const driver = await createDriver(app);
    const { id } = await orderRide(app, riderSession);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);

    await admin
      .post(`/v1/admin/drivers/${driver.id}/block`)
      .send({ reason: 'Shikoyat' })
      .expect(200);
    // before the worker got to it: the blocked driver cannot pick the rider up
    const refused = await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(403);
    expect(refused.body.message).toMatch(/faol emas/);
    await runBlockedHandler(driver.id);

    const ride = await api(app, riderSession.accessToken).get(`/v1/rides/${id}`).expect(200);
    expect(ride.body.status).toBe('searching');
    expect(ride.body.driver).toBeNull();
    const released = await db
      .selectFrom('ride_events')
      .select('data')
      .where('ride_id', '=', id)
      .where('type', '=', 'driver_released')
      .execute();
    expect(released).toHaveLength(1);
    await api(app, riderSession.accessToken)
      .post(`/v1/rides/${id}/cancel`)
      .send({ reason: null })
      .expect(200);
  });

  it('takes a blocked driver’s departures off the board, refuses seats and calls them off', async () => {
    const driver = await createDriver(app, { online: false });
    const departureAt = inMinutes(240);
    const trip = await driver.http
      .post('/v1/driver/intercity/trips')
      .send({ from: 'guliston', to: 'toshkent', departureAt, seats: 3 })
      .expect(201);
    const riderSession = await signIn(app);
    const rider = api(app, riderSession.accessToken);
    const booking = await rider
      .post(`/v1/intercity/trips/${trip.body.id}/bookings`)
      .send({ seats: 1, clientRequestId: randomUUID() })
      .expect(201);
    expect(booking.body.contact.driverPhone).toMatch(/^\+998/);
    const search = () =>
      rider
        .get('/v1/intercity/trips')
        .query({ from: 'guliston', to: 'toshkent', date: tashkentDay(departureAt), seats: 1 })
        .expect(200);
    expect((await search()).body.map((t: { id: string }) => t.id)).toContain(trip.body.id);
    // the driver's passenger list has the phone while the seat is held
    const list = await driver.http.get(`/v1/driver/intercity/trips/${trip.body.id}`).expect(200);
    expect(list.body.bookings[0].riderPhone).toMatch(/^\+998/);

    await admin
      .post(`/v1/admin/drivers/${driver.id}/block`)
      .send({ reason: 'Shikoyat' })
      .expect(200);
    expect((await search()).body.map((t: { id: string }) => t.id)).not.toContain(trip.body.id);
    const other = api(app, (await signIn(app)).accessToken);
    await other
      .post(`/v1/intercity/trips/${trip.body.id}/bookings`)
      .send({ seats: 1, clientRequestId: randomUUID() })
      .expect(409);
    await driver.http.post(`/v1/driver/intercity/trips/${trip.body.id}/boarding`).expect(403);

    await runBlockedHandler(driver.id);
    const cancelled = await admin.get(`/v1/admin/intercity/trips/${trip.body.id}`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.cancelReason).toBe('Haydovchi bloklandi');
    const mine = await rider.get(`/v1/intercity/bookings/${booking.body.id}`).expect(200);
    expect(mine.body.status).toBe('cancelled');
    expect(mine.body.contact).toBeNull();
    // the cancelled seat: the driver keeps the name, not the number; operators keep both
    const after = await driver.http.get(`/v1/driver/intercity/trips/${trip.body.id}`).expect(200);
    expect(after.body.bookings[0].riderPhone).toBeNull();
    expect(cancelled.body.bookings[0].riderPhone).toMatch(/^\+998/);
  });

  it('lists a page of trips for operators in a few queries, each with its own bookings', async () => {
    const a = await createDriver(app, { online: false });
    const b = await createDriver(app, { online: false });
    const day = inMinutes(60 * 30);
    const ids: string[] = [];
    for (const [d, off] of [
      [a, 0],
      [b, 30],
      [a, 120],
    ] as const) {
      const t = await d.http
        .post('/v1/driver/intercity/trips')
        .send({
          from: 'guliston',
          to: 'toshkent',
          departureAt: new Date(new Date(day).getTime() + off * 60_000).toISOString(),
          seats: 3,
        })
        .expect(201);
      ids.push(t.body.id);
    }
    const rider = api(app, (await signIn(app)).accessToken);
    await rider
      .post(`/v1/intercity/trips/${ids[1]}/bookings`)
      .send({ seats: 2, clientRequestId: randomUUID() })
      .expect(201);
    const board = await admin
      .get('/v1/admin/intercity/trips')
      .query({ date: tashkentDay(day), from: 'guliston', to: 'toshkent' })
      .expect(200);
    const mine = board.body.filter((t: { id: string }) => ids.includes(t.id));
    expect(mine).toHaveLength(3);
    const byId = new Map(mine.map((t: { id: string }) => [t.id, t]));
    expect((byId.get(ids[1]) as { bookings: unknown[] }).bookings).toHaveLength(1);
    expect((byId.get(ids[0]) as { bookings: unknown[] }).bookings).toHaveLength(0);
    expect((byId.get(ids[0]) as { driver: { id: string } }).driver.id).toBe(a.id);
    expect((byId.get(ids[1]) as { driver: { id: string } }).driver.id).toBe(b.id);
    for (const id of ids) {
      await admin
        .post(`/v1/admin/intercity/trips/${id}/cancel`)
        .send({ reason: 'Test tugadi' })
        .expect(200);
    }
  });
});
