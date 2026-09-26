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
} from './helpers.js';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('scheduled rides', () => {
  let app: INestApplication;
  let dispatch: DispatchService;

  beforeAll(async () => {
    app = await createTestApp();
    dispatch = app.get(DispatchService);
  });
  afterAll(async () => {
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
});
