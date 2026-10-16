import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { NotificationsHandler } from '../src/modules/notifications/notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import { DEFAULT_PROMO } from '../src/modules/settings/settings.module.js';
import { type Fake, startFake } from './fakes.js';
import { payWithPayme } from './payments-helpers.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
} from './helpers.js';

/** Two stops inside Guliston on the way to MID (as in ride-stops.test.ts). */
const STOP_A = { lat: 40.4995, lng: 68.784 };
const STOP_B = { lat: 40.4935, lng: 68.792 };
/** A stop off to the side: the road through it is longer. */
const STOP_C = { lat: 40.5075, lng: 68.79 };

const words = (address: string) => ({ address, landmark: null });

interface PushSent {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

describe('changing the intermediate stops of a ride that is on', { timeout: 120_000 }, () => {
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
    await admin.put('/v1/admin/settings/promo').send(DEFAULT_PROMO).expect(200);
  });
  afterAll(async () => {
    await app?.close();
    await fake?.close();
  });
  beforeEach(() => quiesce(app));

  async function quote(rider: Session, body: Record<string, unknown> = {}) {
    const res = await api(app, rider.accessToken)
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, options: [], ...body })
      .expect(200);
    return res.body;
  }

  async function order(rider: Session, quoteId: string, body: Record<string, unknown> = {}) {
    const res = await api(app, rider.accessToken)
      .post('/v1/rides')
      .send({
        quoteId,
        class: 'economy',
        pickup: { address: 'Mustaqillik 12', landmark: null },
        dropoff: { address: 'Vokzal', landmark: null },
        comment: null,
        clientRequestId: randomUUID(),
        ...body,
      })
      .expect(201);
    return res.body;
  }

  const preview = (rider: Session, rideId: string, stops: unknown[], status = 200) =>
    api(app, rider.accessToken)
      .post(`/v1/rides/${rideId}/stops/preview`)
      .send({ stops })
      .expect(status);
  const change = (
    rider: Session,
    rideId: string,
    stops: unknown[],
    confirmTotal: number,
    status = 200,
  ) =>
    api(app, rider.accessToken)
      .put(`/v1/rides/${rideId}/stops`)
      .send({ stops, confirmTotal })
      .expect(status);

  const events = async (rideId: string) =>
    (
      await db
        .selectFrom('ride_events')
        .select(['type', 'data'])
        .where('ride_id', '=', rideId)
        .orderBy('id')
        .execute()
    ).filter((e) => e.type === 'stops_changed');

  async function assign(driver: DriverFixture, rideId: string) {
    await admin.post(`/v1/admin/rides/${rideId}/assign`).send({ driverId: driver.id }).expect(200);
  }

  it('previews the new price, changes the stops at that price only, tells the driver', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const q = await quote(rider, { stops: [STOP_A] });
    const ride = await order(rider, q.quoteId, { stops: [words('Dorixona')] });
    await assign(driver, ride.id);
    const driverToken = `ExponentPushToken[${randomUUID()}]`;
    await driver.http
      .put('/v1/devices')
      .send({ token: driverToken, app: 'driver', platform: 'android', locale: 'ru' })
      .expect(204);
    while ((await outbox.runOnce()) > 0);

    // the rider sees the button; the preview prices the road through two stops
    const seen = (await api(app, rider.accessToken).get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(seen.canChangeStops).toBe(true);
    const p = (await preview(rider, ride.id, [STOP_A, STOP_C])).body;
    expect(p.stops).toBe(2);
    expect(p.fare.before).toBe(ride.fare.quoted);
    expect(p.fare.after).toBeGreaterThan(ride.fare.quoted);
    expect(p.fare.breakdown.stops).toEqual({ count: 2, fee: 2000 });
    expect(p.distanceM).toBeGreaterThan(ride.distanceM);
    expect(p.pays).toEqual({ before: ride.fare.quoted, after: p.fare.after });
    expect(p.discount).toBeNull();
    expect(p.stopRules).toMatchObject({ max: 2, perStop: 1000 });
    // nothing changed yet
    const still = (await api(app, rider.accessToken).get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(still.stops).toHaveLength(1);
    expect(still.fare.quoted).toBe(ride.fare.quoted);

    // the price the rider confirms must be the current one
    const moved = await change(
      rider,
      ride.id,
      [
        { ...STOP_A, ...words('Dorixona') },
        { ...STOP_C, ...words('Maktab') },
      ],
      p.fare.after - 100,
      409,
    );
    expect(moved.body).toMatchObject({ reason: 'price_changed', total: p.fare.after });

    const changed = (
      await change(
        rider,
        ride.id,
        [
          { ...STOP_A, ...words('Dorixona') },
          { ...STOP_C, ...words('Maktab') },
        ],
        p.fare.after,
      )
    ).body;
    expect(changed.stops).toEqual([
      {
        ...STOP_A,
        address: 'Dorixona',
        landmark: null,
        arrivedAt: null,
        leftAt: null,
        waitingFee: 0,
      },
      {
        ...STOP_C,
        address: 'Maktab',
        landmark: null,
        arrivedAt: null,
        leftAt: null,
        waitingFee: 0,
      },
    ]);
    expect(changed.fare.quoted).toBe(p.fare.after);
    expect(changed.fare.pays).toBe(p.fare.after);
    expect(changed.fare.breakdown.stops).toEqual({ count: 2, fee: 2000 });
    expect(changed.distanceM).toBe(p.distanceM);
    expect(changed.events.map((e: { type: string }) => e.type)).toContain('stops_changed');
    expect(await events(ride.id)).toMatchObject([
      { data: { stops: 2, before: 1, fareBefore: ride.fare.quoted, fareAfter: p.fare.after } },
    ]);

    // the driver's view: the new stops and cash; the push in the device's language
    const mine = (await driver.http.get(`/v1/driver/rides/${ride.id}`).expect(200)).body;
    expect(mine.stops.map((s: { address: string }) => s.address)).toEqual(['Dorixona', 'Maktab']);
    expect(mine.collectCash).toBe(p.fare.after);
    while ((await outbox.runOnce()) > 0);
    const pushes = fake
      .hitsOf('/expo/send')
      .flatMap((h) => h.body as PushSent[])
      .filter((m) => m.to === driverToken && m.data?.kind === 'stops_changed');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.title).toBe('Пассажир изменил остановки');
    expect(pushes[0]!.body).toContain('остановок: 2');
    // the operators' timeline reads it too
    const detail = (await admin.get(`/v1/admin/rides/${ride.id}`).expect(200)).body;
    expect(detail.stops).toHaveLength(2);
    expect(detail.fare.quoted).toBe(p.fare.after);

    // the same list again is no change; three stops never
    await change(rider, ride.id, [STOP_A, STOP_C], p.fare.after, 400);
    const three = await preview(rider, ride.id, [STOP_A, STOP_B, STOP_C], 400);
    expect(three.body.issues?.[0]?.message ?? three.body.message).toBe(
      'Oraliq manzillar 2 tadan ko‘p bo‘lmaydi',
    );
  });

  it('on the trip: the ETA points at the next stop, reached stops stay, the rest may go', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const q = await quote(rider, { stops: [STOP_A, STOP_B] });
    const ride = await order(rider, q.quoteId);
    await assign(driver, ride.id);
    await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/start`).send({}).expect(200);
    await driver.http.post('/v1/driver/location').send(GULISTON).expect(204);

    const http = api(app, rider.accessToken);
    const v0 = (await http.get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(v0.nextStopIndex).toBe(0);
    expect(v0.destinationEta).not.toBeNull();
    // the first stop is close, the destination far: the ETA is the stop's
    const toStop = v0.destinationEta.distanceM;
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/leave`).expect(200);
    const v1 = (await http.get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(v1.nextStopIndex).toBe(1);
    expect(v1.destinationEta.distanceM).toBeGreaterThan(toStop);

    // the first stop is behind: it cannot be replaced or dropped
    const locked = await preview(rider, ride.id, [STOP_C, STOP_B], 409);
    expect(locked.body.message).toBe('Mashina yetib borgan oraliq manzil o‘zgarmaydi');
    await preview(rider, ride.id, [], 409);
    // the second may go: the price falls (one stop's fee and the shorter road)
    const p = (await preview(rider, ride.id, [STOP_A])).body;
    expect(p.fare.after).toBeLessThan(ride.fare.quoted);
    expect(p.fare.breakdown.stops).toEqual({ count: 1, fee: 1000 });
    const changed = (
      await change(rider, ride.id, [{ ...STOP_A, address: null, landmark: null }], p.fare.after)
    ).body;
    expect(changed.stops).toHaveLength(1);
    expect(changed.stops[0].leftAt).not.toBeNull();
    expect(changed.nextStopIndex).toBeNull();
    expect(changed.fare.quoted).toBe(p.fare.after);

    // the trip ends on the new price plus the waiting there was
    const done = (await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200)).body;
    expect(done.fare.total).toBe(p.fare.after + done.fare.waiting);
    expect(done.earnings.fare).toBe(done.fare.total);
    // over: no more changes
    const over = await preview(rider, ride.id, [STOP_A, STOP_B], 409);
    expect(over.body.message).toBe('Bu bosqichda manzillar o‘zgarmaydi');
    const final = (await http.get(`/v1/rides/${ride.id}`).expect(200)).body;
    expect(final.canChangeStops).toBe(false);
  });

  it('on the trip the road already driven stays in the price when a stop is dropped', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const q = await quote(rider, { stops: [STOP_A, STOP_B] });
    const ride = await order(rider, q.quoteId);
    await assign(driver, ride.id);
    await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/start`).send({}).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/stops/0/leave`).expect(200);
    // the car has reached the far second stop when the rider drops it: the road is the
    // same as ordered, only the stop fee goes
    // (set directly: the location route refuses a jump the car could not have driven)
    await db
      .updateTable('drivers')
      .set({ lat: STOP_B.lat, lng: STOP_B.lng, located_at: new Date() })
      .where('user_id', '=', driver.id)
      .execute();
    const p = (await preview(rider, ride.id, [STOP_A])).body;
    expect(p.fare.breakdown.stops).toEqual({ count: 1, fee: 1000 });
    expect(p.fare.after).toBeGreaterThanOrEqual(ride.fare.quoted - 1000);
    expect(p.fare.after).toBeLessThan(ride.fare.quoted);
    const changed = (
      await change(rider, ride.id, [{ ...STOP_A, address: null, landmark: null }], p.fare.after)
    ).body;
    expect(changed.fare.quoted).toBe(p.fare.after);
  });

  it('refuses shared, card and cargo rides and rides of someone else', async () => {
    const rider = await signIn(app);
    const shared = await order(rider, (await quote(rider)).quoteId, { shareable: true });
    const s = await preview(rider, shared.id, [STOP_A], 400);
    expect(s.body.message).toBe('Hamroh bilan safarda oraliq manzil bo‘lmaydi');
    expect(shared.canChangeStops).toBe(false);
    await api(app, rider.accessToken).post(`/v1/rides/${shared.id}/cancel`).send({}).expect(200);

    const card = await order(rider, (await quote(rider)).quoteId, { paymentMethod: 'card' });
    // not paid yet: not at this stage; paid (searching): never, the fare is prepaid
    const unpaid = await preview(rider, card.id, [STOP_A], 409);
    expect(unpaid.body.message).toBe('Bu bosqichda manzillar o‘zgarmaydi');
    await payWithPayme(app, card.payment.id, card.payment.amount);
    const c = await preview(rider, card.id, [STOP_A], 409);
    expect(c.body.message).toContain('Karta orqali to‘langan safarda');
    expect(
      (await api(app, rider.accessToken).get(`/v1/rides/${card.id}`).expect(200)).body
        .canChangeStops,
    ).toBe(false);
    await api(app, rider.accessToken).post(`/v1/rides/${card.id}/cancel`).send({}).expect(200);

    const cash = await order(rider, (await quote(rider)).quoteId);
    const other = await signIn(app);
    await preview(other, cash.id, [STOP_A], 404);
    await change(other, cash.id, [STOP_A], 1, 404);

    const cq = await quote(rider, { service: 'cargo', cargo: { description: 'Divan' } });
    await api(app, rider.accessToken).post(`/v1/rides/${cash.id}/cancel`).send({}).expect(200);
    const cargo = await order(rider, cq.quoteId, { class: 'cargo_s' });
    const g = await preview(rider, cargo.id, [STOP_A], 400);
    expect(g.body.message).toBe('Oraliq manzil faqat taksi safarida o‘zgartiriladi');
  });

  it('keeps the promo discount consistent: the percent follows the new fare, a code that stops fitting drops out', async () => {
    const driver = await createDriver(app, { at: GULISTON, topup: 50_000 });
    const rider = await signIn(app);
    const code = (
      await admin
        .post('/v1/admin/promos')
        .send({
          code: `S${Date.now().toString(36).toUpperCase()}`,
          kind: 'percent',
          value: 20,
          maxDiscount: 5000,
          description: 'Sinov',
        })
        .expect(201)
    ).body as { id: string; code: string };
    await api(app, rider.accessToken).post('/v1/promos').send({ code: code.code }).expect(200);
    const q = await quote(rider);
    const promo = q.discounts.classes.economy.promo;
    expect(promo).toMatchObject({ id: code.id, amount: 1400 });
    const ride = await order(rider, q.quoteId, { promoId: code.id });
    expect(ride.fare).toMatchObject({ quoted: 7000, discount: 1400, pays: 5600 });

    // a stop: 20% of the new fare (rounded down to 100)
    const p = (await preview(rider, ride.id, [STOP_A])).body;
    const expected = Math.floor((p.fare.after * 0.2) / 100) * 100;
    expect(p.discount).toEqual({
      before: 1400,
      after: expected,
      promo: expected,
      credit: 0,
      note: null,
    });
    expect(p.pays).toEqual({ before: 5600, after: p.fare.after - expected });
    const changed = (await change(rider, ride.id, [STOP_A], p.fare.after)).body;
    expect(changed.fare).toMatchObject({
      quoted: p.fare.after,
      discount: expected,
      pays: p.fare.after - expected,
      promo: { code: code.code, amount: expected },
    });
    expect(await events(ride.id)).toMatchObject([
      { data: { discountBefore: 1400, discountAfter: expected } },
    ]);

    // completed: the driver takes the discounted cash and is made whole for the new discount
    await assign(driver, ride.id);
    const mine = (await driver.http.get(`/v1/driver/rides/${ride.id}`).expect(200)).body;
    expect(mine.collectCash).toBe(p.fare.after - expected);
    expect(mine.discount).toMatchObject({ amount: expected, compensation: expected });
    await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/start`).send({}).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
    const ledger = await db
      .selectFrom('driver_ledger')
      .select(['kind', 'amount'])
      .where('ride_id', '=', ride.id)
      .execute();
    expect(ledger).toContainEqual({ kind: 'promo_compensation', amount: expected });

    // a fixed code with a minimum fare: removing the stop takes the fare under it
    const fixed = (
      await admin
        .post('/v1/admin/promos')
        .send({
          code: `F${Date.now().toString(36).toUpperCase()}`,
          kind: 'fixed',
          value: 2000,
          minFare: 8000,
          description: 'Katta safarlar',
        })
        .expect(201)
    ).body as { id: string; code: string };
    const rider2 = await signIn(app);
    await api(app, rider2.accessToken).post('/v1/promos').send({ code: fixed.code }).expect(200);
    const q2 = await quote(rider2, { stops: [STOP_A] });
    expect(q2.discounts.classes.economy.promo).toMatchObject({ id: fixed.id, amount: 2000 });
    const ride2 = await order(rider2, q2.quoteId, { promoId: fixed.id });
    const p2 = (await preview(rider2, ride2.id, [])).body;
    expect(p2.fare.after).toBe(7000);
    expect(p2.discount).toMatchObject({
      before: 2000,
      after: 0,
      note: expect.stringContaining('8 000'),
    });
    const changed2 = (await change(rider2, ride2.id, [], 7000)).body;
    expect(changed2.fare).toMatchObject({ quoted: 7000, discount: 0, pays: 7000, promo: null });
    const row = await db
      .selectFrom('ride_discounts')
      .select(['status', 'promo_amount'])
      .where('ride_id', '=', ride2.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('released');
  });

  it('keeps ride credit consistent: at most half of the new fare, the balance follows', async () => {
    const rider = await signIn(app);
    const me = (await api(app, rider.accessToken).get('/v1/me').expect(200)).body;
    await db
      .insertInto('rider_credits')
      .values({
        id: uuidv7(),
        user_id: me.id,
        kind: 'adjustment',
        amount: 10_000,
        ride_id: null,
        referral_id: null,
        note: 'Sinov',
      })
      .execute();
    const q = await quote(rider);
    expect(q.discounts.classes.economy).toMatchObject({ credit: 3500, pays: 3500 });
    const ride = await order(rider, q.quoteId, { useCredit: true });
    expect(ride.fare).toMatchObject({ credit: 3500, pays: 3500 });
    const balance = async () =>
      (await api(app, rider.accessToken).get('/v1/promos').expect(200)).body.credit.balance;
    expect(await balance()).toBe(6500);

    // a stop: the credit grows to half of the new fare (the balance allows it)
    const p = (await preview(rider, ride.id, [STOP_A])).body;
    const half = Math.floor(p.fare.after / 2 / 100) * 100;
    expect(p.discount).toMatchObject({ before: 3500, after: half, promo: 0, credit: half });
    const changed = (await change(rider, ride.id, [STOP_A], p.fare.after)).body;
    expect(changed.fare).toMatchObject({ credit: half, pays: p.fare.after - half });
    expect(await balance()).toBe(10_000 - half);
    const rows = () =>
      db
        .selectFrom('rider_credits')
        .select(['kind', 'amount'])
        .where('ride_id', '=', ride.id)
        .orderBy('id')
        .execute();
    // the ledger stays append-only: the change is an adjustment on the ride
    expect(await rows()).toEqual([
      { kind: 'ride', amount: -3500 },
      { kind: 'adjustment', amount: 3500 - half },
    ]);

    // back to no stops: the credit falls back; a cancel gives the current reservation back
    const p2 = (await preview(rider, ride.id, [])).body;
    expect(p2.discount).toMatchObject({ after: 3500, credit: 3500 });
    await change(rider, ride.id, [], 7000);
    expect(await balance()).toBe(6500);
    await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/cancel`).send({}).expect(200);
    expect(await balance()).toBe(10_000);
    expect((await rows()).map((r) => r.kind)).toEqual([
      'ride',
      'adjustment',
      'adjustment',
      'ride_release',
    ]);
  });
});
