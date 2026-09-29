import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { ConsoleSmsProvider } from '../src/core/sms/console.provider.js';
import { SMS_PROVIDER } from '../src/core/sms/sms.provider.js';
import { IntercityNotificationsHandler } from '../src/modules/notifications/intercity-notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import { DEFAULT_BOOKING, DEFAULT_INTERCITY } from '../src/modules/settings/settings.module.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  type Session,
  signIn,
  signInAdmin,
  uniquePhone,
} from './helpers.js';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
/** The Tashkent date of a moment, as the board’s search takes it. */
const tashkentDay = (iso: string) =>
  new Date(new Date(iso).getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

describe('intercity trip board', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    // bookings without a deposit here (test/intercity-deposits.test.ts has them)
    await admin
      .put('/v1/admin/settings/booking')
      .send({ ...DEFAULT_BOOKING, deposit_percent: 0 })
      .expect(200);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/intercity').send(DEFAULT_INTERCITY).expect(200);
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    await app.close();
  });

  /** A driver publishes Guliston -> Tashkent. */
  async function publish(
    driver: DriverFixture,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; departureAt: string; price: { rear: number; front: number } }> {
    const res = await driver.http
      .post('/v1/driver/intercity/trips')
      .send({ from: 'guliston', to: 'toshkent', departureAt: inMinutes(180), seats: 3, ...over })
      .expect(201);
    return res.body;
  }

  function book(rider: Session, tripId: string, body: Record<string, unknown> = {}) {
    return api(app, rider.accessToken)
      .post(`/v1/intercity/trips/${tripId}/bookings`)
      .send({ seats: 1, clientRequestId: randomUUID(), ...body });
  }

  it('lists the towns and prices a route by the operators’ price or the tariff', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const points = await rider.get('/v1/intercity/points').expect(200);
    const slugs = points.body.map((p: { slug: string }) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(['guliston', 'toshkent', 'yangiyer', 'shirin']));
    expect(slugs).toHaveLength(12);
    expect(points.body.find((p: { slug: string }) => p.slug === 'toshkent').meetingPoint).toMatch(
      /Olmazor/,
    );

    const tashkent = await rider.get('/v1/intercity/fares?from=guliston&to=toshkent').expect(200);
    expect(tashkent.body).toMatchObject({
      source: 'route',
      reference: { rear: 70_000, front: 80_000 },
      band: { min: 59_500, max: 80_500 },
    });
    const comfort = await rider
      .get('/v1/intercity/fares?from=guliston&to=toshkent&class=comfort')
      .expect(200);
    expect(comfort.body.reference).toEqual({ rear: 86_500, front: 98_900 });
    // between Sirdaryo towns: 30% of the whole-car tariff fare, the front seat +10%
    const yangiyer = await rider.get('/v1/intercity/fares?from=guliston&to=yangiyer').expect(200);
    const km = Math.ceil(yangiyer.body.distanceM / 1000);
    const car = Math.max(25_000, km * 1700);
    expect(yangiyer.body).toMatchObject({ source: 'tariff' });
    expect(yangiyer.body.reference.rear).toBe(Math.ceil((car * 0.3) / 100) * 100);
    await rider.get('/v1/intercity/fares?from=guliston&to=guliston').expect(400);
    await rider.get('/v1/intercity/fares?from=guliston&to=paris').expect(404);
  });

  describe('publishing', () => {
    it('checks the car, the time and the price band', async () => {
      const d = await createDriver(app, { online: false, vehicle: { seats: 3 } });
      const post = (over: Record<string, unknown>) =>
        d.http.post('/v1/driver/intercity/trips').send({
          from: 'guliston',
          to: 'toshkent',
          departureAt: inMinutes(120),
          seats: 3,
          ...over,
        });
      // the seating rule: 1 front + 2 rear at most, whatever the car
      expect((await post({ seats: 4 }).expect(400)).body.message).toMatch(/ko‘pi bilan 3/);
      expect((await post({ frontSeat: false }).expect(400)).body.message).toBe(
        'Orqa o‘rindiqqa 2 tadan ortiq yo‘lovchi olinmaydi',
      );
      await post({ departureAt: inMinutes(5) }).expect(400);
      await post({ departureAt: inMinutes(8 * 1440) }).expect(400);
      const band = await post({ priceRear: 90_000 }).expect(422);
      expect(band.body.band).toEqual({ min: 59_500, max: 80_500 });
      await post({ priceRear: 65_050 }).expect(422);

      // a driver's own price: the front seat keeps the reference proportion
      const trip = await post({ priceRear: 63_000, meetingPoint: 'Guliston, GulDU oldi' }).expect(
        201,
      );
      expect(trip.body).toMatchObject({
        status: 'scheduled',
        price: { rear: 63_000, front: 72_000 },
        seats: { total: 3, free: 3, frontOffered: true, frontFree: true },
        meetingPoint: 'Guliston, GulDU oldi',
        bookings: [],
      });
      // one car cannot be in two places: departures two hours apart at least
      await post({ departureAt: inMinutes(180) }).expect(409);
      await post({ departureAt: inMinutes(300) }).expect(201);

      // only approved drivers publish
      const rider = api(app, (await signIn(app)).accessToken);
      await rider
        .post('/v1/driver/intercity/trips')
        .send({ from: 'guliston', to: 'toshkent', departureAt: inMinutes(120), seats: 1 })
        .expect(404);
    });
  });

  describe('booking', () => {
    it('books seats, shows the contact only then, and repeats safely', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d);
      const rider = await signIn(app);
      const found = await api(app, rider.accessToken)
        // the departure’s Tashkent date: late in the evening it is tomorrow
        .get(
          `/v1/intercity/trips?from=guliston&to=toshkent&seats=2&date=${tashkentDay(trip.departureAt)}`,
        )
        .expect(200);
      const listed = found.body.find((t: { id: string }) => t.id === trip.id);
      expect(listed).toMatchObject({
        seats: { free: 3 },
        price: { rear: 70_000, front: 80_000 },
        alongTheWay: false,
      });
      // browsing: the first name, the car, no phone and no plate
      expect(listed.driver.name).toBe('Aziz');
      expect(JSON.stringify(listed)).not.toMatch(/\+998|phone|plate/);

      const requestId = randomUUID();
      const booked = await book(rider, trip.id, {
        seats: 2,
        front: true,
        pickupNote: 'Bozor darvozasi oldida',
        clientRequestId: requestId,
      }).expect(201);
      expect(booked.body).toMatchObject({
        status: 'booked',
        seats: 2,
        front: true,
        price: 150_000,
        canCancel: true,
        contact: { driverName: 'Aziz Karimov' },
      });
      expect(booked.body.contact.driverPhone).toMatch(/^\+998/);
      expect(booked.body.contact.plate).toBeTruthy();
      // the app retried: the same booking, not two
      const again = await book(rider, trip.id, {
        seats: 2,
        front: true,
        clientRequestId: requestId,
      }).expect(200);
      expect(again.body.id).toBe(booked.body.id);
      // more seats go in the same booking; the front seat is sold once
      await book(rider, trip.id).expect(409);
      const other = await signIn(app);
      expect((await book(other, trip.id, { front: true }).expect(409)).body.message).toMatch(/Old/);
      await book(other, trip.id, { seats: 2 }).expect(409);
      await book(other, trip.id, { seats: 1 }).expect(201);
      // full
      expect((await book(await signIn(app), trip.id).expect(409)).body.message).toMatch(/Bo‘sh/);
      // the driver cannot book their own trip
      await api(app, d.session.accessToken)
        .post(`/v1/intercity/trips/${trip.id}/bookings`)
        .send({ seats: 1, clientRequestId: randomUUID() })
        .expect(409);

      const driverView = await d.http.get(`/v1/driver/intercity/trips/${trip.id}`).expect(200);
      expect(driverView.body.seats).toMatchObject({ free: 0, frontFree: false });
      expect(driverView.body.bookings[0]).toMatchObject({
        riderPhone: rider.phone,
        pickupNote: 'Bozor darvozasi oldida',
        seats: 2,
      });
      const mine = await api(app, rider.accessToken).get('/v1/intercity/bookings').expect(200);
      expect(mine.body.items[0].id).toBe(booked.body.id);
    });

    it('never oversells a trip or its front seat, however many book at once', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d);
      const riders = await Promise.all(Array.from({ length: 7 }, () => signIn(app)));
      const results = await Promise.all(riders.map((r) => book(r, trip.id)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 409, 409, 409, 409]);
      const row = await db
        .selectFrom('intercity_trips')
        .select(['seats_booked'])
        .where('id', '=', trip.id)
        .executeTakeFirstOrThrow();
      expect(row.seats_booked).toBe(3);

      const d2 = await createDriver(app, { online: false });
      const trip2 = await publish(d2);
      const racers = await Promise.all(Array.from({ length: 3 }, () => signIn(app)));
      const front = await Promise.all(racers.map((r) => book(r, trip2.id, { front: true })));
      expect(front.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });

    it('cancels free until an hour before departure, then records the late fee', async () => {
      const d = await createDriver(app, { online: false });
      const early = await publish(d, { departureAt: inMinutes(180) });
      const rider = await signIn(app);
      const b = await book(rider, early.id, { seats: 2 }).expect(201);
      const cancelled = await api(app, rider.accessToken)
        .post(`/v1/intercity/bookings/${b.body.id}/cancel`)
        .send({ reason: 'Rejalar o‘zgardi' })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'cancelled',
        cancellationFee: 0,
        contact: null,
        canCancel: false,
      });
      expect((await d.http.get(`/v1/driver/intercity/trips/${early.id}`)).body.seats.free).toBe(3);
      // the seats can be booked again, by the same rider too
      await book(rider, early.id).expect(201);

      const d2 = await createDriver(app, { online: false });
      const soon = await publish(d2, { departureAt: inMinutes(30) });
      const late = await book(rider, soon.id).expect(201);
      const fee = await api(app, rider.accessToken)
        .post(`/v1/intercity/bookings/${late.body.id}/cancel`)
        .send({})
        .expect(200);
      // 30% of 70 000
      expect(fee.body.cancellationFee).toBe(21_000);
      // someone else's booking is not theirs to cancel
      await api(app, (await signIn(app)).accessToken)
        .post(`/v1/intercity/bookings/${b.body.id}/cancel`)
        .send({})
        .expect(404);
    });
  });

  it('runs a trip: boarding, a no-show, departure, arrival with the charges', async () => {
    const d = await createDriver(app, { online: false });
    const trip = await publish(d, { departureAt: inMinutes(100) });
    const aboard = await signIn(app);
    const absent = await signIn(app);
    const a = await book(aboard, trip.id, { seats: 2, front: true }).expect(201);
    const x = await book(absent, trip.id).expect(201);

    // boarding opens an hour before departure
    await d.http.post(`/v1/driver/intercity/trips/${trip.id}/boarding`).expect(409);
    await db
      .updateTable('intercity_trips')
      .set({ departure_at: new Date(Date.now() + 20 * 60_000) })
      .where('id', '=', trip.id)
      .execute();
    await d.http.post(`/v1/driver/intercity/trips/${trip.id}/boarding`).expect(200);
    // nobody aboard yet: the car cannot leave empty
    await d.http.post(`/v1/driver/intercity/trips/${trip.id}/depart`).expect(409);
    await d.http
      .post(`/v1/driver/intercity/trips/${trip.id}/bookings/${a.body.id}/board`)
      .expect(200);
    // a boarded rider can no longer cancel
    await api(app, aboard.accessToken)
      .post(`/v1/intercity/bookings/${a.body.id}/cancel`)
      .send({})
      .expect(409);
    const departed = await d.http.post(`/v1/driver/intercity/trips/${trip.id}/depart`).expect(200);
    expect(departed.body.status).toBe('departed');
    expect(
      departed.body.bookings.map((b: { id: string; status: string }) => [b.id, b.status]),
    ).toEqual([
      [a.body.id, 'boarded'],
      [x.body.id, 'no_show'],
    ]);
    const counted = await db
      .selectFrom('users')
      .select('no_show_count')
      .where('phone', '=', absent.phone)
      .executeTakeFirstOrThrow();
    expect(counted.no_show_count).toBe(1);

    const arrived = await d.http.post(`/v1/driver/intercity/trips/${trip.id}/arrive`).expect(200);
    expect(arrived.body.status).toBe('arrived');
    // launch promo: no commission; the 1% tax of 150 000 is withheld
    expect(arrived.body.bookings[0]).toMatchObject({
      status: 'completed',
      tax: 1500,
      commission: 0,
    });
    const balance = await d.http.get('/v1/driver/balance').expect(200);
    expect(balance.body.entries[0]).toMatchObject({ kind: 'tax', amount: -1500 });
    const earnings = await d.http.get('/v1/driver/earnings').expect(200);
    expect(earnings.body).toMatchObject({ intercityBookings: 1, fares: 150_000, cash: 150_000 });
    const tax = await db
      .selectFrom('tax_withholdings')
      .select(['base_amount', 'amount'])
      .where('booking_id', '=', a.body.id)
      .executeTakeFirstOrThrow();
    expect(tax).toEqual({ base_amount: 150_000, amount: 1500 });
    await d.http.post(`/v1/driver/intercity/trips/${trip.id}/arrive`).expect(409);
  });

  it('lets drivers and operators call a trip off, telling every passenger', async () => {
    const d = await createDriver(app, { online: false });
    const trip = await publish(d);
    const rider = await signIn(app);
    const b = await book(rider, trip.id).expect(201);
    await d.http
      .post(`/v1/driver/intercity/trips/${trip.id}/cancel`)
      .send({ reason: 'Mashina buzildi' })
      .expect(200);
    const seen = await api(app, rider.accessToken).get(`/v1/intercity/bookings/${b.body.id}`);
    expect(seen.body).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'driver',
      cancelReason: 'Mashina buzildi',
      trip: { status: 'cancelled' },
    });
    const driver = await db
      .selectFrom('drivers')
      .select('rides_cancelled')
      .where('user_id', '=', d.id)
      .executeTakeFirstOrThrow();
    expect(driver.rides_cancelled).toBe(1);

    const d2 = await createDriver(app, { online: false });
    const trip2 = await publish(d2);
    await admin
      .post(`/v1/admin/intercity/trips/${trip2.id}/cancel`)
      .send({ reason: 'Yo‘l yopiq' })
      .expect(200);
    await book(rider, trip2.id).expect(409);
  });

  it('lets operators book for a caller, who gets the driver and the car by SMS', async () => {
    const d = await createDriver(app, { online: false });
    const trip = await publish(d);
    const phone = uniquePhone();
    const booked = await admin
      .post(`/v1/admin/intercity/trips/${trip.id}/bookings`)
      .send({ riderPhone: phone, riderName: 'Karim aka', seats: 1, pickupNote: 'Vokzal' })
      .expect(201);
    expect(booked.body).toMatchObject({ channel: 'phone', riderPhone: phone, price: 70_000 });
    const full = await admin.get(`/v1/admin/intercity/trips/${trip.id}`).expect(200);
    expect(full.body.bookings[0]).toMatchObject({ riderName: 'Karim aka', channel: 'phone' });

    // the worker's notification handler: SMS to the caller, a push to the driver
    const handler = new IntercityNotificationsHandler(
      app.get(Database),
      app.get(Notifier),
      loadEnv(),
    );
    const events = await db
      .selectFrom('outbox')
      .select(['id', 'topic', 'payload', 'created_at'])
      .where('topic', '=', 'intercity.booking_changed')
      .execute();
    const event = events.find(
      (e) => (e.payload as { bookingId: string }).bookingId === booked.body.id,
    )!;
    await handler.handle({
      id: event.id,
      topic: event.topic,
      payload: event.payload,
      createdAt: event.created_at,
    });
    const sms = app.get<ConsoleSmsProvider>(SMS_PROVIDER).lastTo(phone);
    expect(sms?.text).toMatch(
      /^SFF Taxi bron #\d+: Guliston → Toshkent, .*70 000 so‘m.*Haydovchi \+998/,
    );

    // the admin list and a route price change for new trips
    const listed = await admin
      .get('/v1/admin/intercity/trips?status=scheduled&from=guliston')
      .expect(200);
    expect(listed.body.some((t: { id: string }) => t.id === trip.id)).toBe(true);
    const repriced = await admin
      .put('/v1/admin/intercity/fares')
      .send({ from: 'guliston', to: 'shirin', rear: 30_000, front: 34_000 })
      .expect(200);
    expect(repriced.body).toMatchObject({ source: 'route', reference: { rear: 30_000 } });
    expect(
      (await admin.get('/v1/admin/intercity/fares').expect(200)).body.map(
        (f: { from: string; to: string }) => `${f.from}-${f.to}`,
      ),
    ).toEqual(
      expect.arrayContaining(['guliston-shirin', 'guliston-toshkent', 'toshkent-guliston']),
    );
    await admin
      .put('/v1/admin/intercity/fares')
      .send({ from: 'guliston', to: 'shirin', rear: null, front: null })
      .expect(200);
    await api(app, (await signIn(app)).accessToken)
      .get('/v1/admin/intercity/trips')
      .expect(403);
  });
});
