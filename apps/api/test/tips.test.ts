import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { TipsService } from '../src/modules/tips/tips.service.js';
import { payme, payWithClick, payWithPayme } from './payments-helpers.js';
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

describe('tips (choychaqa)', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let driver: DriverFixture;
  const db = () => app.get(Database).kysely;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    driver = await createDriver(app, { online: false });
  });
  afterAll(() => app.close());

  /** A cash ride taken to the end. */
  async function completedRide(rider?: Session) {
    const r = rider ?? (await signIn(app));
    const { id } = await orderRide(app, r);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/start`).send({}).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
    return { rider: r, id, http: api(app, r.accessToken) };
  }
  const balance = async () =>
    (await driver.http.get('/v1/driver/balance').expect(200)).body.balance as number;
  const tipLedger = (rideId: string) =>
    db()
      .selectFrom('driver_ledger')
      .select(['kind', 'amount', 'payment_intent_id'])
      .where('ride_id', '=', rideId)
      .where('kind', '=', 'tip')
      .execute();

  it('offers presets after the ride and records a cash tip once', async () => {
    const { id, http } = await completedRide();
    const offer = await http.get(`/v1/rides/${id}/tip`).expect(200);
    expect(offer.body).toMatchObject({
      tip: null,
      rules: { enabled: true, presets: [2000, 5000, 10_000], max: 50_000, card: true, open: true },
    });
    const before = await balance();
    const cash = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 5000, method: 'cash' })
      .expect(201);
    expect(cash.body).toMatchObject({
      amount: 5000,
      method: 'cash',
      status: 'recorded',
      payment: null,
    });
    // a double tap is the same tip; another amount is refused
    const again = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 5000, method: 'cash' })
      .expect(201);
    expect(again.body.id).toBe(cash.body.id);
    const other = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 2000, method: 'card' })
      .expect(409);
    expect(other.body.message).toBe('Bu safar uchun choychaqa allaqachon berilgan');
    // cash is only recorded: the balance does not move
    expect(await balance()).toBe(before);
    expect(await tipLedger(id)).toEqual([]);
    const seen = await driver.http.get(`/v1/driver/rides/${id}/tip`).expect(200);
    expect(seen.body.tip).toMatchObject({ amount: 5000, method: 'cash', status: 'recorded' });
    const earnings = await driver.http.get('/v1/driver/earnings').expect(200);
    expect(earnings.body.tipsCash).toBeGreaterThanOrEqual(5000);
    const outbox = await db()
      .selectFrom('outbox')
      .select('payload')
      .where('topic', '=', 'ride.tip_changed')
      .execute();
    expect(outbox.map((o) => o.payload)).toContainEqual(
      expect.objectContaining({ rideId: id, method: 'cash', amount: 5000 }),
    );
  });

  it('charges a card tip by Payme and credits it whole to the driver, no commission or tax', async () => {
    const { id, http } = await completedRide();
    const before = await balance();
    const tip = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 7000, method: 'card' })
      .expect(201);
    expect(tip.body).toMatchObject({ method: 'card', status: 'awaiting_payment' });
    expect(tip.body.payment).toMatchObject({ purpose: 'tip', amount: 7000, status: 'pending' });
    expect(tip.body.payment.checkout.payme).toMatch(/^https:\/\//);
    // the same request while it waits: the same payment
    const repeat = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 7000, method: 'card' })
      .expect(201);
    expect(repeat.body.payment.id).toBe(tip.body.payment.id);

    const txId = await payWithPayme(app, tip.body.payment.id, 7000);
    const paid = await http.get(`/v1/rides/${id}/tip`).expect(200);
    expect(paid.body.tip).toMatchObject({ status: 'paid', payment: { status: 'paid' } });
    expect(await balance()).toBe(before + 7000);
    expect(await tipLedger(id)).toEqual([
      { kind: 'tip', amount: 7000, payment_intent_id: tip.body.payment.id },
    ]);
    // no commission or tax on it
    const charges = await db()
      .selectFrom('driver_ledger')
      .select(['kind', 'amount'])
      .where('ride_id', '=', id)
      .where('kind', 'in', ['commission', 'tax'])
      .execute();
    expect(charges.reduce((s, c) => s + c.amount, 0)).toBe(-70);
    // a paid tip is final: another attempt is refused, nothing more is credited
    await http.post(`/v1/rides/${id}/tip`).send({ amount: 3000, method: 'card' }).expect(409);
    expect(await tipLedger(id)).toHaveLength(1);
    // operators see it with its payment, and among the card payments
    const panel = await admin.get(`/v1/admin/rides/${id}/tip`).expect(200);
    expect(panel.body.tip).toMatchObject({
      amount: 7000,
      status: 'paid',
      payments: [{ status: 'paid' }],
    });
    const intents = await admin.get('/v1/admin/payments/intents?purpose=tip').expect(200);
    expect(intents.body.items.map((i: { id: string }) => i.id)).toContain(tip.body.payment.id);
    const earnings = await driver.http.get('/v1/driver/earnings').expect(200);
    expect(earnings.body.tipsCard).toBeGreaterThanOrEqual(7000);
    expect(
      intents.body.items.find((i: { id: string }) => i.id === tip.body.payment.id),
    ).toMatchObject({ purpose: 'tip', tipRideId: id });

    // refunded from the Payme cabinet: taken back from the driver's balance
    await payme(app, 'CancelTransaction', { id: txId, reason: 5 });
    const refunded = await http.get(`/v1/rides/${id}/tip`).expect(200);
    expect(refunded.body.tip.status).toBe('refunded');
    expect(await balance()).toBe(before);
  });

  it('pays a card tip by Click too, and lets the rider retry an expired one', async () => {
    const { id, http } = await completedRide();
    const first = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 2000, method: 'card' })
      .expect(201);
    // not paid in time: expired, the tip failed
    await db()
      .updateTable('payment_intents')
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where('id', '=', first.body.payment.id)
      .execute();
    expect(await app.get(TipsService).expireUnpaid(new Date())).toBe(1);
    const failed = await http.get(`/v1/rides/${id}/tip`).expect(200);
    expect(failed.body.tip.status).toBe('failed');
    // a new attempt (another amount) gets a new payment
    const retry = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 10_000, method: 'card' })
      .expect(201);
    expect(retry.body.payment.id).not.toBe(first.body.payment.id);
    await payWithClick(app, retry.body.payment.id, 10_000);
    expect((await tipLedger(id))[0]).toMatchObject({ amount: 10_000 });
  });

  it('refuses tips outside the rules', async () => {
    const { id, http } = await completedRide();
    const small = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 500, method: 'cash' })
      .expect(400);
    expect(small.body.message).toBe('Choychaqa kamida 1 000 so‘m');
    await http.post(`/v1/rides/${id}/tip`).send({ amount: 60_000, method: 'cash' }).expect(400);
    await http.post(`/v1/rides/${id}/tip`).send({ amount: 2550, method: 'cash' }).expect(400);
    // not the rider's ride; a ride not completed
    await api(app, (await signIn(app)).accessToken)
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 2000, method: 'cash' })
      .expect(404);
    const rider = await signIn(app);
    const open = await orderRide(app, rider);
    const r = await api(app, rider.accessToken)
      .post(`/v1/rides/${open.id}/tip`)
      .send({ amount: 2000, method: 'cash' })
      .expect(409);
    expect(r.body.message).toBe('Choychaqa safar yakunlangandan keyin beriladi');
    // a day after the ride
    await db()
      .updateTable('rides')
      .set({ completed_at: new Date(Date.now() - 25 * 3600_000) })
      .where('id', '=', id)
      .execute();
    const late = await http
      .post(`/v1/rides/${id}/tip`)
      .send({ amount: 2000, method: 'cash' })
      .expect(400);
    expect(late.body.reason).toBe('late');
    // operators switch tips off
    const rules = (await admin.get('/v1/admin/settings/tips').expect(200)).body;
    await admin
      .put('/v1/admin/settings/tips')
      .send({ ...rules, enabled: false })
      .expect(200);
    const off = await completedRide();
    await off.http
      .post(`/v1/rides/${off.id}/tip`)
      .send({ amount: 2000, method: 'cash' })
      .expect(400);
    await admin.put('/v1/admin/settings/tips').send(rules).expect(200);
  });
});
