import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import type { RideStop } from '../src/core/db/schema.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { type Fake, startFake } from './fakes.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  NEAR,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
  uniquePhone,
} from './helpers.js';

/** Two stops inside Guliston on the way to MID. */
const STOP_A = { lat: 40.4995, lng: 68.784 };
const STOP_B = { lat: 40.4935, lng: 68.792 };

describe('intermediate stops', { timeout: 120_000 }, () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];

  beforeAll(async () => {
    fake = await startFake();
    Object.assign(process.env, fake.env());
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
  });
  afterAll(async () => {
    await app?.close();
    await fake?.close();
  });
  beforeEach(() => quiesce(app));

  async function quote(rider: Session, body: Record<string, unknown> = {}, status = 200) {
    const res = await api(app, rider.accessToken)
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, options: [], ...body })
      .expect(status);
    return res.body;
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

  /** Assigned by an operator, at the pickup and on the way. */
  async function onTheWay(driver: DriverFixture, rideId: string) {
    await admin.post(`/v1/admin/rides/${rideId}/assign`).send({ driverId: driver.id }).expect(200);
    await driver.http.post(`/v1/driver/rides/${rideId}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${rideId}/start`).send({}).expect(200);
  }

  /** Moves a stop's arrival back in time (the clock of a stop is the database's). */
  async function arrivedMinutesAgo(rideId: string, index: number, minutes: number) {
    const row = await db
      .selectFrom('rides')
      .select('stops')
      .where('id', '=', rideId)
      .executeTakeFirstOrThrow();
    const stops = row.stops.map((s: RideStop, i: number) =>
      i === index ? { ...s, arrivedAt: new Date(Date.now() - minutes * 60_000).toISOString() } : s,
    );
    await db
      .updateTable('rides')
      .set({ stops: JSON.stringify(stops) })
      .where('id', '=', rideId)
      .execute();
  }

  it('prices the road through up to two stops plus a fee each, never shared', async () => {
    const rider = await signIn(app);
    const direct = await quote(rider);
    const q = await quote(rider, { stops: [STOP_A, STOP_B] });
    expect(q.distanceM).toBeGreaterThan(direct.distanceM);
    expect(q.fares.economy.stops).toEqual({ count: 2, fee: 2000 });
    expect(q.fares.economy.total).toBeGreaterThanOrEqual(direct.fares.economy.total + 2000);
    expect(q.stops).toEqual([STOP_A, STOP_B]);
    expect(q.stopRules).toEqual({ max: 2, perStop: 1000, freeMinutes: 3, waitingPerMinute: 500 });
    expect(q.pool.available).toBe(false);
    expect(direct.stops).toEqual([]);

    const three = await quote(rider, { stops: [STOP_A, STOP_B, NEAR] }, 400);
    expect(three.issues[0].message).toBe('Oraliq manzillar 2 tadan ko‘p bo‘lmaydi');
    const cargo = await quote(rider, { service: 'cargo', stops: [STOP_A] }, 400);
    expect(cargo.message).toBe('Yuk tashishda oraliq manzil bo‘lmaydi');

    const shared = await order(rider, q.quoteId, { shareable: true }).expect(400);
    expect(shared.body.message).toBe('Hamroh bilan safarda oraliq manzil bo‘lmaydi');
    await order(rider, q.quoteId, { stops: [{ address: 'Dorixona', landmark: null }] }).expect(400);
    const ride = await order(rider, q.quoteId, {
      stops: [
        { address: 'Dorixona', landmark: 'Bozor yonida' },
        { address: '5-maktab', landmark: null },
      ],
    }).expect(201);
    expect(ride.body.fare.quoted).toBe(q.fares.economy.total);
    expect(ride.body.stops).toEqual([
      {
        address: 'Dorixona',
        landmark: 'Bozor yonida',
        ...STOP_A,
        arrivedAt: null,
        leftAt: null,
        waitingFee: 0,
      },
      {
        address: '5-maktab',
        landmark: null,
        ...STOP_B,
        arrivedAt: null,
        leftAt: null,
        waitingFee: 0,
      },
    ]);
    // the database refuses stops on a shared ride whatever the code does
    await expect(
      db.updateTable('rides').set({ shareable: true }).where('id', '=', ride.body.id).execute(),
    ).rejects.toThrow(/rides_stops_service_check/);
  });

  it('runs the stops in order, charges waiting beyond the free minutes, ends on the final fare', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const q = await quote(rider, { stops: [STOP_A, STOP_B] });
    const ride = (await order(rider, q.quoteId).expect(201)).body;

    // the offer shows the stops
    await app.get(DispatchService).tick();
    const offers = (await driver.http.get('/v1/driver/offers').expect(200)).body;
    expect(offers[0].ride.stops).toEqual([
      { address: null, landmark: null, ...STOP_A },
      { address: null, landmark: null, ...STOP_B },
    ]);
    await driver.http.post(`/v1/driver/offers/${offers[0].id}/decline`).expect(204);

    // not before the trip starts
    await admin.post(`/v1/admin/rides/${ride.id}/assign`).send({ driverId: driver.id }).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/arrive`).expect(409);
    await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/start`).send({}).expect(200);

    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/leave`).expect(409);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/5/arrive`).expect(404);
    const at0 = await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/arrive`).expect(200);
    expect(at0.body.stops[0].arrivedAt).not.toBeNull();
    // one stop at a time
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/1/arrive`).expect(409);
    // 5½ minutes at the pharmacy: 3 free, then 3 started minutes × 500
    await arrivedMinutesAgo(ride.id, 0, 5.5);
    const left0 = await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/leave`).expect(200);
    expect(left0.body.stops[0].waitingFee).toBe(1500);
    expect(left0.body.fare.waiting).toBe(1500);
    expect(left0.body.collectCash).toBe(ride.fare.quoted + 1500);
    // a repeat after a lost answer changes nothing
    const again = await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/leave`).expect(200);
    expect(again.body.fare.waiting).toBe(1500);

    // the rider and the share link follow the stops
    const seen = (await api(app, rider.accessToken).get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(seen.stops[0].leftAt).not.toBeNull();
    expect(seen.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['stop_arrived', 'stop_left']),
    );
    const link = await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/share`).expect(200);
    const shared = (await api(app).get(`/v1/share/${link.body.token}`).expect(200)).body;
    expect(shared.stops.map((s: { passed: boolean }) => s.passed)).toEqual([true, false]);

    // the car is at the second stop when the trip ends: the waiting there ends too
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/1/arrive`).expect(200);
    await arrivedMinutesAgo(ride.id, 1, 3.5);
    // repeating an earlier stop's arrival (a lost answer) changes nothing
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/arrive`).expect(200);
    const done = await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
    expect(done.body.stops[1].waitingFee).toBe(500);
    expect(done.body.fare.total).toBe(ride.fare.quoted + 2000);
    expect(done.body.earnings.fare).toBe(ride.fare.quoted + 2000);
  });

  it('lets a stop the rider skipped stay unvisited, and refuses going back', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const q = await quote(rider, { stops: [STOP_A, STOP_B] });
    const ride = (await order(rider, q.quoteId).expect(201)).body;
    await onTheWay(driver, ride.id);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/1/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/1/leave`).expect(200);
    const back = await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/arrive`).expect(409);
    expect(back.body.message).toBe('Bu oraliq manzil ortda qoldi');
    const done = await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
    // the price is fixed: a skipped stop is not taken off, nobody waited
    expect(done.body.fare.total).toBe(ride.fare.quoted);
  });

  it('takes stops in phone orders, from the operator’s quote or by coordinates', async () => {
    const q = (
      await admin
        .post('/v1/admin/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, options: [], stops: [STOP_A] })
        .expect(200)
    ).body;
    const phone = uniquePhone();
    const fromQuote = await admin
      .post('/v1/admin/rides')
      .send({
        riderPhone: phone,
        riderName: 'Karim aka',
        pickup: { address: 'Bozor', landmark: null },
        dropoff: { address: 'Vokzal', landmark: null },
        stops: [{ address: 'Dorixona', landmark: null }],
        quoteId: q.quoteId,
        options: [],
      })
      .expect(201);
    expect(fromQuote.body.fare.quoted).toBe(q.fares.economy.total);
    expect(fromQuote.body.stops).toMatchObject([{ address: 'Dorixona', ...STOP_A }]);
    await admin
      .post(`/v1/admin/rides/${fromQuote.body.id}/cancel`)
      .send({ reason: 'Sinov' })
      .expect(200);

    const direct = await admin
      .post('/v1/admin/rides')
      .send({
        riderPhone: phone,
        riderName: 'Karim aka',
        pickup: { ...GULISTON, address: 'Bozor', landmark: null },
        dropoff: { ...MID, address: 'Vokzal', landmark: null },
        stops: [{ ...STOP_B, address: 'Maktab', landmark: null }],
        options: [],
      })
      .expect(201);
    expect(direct.body.fare.breakdown.stops).toEqual({ count: 1, fee: 1000 });
    const detail = (await admin.get(`/v1/admin/rides/${direct.body.id}`).expect(200)).body;
    expect(detail.stops).toMatchObject([{ address: 'Maktab', ...STOP_B }]);
    // a stop without coordinates needs the operator's quote
    await admin
      .post('/v1/admin/rides')
      .send({
        riderPhone: uniquePhone(),
        pickup: { ...GULISTON, address: 'Bozor', landmark: null },
        dropoff: { ...MID, address: 'Vokzal', landmark: null },
        stops: [{ address: 'Maktab', landmark: null }],
        options: [],
      })
      .expect(400);
  });
});
