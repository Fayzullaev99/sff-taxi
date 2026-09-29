import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { IntercityService } from '../src/modules/intercity/intercity.service.js';
import { IntentsService } from '../src/modules/payments/intents.service.js';
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
import { payWithClick, payWithPayme } from './payments-helpers.js';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
/** The Tashkent date of a moment, as the board's search takes it. */
const tashkentDay = (iso: string) =>
  new Date(new Date(iso).getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

interface BookingView {
  id: string;
  status: string;
  price: number;
  depositAmount: number;
  payCash: number;
  cancellationFee: number;
  payment: {
    id: string;
    amount: number;
    status: string;
    checkout: { payme?: string; click?: string } | null;
  } | null;
}

describe('trip board: seating rule, deposits, seats along the way', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    await admin.put('/v1/admin/settings/intercity').send(DEFAULT_INTERCITY).expect(200);
    await app.close();
  });

  /** A driver publishes Guliston -> Tashkent (70 000 rear / 80 000 front). */
  async function publish(driver: DriverFixture, over: Record<string, unknown> = {}) {
    const res = await driver.http
      .post('/v1/driver/intercity/trips')
      .send({ from: 'guliston', to: 'toshkent', departureAt: inMinutes(180), seats: 3, ...over })
      .expect(201);
    return res.body as { id: string; departureAt: string };
  }

  function book(rider: Session, tripId: string, body: Record<string, unknown> = {}) {
    return api(app, rider.accessToken)
      .post(`/v1/intercity/trips/${tripId}/bookings`)
      .send({ seats: 1, clientRequestId: randomUUID(), ...body });
  }

  async function bookAndPay(rider: Session, tripId: string, body: Record<string, unknown> = {}) {
    const res = await book(rider, tripId, body).expect(201);
    const b = res.body as BookingView;
    await payWithPayme(app, b.payment!.id, b.payment!.amount);
    return b;
  }

  const intent = (bookingId: string) =>
    db
      .selectFrom('payment_intents')
      .selectAll()
      .where('booking_id', '=', bookingId)
      .executeTakeFirstOrThrow();

  const depositEntries = (bookingId: string) =>
    db
      .selectFrom('driver_ledger')
      .select(['driver_id', 'kind', 'amount'])
      .where('booking_id', '=', bookingId)
      .where('kind', '=', 'deposit')
      .execute();

  const seatsBooked = async (tripId: string) =>
    (
      await db
        .selectFrom('intercity_trips')
        .select('seats_booked')
        .where('id', '=', tripId)
        .executeTakeFirstOrThrow()
    ).seats_booked;

  it('shows the rules: seats, deposits, the corridor along the way', async () => {
    const d = await createDriver(app, { online: false });
    const config = await d.http.get('/v1/driver/config').expect(200);
    expect(config.body.intercity).toMatchObject({
      maxSeats: 3,
      maxRearSeats: 2,
      alongRouteMaxKm: DEFAULT_INTERCITY.along_route_max_km,
    });
    const publicConfig = await api(app).get('/v1/config').expect(200);
    expect(publicConfig.body.deposits).toEqual({ percent: 20, min: 5000, paymentMinutes: 15 });
    expect(publicConfig.body.intercity).toMatchObject({ maxSeats: 3, maxRearSeats: 2 });

    expect((await admin.get('/v1/admin/settings/booking').expect(200)).body).toEqual(
      DEFAULT_BOOKING,
    );
    await admin
      .put('/v1/admin/settings/booking')
      .send({ ...DEFAULT_BOOKING, deposit_percent: 101 })
      .expect(400);
    const changed = await admin
      .put('/v1/admin/settings/booking')
      .send({ ...DEFAULT_BOOKING, deposit_min: 10_000 })
      .expect(200);
    expect(changed.body.deposit_min).toBe(10_000);
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    await api(app, (await signIn(app)).accessToken)
      .get('/v1/admin/settings/booking')
      .expect(403);
  });

  it('keeps the seating rule: 1 front and at most 2 rear seats, 3 per booking', async () => {
    const small = await createDriver(app, { online: false, vehicle: { seats: 2 } });
    const post = (over: Record<string, unknown>) =>
      small.http.post('/v1/driver/intercity/trips').send({
        from: 'guliston',
        to: 'toshkent',
        departureAt: inMinutes(120),
        ...over,
      });
    // the car's own seats still count
    expect((await post({ seats: 3 }).expect(400)).body.message).toMatch(/2 ta/);
    const two = await post({ seats: 2, frontSeat: false }).expect(201);

    // an edit keeps the rule too: 3 without the front seat means 3 in the back
    const d = await createDriver(app, { online: false });
    const trip = await publish(d);
    const refused = await d.http
      .patch(`/v1/driver/intercity/trips/${trip.id}`)
      .send({ frontSeat: false })
      .expect(400);
    expect(refused.body.message).toBe('Orqa o‘rindiqqa 2 tadan ortiq yo‘lovchi olinmaydi');
    await d.http
      .patch(`/v1/driver/intercity/trips/${trip.id}`)
      .send({ seats: 2, frontSeat: false })
      .expect(200);
    expect(
      (await small.http.get(`/v1/driver/intercity/trips/${two.body.id}`).expect(200)).body.seats,
    ).toMatchObject({ total: 2, frontOffered: false });

    // a booking takes 3 seats at most
    const rider = await signIn(app);
    expect((await book(rider, trip.id, { seats: 4 }).expect(400)).body.message).toMatch(/3/);

    // the database refuses a fourth passenger whatever the application does
    await expect(
      db.updateTable('intercity_trips').set({ seats_total: 4 }).where('id', '=', trip.id).execute(),
    ).rejects.toThrow(/intercity_trips_rear_seats_check/);
  });

  describe('deposits', () => {
    it('holds the seats until the deposit is paid, then books them (Payme and Click)', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d);
      const rider = await signIn(app);

      // the trip view says what booking will ask
      const view = await api(app, rider.accessToken)
        .get(`/v1/intercity/trips/${trip.id}`)
        .expect(200);
      expect(view.body.depositRules).toEqual({ percent: 20, min: 5000, paymentMinutes: 15 });

      const requestId = randomUUID();
      const res = await book(rider, trip.id, { seats: 2, front: true, clientRequestId: requestId });
      expect(res.status).toBe(201);
      const b = res.body as BookingView & { contact: unknown; canCancel: boolean };
      // 20% of 150 000; the rest is cash to the driver
      expect(b).toMatchObject({
        status: 'awaiting_payment',
        price: 150_000,
        depositAmount: 30_000,
        payCash: 120_000,
        contact: null,
        canCancel: true,
        payment: { amount: 30_000, status: 'pending' },
      });
      expect(b.payment!.checkout!.payme).toMatch(/^https:\/\/checkout\.test\.paycom\.uz\//);
      expect(b.payment!.checkout!.click).toMatch(/^https:\/\/my\.click\.uz\//);
      // a retry is the same booking; the seats are held while the rider pays
      const again = await book(rider, trip.id, {
        seats: 2,
        front: true,
        clientRequestId: requestId,
      });
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(b.id);
      expect(await seatsBooked(trip.id)).toBe(2);
      await book(rider, trip.id).expect(409);
      const driverView = await d.http.get(`/v1/driver/intercity/trips/${trip.id}`).expect(200);
      expect(driverView.body.bookings[0]).toMatchObject({
        status: 'awaiting_payment',
        depositAmount: 30_000,
        payCash: 120_000,
      });

      await payWithPayme(app, b.payment!.id, 30_000);
      const paid = await api(app, rider.accessToken)
        .get(`/v1/intercity/bookings/${b.id}`)
        .expect(200);
      expect(paid.body).toMatchObject({
        status: 'booked',
        payment: { status: 'paid', checkout: null },
        contact: { driverName: 'Aziz Karimov' },
      });
      // the driver hears of a new booking, the rider that it is confirmed
      const events = await db
        .selectFrom('outbox')
        .select('payload')
        .where('topic', '=', 'intercity.booking_changed')
        .execute();
      expect(
        events.some(
          (e) =>
            (e.payload as { bookingId: string; by: string }).bookingId === b.id &&
            (e.payload as { by: string }).by === 'payment',
        ),
      ).toBe(true);

      // Click takes the same path
      const other = await signIn(app);
      const second = (await book(other, trip.id).expect(201)).body as BookingView;
      expect(second.depositAmount).toBe(14_000);
      await payWithClick(app, second.payment!.id, 14_000);
      expect((await intent(second.id)).status).toBe('paid');
      expect(
        (await api(app, other.accessToken).get(`/v1/intercity/bookings/${second.id}`)).body.status,
      ).toBe('booked');
    });

    it('drops a booking whose deposit is not paid in time, releasing its seats', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d);
      const rider = await signIn(app);
      const b = (await book(rider, trip.id, { seats: 3, front: true }).expect(201))
        .body as BookingView;
      expect(await seatsBooked(trip.id)).toBe(3);
      expect((await book(await signIn(app), trip.id).expect(409)).body.message).toMatch(/Bo‘sh/);

      const intercity = app.get(IntercityService);
      // not yet (other files' unpaid bookings may be due: only this one is looked at)
      await intercity.expireUnpaidBookings(new Date(Date.now() + 5 * 60_000));
      expect((await intent(b.id)).status).toBe('pending');
      expect(
        await intercity.expireUnpaidBookings(new Date(Date.now() + 16 * 60_000)),
      ).toBeGreaterThanOrEqual(1);
      const seen = await api(app, rider.accessToken)
        .get(`/v1/intercity/bookings/${b.id}`)
        .expect(200);
      expect(seen.body).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'system',
        payment: { status: 'expired' },
        canCancel: false,
      });
      expect(await seatsBooked(trip.id)).toBe(0);
      expect(await intercity.expireUnpaidBookings(new Date(Date.now() + 16 * 60_000))).toBe(0);
      // the seats are free again
      await book(await signIn(app), trip.id, { seats: 3, front: true }).expect(201);
    });

    it('refunds the deposit when the rider cancels in time; later it is the driver’s', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d, { departureAt: inMinutes(180) });
      const rider = await signIn(app);

      // an unpaid booking is just dropped
      const unpaid = (await book(rider, trip.id).expect(201)).body as BookingView;
      const dropped = await api(app, rider.accessToken)
        .post(`/v1/intercity/bookings/${unpaid.id}/cancel`)
        .send({})
        .expect(200);
      expect(dropped.body).toMatchObject({ status: 'cancelled', cancellationFee: 0 });
      expect((await intent(unpaid.id)).status).toBe('cancelled');

      // in the free window: the deposit goes back to the card
      const early = await bookAndPay(rider, trip.id);
      const cancelled = await api(app, rider.accessToken)
        .post(`/v1/intercity/bookings/${early.id}/cancel`)
        .send({ reason: 'Rejalar o‘zgardi' })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'cancelled',
        cancellationFee: 0,
        payment: { status: 'refund_pending' },
      });
      expect(await depositEntries(early.id)).toEqual([]);
      const queue = await admin.get('/v1/admin/payments/refunds').expect(200);
      const queued = queue.body.find((r: { bookingId: string }) => r.bookingId === early.id);
      expect(queued).toMatchObject({ purpose: 'booking', amount: 14_000, riderPhone: rider.phone });
      const refunded = await admin
        .post(`/v1/admin/payments/${queued.id}/refunded`)
        .send({ reference: 'Click qaytarish #42' })
        .expect(200);
      expect(refunded.body.status).toBe('refunded');

      // late: the deposit stays paid and is credited to the driver instead of a recorded fee
      const late = await bookAndPay(rider, trip.id);
      expect(
        (await api(app, rider.accessToken).get(`/v1/intercity/bookings/${late.id}`)).body
          .cancelFeeNow,
      ).toBe(0);
      await db
        .updateTable('intercity_trips')
        .set({ departure_at: new Date(Date.now() + 30 * 60_000) })
        .where('id', '=', trip.id)
        .execute();
      expect(
        (await api(app, rider.accessToken).get(`/v1/intercity/bookings/${late.id}`)).body
          .cancelFeeNow,
      ).toBe(14_000);
      const lateCancel = await api(app, rider.accessToken)
        .post(`/v1/intercity/bookings/${late.id}/cancel`)
        .send({})
        .expect(200);
      expect(lateCancel.body).toMatchObject({
        status: 'cancelled',
        cancellationFee: 14_000,
        payment: { status: 'paid' },
      });
      expect(await depositEntries(late.id)).toEqual([
        { driver_id: d.id, kind: 'deposit', amount: 14_000 },
      ]);
      expect(await seatsBooked(trip.id)).toBe(0);
    });

    it('refunds every deposit when the driver or an operator calls the trip off', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d);
      const paid = await bookAndPay(await signIn(app), trip.id);
      const waiting = (await book(await signIn(app), trip.id).expect(201)).body as BookingView;
      await d.http
        .post(`/v1/driver/intercity/trips/${trip.id}/cancel`)
        .send({ reason: 'Mashina buzildi' })
        .expect(200);
      expect((await intent(paid.id)).status).toBe('refund_pending');
      expect((await intent(waiting.id)).status).toBe('cancelled');
      expect(await depositEntries(paid.id)).toEqual([]);

      // an operator cancelling one booking refunds it too
      const d2 = await createDriver(app, { online: false });
      const trip2 = await publish(d2);
      const one = await bookAndPay(await signIn(app), trip2.id);
      await admin
        .post(`/v1/admin/intercity/bookings/${one.id}/cancel`)
        .send({ reason: 'Mijoz qo‘ng‘iroq qildi' })
        .expect(200);
      expect((await intent(one.id)).status).toBe('refund_pending');
      expect(await seatsBooked(trip2.id)).toBe(0);
    });

    it('credits deposits to the driver on arrival and for no-shows; tax on the full price', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d, { departureAt: inMinutes(100) });
      const aboard = await bookAndPay(await signIn(app), trip.id, { front: true });
      const absent = await bookAndPay(await signIn(app), trip.id);
      // the operator's caller pays nothing in advance
      const phone = await admin
        .post(`/v1/admin/intercity/trips/${trip.id}/bookings`)
        .send({ riderPhone: uniquePhone(), seats: 1 })
        .expect(201);
      expect(phone.body).toMatchObject({ status: 'booked', depositAmount: 0, payCash: 70_000 });
      expect(await seatsBooked(trip.id)).toBe(3);
      await db
        .updateTable('intercity_trips')
        .set({ departure_at: new Date(Date.now() + 20 * 60_000) })
        .where('id', '=', trip.id)
        .execute();
      const base = `/v1/driver/intercity/trips/${trip.id}`;
      await d.http.post(`${base}/boarding`).expect(200);
      await d.http.post(`${base}/bookings/${aboard.id}/board`).expect(200);
      await d.http.post(`${base}/bookings/${phone.body.id}/board`).expect(200);
      await d.http.post(`${base}/depart`).expect(200);
      expect(await depositEntries(absent.id)).toEqual([
        { driver_id: d.id, kind: 'deposit', amount: 14_000 },
      ]);
      const arrived = await d.http.post(`${base}/arrive`).expect(200);
      expect(arrived.body.bookings.find((b: { id: string }) => b.id === aboard.id)).toMatchObject({
        status: 'completed',
        tax: 800,
        depositAmount: 16_000,
        payCash: 64_000,
      });
      expect(await depositEntries(aboard.id)).toEqual([
        { driver_id: d.id, kind: 'deposit', amount: 16_000 },
      ]);
      // once only, whatever retries
      await d.http.post(`${base}/arrive`).expect(409);
      expect(await depositEntries(aboard.id)).toHaveLength(1);
      // earnings: fares in full, cash without the deposits paid by card
      const earnings = await d.http.get('/v1/driver/earnings').expect(200);
      expect(earnings.body).toMatchObject({
        intercityBookings: 2,
        fares: 80_000 + 70_000,
        cash: 64_000 + 70_000,
      });
      // the deposits are on the balance: 16 000 + 14 000, less the 1% tax of 150 000
      const balance = await d.http.get('/v1/driver/balance').expect(200);
      expect(balance.body.balance).toBe(16_000 + 14_000 - 800 - 700);
    });

    it('books without a deposit when deposits are off, and refuses when cards are not on', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d);
      const intents = app.get(IntentsService);
      const spy = vi.spyOn(intents, 'cardAvailable').mockReturnValue(false);
      try {
        const refused = await book(await signIn(app), trip.id).expect(400);
        expect(refused.body.message).toBe('Oldindan bron uchun karta orqali to‘lov hali ulanmagan');
        await admin
          .put('/v1/admin/settings/booking')
          .send({ ...DEFAULT_BOOKING, deposit_percent: 0 })
          .expect(200);
        const free = await book(await signIn(app), trip.id).expect(201);
        expect(free.body).toMatchObject({
          status: 'booked',
          depositAmount: 0,
          payCash: 70_000,
          payment: null,
        });
      } finally {
        spy.mockRestore();
        await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
      }
    });
  });

  describe('seats along the way', () => {
    it('finds trips passing the rider’s towns and prices the rider’s part', async () => {
      const d = await createDriver(app, { online: false });
      const trip = await publish(d, { departureAt: inMinutes(240) });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const day = tashkentDay(trip.departureAt);

      // Sirdaryo -> Toshkent: the Guliston -> Toshkent car goes through Sirdaryo
      const found = await http
        .get(`/v1/intercity/trips?from=sirdaryo&to=toshkent&date=${day}`)
        .expect(200);
      const along = found.body.find((t: { id: string }) => t.id === trip.id);
      expect(along).toMatchObject({
        alongTheWay: true,
        pickup: { slug: 'sirdaryo', nameUz: 'Sirdaryo' },
        dropoff: { slug: 'toshkent' },
        from: { slug: 'guliston' },
        // 70 000 / 80 000 x ~0.73 of the way, rounded up to 1 000
        price: { rear: 51_000, front: 59_000 },
        fullPrice: { rear: 70_000, front: 80_000 },
      });
      expect(along.share).toBeCloseTo(0.73, 2);
      // only the exact route when asked so; never the other way round
      const exact = await http
        .get(`/v1/intercity/trips?from=sirdaryo&to=toshkent&date=${day}&along=false`)
        .expect(200);
      expect(exact.body.some((t: { id: string }) => t.id === trip.id)).toBe(false);
      const back = await http
        .get(`/v1/intercity/trips?from=toshkent&to=sirdaryo&date=${day}`)
        .expect(200);
      expect(back.body.some((t: { id: string }) => t.id === trip.id)).toBe(false);
      // the trip's own route is not "along the way"
      const direct = await http
        .get(`/v1/intercity/trips?from=guliston&to=toshkent&date=${day}`)
        .expect(200);
      expect(direct.body.find((t: { id: string }) => t.id === trip.id).alongTheWay).toBe(false);

      // booking it: the rider's towns are kept, the driver sees where to pick them up
      const booked = await book(rider, trip.id, {
        seats: 1,
        from: 'sirdaryo',
        to: 'toshkent',
      }).expect(201);
      expect(booked.body).toMatchObject({
        status: 'awaiting_payment',
        price: 51_000,
        // 20% of 51 000 = 10 200 -> 11 000
        depositAmount: 11_000,
        payCash: 40_000,
        alongTheWay: true,
        pickup: { slug: 'sirdaryo', nameUz: 'Sirdaryo' },
        dropoff: { slug: 'toshkent' },
      });
      await payWithPayme(app, booked.body.payment.id, 11_000);
      const driverView = await d.http.get(`/v1/driver/intercity/trips/${trip.id}`).expect(200);
      expect(driverView.body.bookings[0]).toMatchObject({
        status: 'booked',
        alongTheWay: true,
        pickup: { nameUz: 'Sirdaryo' },
        dropoff: { nameUz: 'Toshkent' },
        payCash: 40_000,
      });

      // towns the trip does not pass
      const off = await book(await signIn(app), trip.id, { from: 'shirin', to: 'toshkent' });
      expect(off.status).toBe(409);
      expect(off.body.message).toMatch(/Shirin → Toshkent yo‘lidan o‘tmaydi/);
      // a narrower corridor: Sirdaryo is no longer on the way
      await admin
        .put('/v1/admin/settings/intercity')
        .send({ ...DEFAULT_INTERCITY, along_route_max_km: 4 })
        .expect(200);
      const narrow = await http
        .get(`/v1/intercity/trips?from=sirdaryo&to=toshkent&date=${day}`)
        .expect(200);
      expect(narrow.body.some((t: { id: string }) => t.id === trip.id)).toBe(false);
      await admin.put('/v1/admin/settings/intercity').send(DEFAULT_INTERCITY).expect(200);
    });
  });
});
