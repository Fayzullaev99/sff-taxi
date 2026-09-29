import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BusinessCalendar } from '../src/core/clock/business-calendar.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import {
  api,
  createDriver,
  createTestApp,
  GULISTON,
  MID,
  orderRide,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
} from './helpers.js';
import { payWithPayme } from './payments-helpers.js';
import { DEFAULT_BOOKING } from '../src/modules/settings/settings.module.js';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('scheduled rides', () => {
  let app: INestApplication;
  let dispatch: DispatchService;

  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    dispatch = app.get(DispatchService);
    admin = api(app, (await signInAdmin(app)).accessToken);
    // these rides for later are booked without a deposit (its own tests are at the end)
    await admin
      .put('/v1/admin/settings/booking')
      .send({ ...DEFAULT_BOOKING, deposit_percent: 0 })
      .expect(200);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    await quiesce(app);
    app.get(BusinessCalendar).pin(new Date(process.env.TEST_CALENDAR_AT!));
    await app.close();
  });
  beforeEach(() => quiesce(app));

  async function schedule(rider: Session, at: Date, paymentMethod = 'cash') {
    const http = api(app, rider.accessToken);
    const quote = await http
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, scheduledFor: at.toISOString() })
      .expect(200);
    return http.post('/v1/rides').send({
      quoteId: quote.body.quoteId,
      class: 'economy',
      paymentMethod,
      clientRequestId: randomUUID(),
    });
  }

  it('prices a ride for later at its own time and holds it until 15 minutes before', async () => {
    const rider = await signIn(app);
    const http = api(app, rider.accessToken);
    // 21:30 now, the ride at 23:30: the night add-on of the ride's own time applies
    const calendar = app.get(BusinessCalendar);
    calendar.pin(new Date('2026-10-14T21:30:00+05:00'));
    const at = inMinutes(120);
    const quote = await http
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, scheduledFor: at.toISOString() })
      .expect(200);
    expect(quote.body).toMatchObject({
      scheduledFor: at.toISOString(),
      availability: null,
      fares: { economy: { total: 8400, night: 1400 } },
    });
    calendar.pin(new Date(process.env.TEST_CALENDAR_AT!));
    const ordered = await http
      .post('/v1/rides')
      .send({ quoteId: quote.body.quoteId, class: 'economy', clientRequestId: randomUUID() })
      .expect(201);
    expect(ordered.body).toMatchObject({
      status: 'scheduled',
      scheduledFor: at.toISOString(),
      fare: { quoted: 8400 },
      canCancel: true,
    });
    // riding now is still possible
    expect((await http.get('/v1/rides/current').expect(200)).body.ride).toBeNull();
    expect(
      (await http.get('/v1/rides/scheduled').expect(200)).body.map((r: { id: string }) => r.id),
    ).toEqual([ordered.body.id]);

    // the dispatch loop leaves it alone until 15 minutes before
    const driver = await createDriver(app, { at: GULISTON });
    await dispatch.tick(new Date(at.getTime() - 16 * 60_000));
    expect((await http.get(`/v1/rides/${ordered.body.id}`)).body.status).toBe('scheduled');
    await dispatch.tick(new Date(at.getTime() - 14 * 60_000));
    const started = await http.get(`/v1/rides/${ordered.body.id}`).expect(200);
    expect(started.body.status).toBe('searching');
    expect(started.body.events.map((e: { type: string }) => e.type)).toEqual([
      'requested',
      'dispatch_started',
    ]);
    // and dispatches it like any ride: the driver nearby gets the offer
    const offers = await driver.http.get('/v1/driver/offers').expect(200);
    expect(offers.body[0]?.ride.id).toBe(ordered.body.id);
  });

  it('keeps the window, cash only, at most three, and cancels free before dispatch', async () => {
    const rider = await signIn(app);
    const http = api(app, rider.accessToken);
    for (const minutes of [10, 25 * 60]) {
      await http
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, scheduledFor: inMinutes(minutes).toISOString() })
        .expect(400);
    }
    expect((await schedule(rider, inMinutes(60), 'card')).status).toBe(400);
    const first = await schedule(rider, inMinutes(60));
    expect(first.status).toBe(201);
    expect((await schedule(rider, inMinutes(90))).status).toBe(201);
    expect((await schedule(rider, inMinutes(120))).status).toBe(201);
    expect((await schedule(rider, inMinutes(150))).status).toBe(409);
    const cancelled = await http
      .post(`/v1/rides/${first.body.id}/cancel`)
      .send({ reason: 'Rejam o‘zgardi' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', fare: { cancellationFee: 0 } });
  });

  it('cancels a scheduled ride whose rider is on another ride when its time comes', async () => {
    const rider = await signIn(app);
    const later = await schedule(rider, inMinutes(40));
    expect(later.status).toBe(201);
    // meanwhile the rider rides now
    await orderRide(app, rider, { pickup: GULISTON, dropoff: MID });
    await dispatch.tick(inMinutes(30));
    const view = await api(app, rider.accessToken).get(`/v1/rides/${later.body.id}`).expect(200);
    expect(view.body).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      cancelReason: 'Boshqa safaringiz davom etmoqda',
    });
  });

  describe('with a deposit (part of the fare paid in advance)', () => {
    beforeAll(async () => {
      await admin.put('/v1/admin/settings/booking').send(DEFAULT_BOOKING).expect(200);
    });

    async function bookAndPay(rider: Session, at: Date) {
      const http = api(app, rider.accessToken);
      const quote = await http
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, scheduledFor: at.toISOString() })
        .expect(200);
      expect(quote.body.deposit).toMatchObject({ percent: 20, freeCancelMinutes: 60 });
      const ordered = (await schedule(rider, at)).body;
      expect(ordered).toMatchObject({ status: 'awaiting_payment', paymentMethod: 'cash' });
      expect(ordered.fare.deposit).toBe(quote.body.deposit.amount);
      expect(ordered.payment).toMatchObject({ amount: ordered.fare.deposit, status: 'pending' });
      // not a ride now: the rider may still ride meanwhile
      expect((await http.get('/v1/rides/current').expect(200)).body.ride).toBeNull();
      await payWithPayme(app, ordered.payment.id, ordered.fare.deposit);
      const paid = (await http.get(`/v1/rides/${ordered.id}`).expect(200)).body;
      expect(paid).toMatchObject({ status: 'scheduled', paymentStatus: 'paid' });
      return paid;
    }

    it('books a ride for later only once the deposit is paid; the driver collects the rest', async () => {
      const rider = await signIn(app);
      const ride = await bookAndPay(rider, inMinutes(40));
      const driver = await createDriver(app);
      await dispatch.tick(inMinutes(30));
      const offer = (await driver.http.get('/v1/driver/offers').expect(200)).body[0];
      expect(offer.ride.id).toBe(ride.id);
      const taken = (await driver.http.post(`/v1/driver/offers/${offer.id}/accept`).expect(200))
        .body;
      expect(taken.collectCash).toBe(ride.fare.quoted - ride.fare.deposit);
      await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
      const pin = (await api(app, rider.accessToken).get(`/v1/rides/${ride.id}`)).body.startPin;
      await driver.http.post(`/v1/driver/rides/${ride.id}/start`).send({ pin }).expect(200);
      await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
      const ledger = (await admin.get(`/v1/admin/billing/drivers/${driver.id}/ledger`).expect(200))
        .body;
      const entries = (ledger.items ?? ledger.entries ?? ledger) as {
        kind: string;
        amount: number;
      }[];
      expect(entries.find((e) => e.kind === 'deposit')?.amount).toBe(ride.fare.deposit);
    });

    it('refunds the deposit when cancelled in time, keeps it when cancelled late', async () => {
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const early = await bookAndPay(rider, inMinutes(180));
      const cancelled = (await http.post(`/v1/rides/${early.id}/cancel`).send({}).expect(200)).body;
      expect(cancelled).toMatchObject({ status: 'cancelled', paymentStatus: 'refund_pending' });
      const late = await bookAndPay(rider, inMinutes(45));
      const lost = (await http.post(`/v1/rides/${late.id}/cancel`).send({}).expect(200)).body;
      expect(lost).toMatchObject({
        status: 'cancelled',
        paymentStatus: 'paid',
        fare: { cancellationFee: late.fare.deposit, cancellationFeeStatus: null },
      });
    });
  });
});
