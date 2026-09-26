import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { IntentsService } from '../src/modules/payments/intents.service.js';
import { RidesService } from '../src/modules/rides/rides.service.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  type Session,
  signIn,
  signInAdmin,
} from './helpers.js';
import { click, payme, payWithClick, payWithPayme } from './payments-helpers.js';

const FARE = 7000; // Guliston centre -> MID, economy (helpers.ts)

describe('card payments', () => {
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

  /** Quotes and orders a card ride the way the rider app does. */
  async function orderCard(rider: Session) {
    const http = api(app, rider.accessToken);
    const quote = await http
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID })
      .expect(200);
    expect(quote.body.paymentMethods).toEqual(['cash', 'card']);
    const res = await http
      .post('/v1/rides')
      .send({
        quoteId: quote.body.quoteId,
        class: 'economy',
        paymentMethod: 'card',
        clientRequestId: randomUUID(),
      })
      .expect(201);
    return res.body as {
      id: string;
      status: string;
      payment: {
        id: string;
        amount: number;
        status: string;
        checkout: { payme: string; click: string } | null;
      };
    };
  }

  const rideOf = (rider: Session, id: string) =>
    api(app, rider.accessToken)
      .get(`/v1/rides/${id}`)
      .expect(200)
      .then((r) => r.body);

  it('holds a card ride until its fixed fare is prepaid, then dispatches it', async () => {
    const rider = await signIn(app);
    const ride = await orderCard(rider);
    expect(ride.status).toBe('awaiting_payment');
    expect(ride.payment).toMatchObject({ amount: FARE, status: 'pending' });
    // the Payme link carries the cashbox, the intent, the amount in tiyin and the way back
    const decoded = Buffer.from(
      ride.payment.checkout!.payme.split('/').pop()!,
      'base64',
    ).toString();
    expect(decoded).toBe(
      `m=5e730e8e0b852a417aa49ceb;ac.order_id=${ride.payment.id};a=${FARE * 100};c=sfftaxi://payments/${ride.payment.id}`,
    );
    expect(ride.payment.checkout!.payme).toMatch(/^https:\/\/checkout\.test\.paycom\.uz\//);
    expect(ride.payment.checkout!.click).toContain(`transaction_param=${ride.payment.id}`);
    // not dispatched: no search yet, and the rider cannot order a second ride meanwhile
    const requested = await db()
      .selectFrom('outbox')
      .select('id')
      .where('topic', '=', 'ride.requested')
      .where(({ ref }) => ref('payload', '->>').key('rideId'), '=', ride.id)
      .execute();
    expect(requested).toHaveLength(0);
    expect(
      (await api(app, rider.accessToken).get('/v1/rides/current').expect(200)).body.ride.id,
    ).toBe(ride.id);

    // Payme checks: wrong key, unknown payment, wrong amount
    expect(
      (await payme(app, 'CheckPerformTransaction', { amount: 1, account: {} }, 'wrong-key')).body
        .error.code,
    ).toBe(-32504);
    expect(
      (
        await payme(app, 'CheckPerformTransaction', {
          amount: FARE * 100,
          account: { order_id: randomUUID() },
        })
      ).body.error.code,
    ).toBe(-31050);
    expect(
      (
        await payme(app, 'CheckPerformTransaction', {
          amount: FARE * 100 - 100,
          account: { order_id: ride.payment.id },
        })
      ).body.error.code,
    ).toBe(-31001);
    expect(
      (
        await payme(app, 'CheckPerformTransaction', {
          amount: FARE * 100,
          account: { order_id: ride.payment.id },
        })
      ).body.result,
    ).toEqual({ allow: true });

    const txId = await payWithPayme(app, ride.payment.id, FARE);
    // a retried perform answers the same, and pays nothing twice
    const again = await payme(app, 'PerformTransaction', { id: txId });
    expect(again.body.result.state).toBe(2);
    const paid = await rideOf(rider, ride.id);
    expect(paid).toMatchObject({
      status: 'searching',
      paymentStatus: 'paid',
      payment: { status: 'paid', provider: 'payme', checkout: null },
    });
    expect(paid.events.map((e: { type: string }) => e.type)).toEqual(['requested', 'paid']);
    // Click cannot take it a second time
    const clickAgain = await click(app, 'prepare', {
      click_trans_id: '99001',
      merchant_trans_id: ride.payment.id,
      amount: FARE,
    });
    expect(clickAgain.body.error).toBe(-4);

    // the trip: the fare the rider prepaid becomes the driver's money on the balance
    await admin.post(`/v1/admin/rides/${ride.id}/assign`).send({ driverId: driver.id }).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${ride.id}/start`).expect(200);
    const done = await driver.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ paymentStatus: 'paid', fare: { total: FARE } });
    const balance = await driver.http.get('/v1/driver/balance').expect(200);
    const entries = balance.body.entries.filter((e: { rideId: string }) => e.rideId === ride.id);
    expect(entries.map((e: { kind: string; amount: number }) => [e.kind, e.amount]).sort()).toEqual(
      [
        ['card_fare', FARE],
        ['tax', -70],
      ].sort(),
    );
    const earnings = await driver.http.get('/v1/driver/earnings').expect(200);
    // card rides are not cash in hand
    expect(earnings.body.cash).toBe(earnings.body.fares - FARE);

    // Payme's reports see the transaction
    const check = await payme(app, 'CheckTransaction', { id: txId });
    expect(check.body.result).toMatchObject({ state: 2, cancel_time: 0 });
    const statement = await payme(app, 'GetStatement', { from: 0, to: Date.now() + 1000 });
    expect(
      statement.body.result.transactions.find((t: { id: string }) => t.id === txId),
    ).toMatchObject({ amount: FARE * 100, account: { order_id: ride.payment.id } });
  });

  it('queues a cancelled paid ride for a full refund, closed by Payme or an operator', async () => {
    const rider = await signIn(app);
    const ride = await orderCard(rider);
    const txId = await payWithPayme(app, ride.payment.id, FARE);
    await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/cancel`).send({}).expect(200);
    expect(await rideOf(rider, ride.id)).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refund_pending',
      payment: { status: 'refund_pending' },
    });
    const queue = await admin.get('/v1/admin/payments/refunds').expect(200);
    expect(queue.body.find((q: { rideId: string }) => q.rideId === ride.id)).toMatchObject({
      amount: FARE,
      provider: 'payme',
      riderPhone: rider.phone,
    });

    // the operator refunds in the Payme cabinet: Payme cancels the performed transaction
    const cancelled = await payme(app, 'CancelTransaction', { id: txId, reason: 5 });
    expect(cancelled.body.result.state).toBe(-2);
    expect(await rideOf(rider, ride.id)).toMatchObject({
      paymentStatus: 'refunded',
      payment: { status: 'refunded' },
    });
    const after = await admin.get('/v1/admin/payments/refunds').expect(200);
    expect(after.body.some((q: { rideId: string }) => q.rideId === ride.id)).toBe(false);

    // Click has no refund callback: the operator records the reversal
    const rider2 = await signIn(app);
    const ride2 = await orderCard(rider2);
    await payWithClick(app, ride2.payment.id, FARE);
    await admin
      .post(`/v1/admin/rides/${ride2.id}/cancel`)
      .send({ reason: 'Mijoz qo‘ng‘iroq qilib bekor qildi' })
      .expect(200);
    await admin
      .post(`/v1/admin/payments/${ride.payment.id}/refunded`)
      .send({ reference: 'twice' })
      .expect(400);
    const confirmed = await admin
      .post(`/v1/admin/payments/${ride2.payment.id}/refunded`)
      .send({ reference: 'Click reversal 5567' })
      .expect(200);
    expect(confirmed.body).toMatchObject({ status: 'refunded', provider: 'click' });
    expect((await rideOf(rider2, ride2.id)).paymentStatus).toBe('refunded');
  });

  it('speaks Click: signatures, amounts, a failed payment, then a good one', async () => {
    const rider = await signIn(app);
    const ride = await orderCard(rider);
    const base = { merchant_trans_id: ride.payment.id, amount: FARE };
    expect(
      (await click(app, 'prepare', { ...base, click_trans_id: '5001' }, 'bad')).body.error,
    ).toBe(-1);
    expect(
      (await click(app, 'prepare', { ...base, click_trans_id: '5001', amount: FARE + 1 })).body
        .error,
    ).toBe(-2);
    const prepared = await click(app, 'prepare', { ...base, click_trans_id: '5001' });
    expect(prepared.body.error).toBe(0);
    // the card was declined: Click completes with a negative error
    const failed = await click(app, 'complete', {
      ...base,
      click_trans_id: '5001',
      merchant_prepare_id: prepared.body.merchant_prepare_id,
      error: -5017,
    });
    expect(failed.body.error).toBe(-9);
    expect((await rideOf(rider, ride.id)).status).toBe('awaiting_payment');
    // a new try with another card goes through (amounts like "7000.00" are fine)
    const second = await click(app, 'prepare', { ...base, click_trans_id: '5002' });
    const completed = await click(app, 'complete', {
      ...base,
      amount: `${FARE}.00`,
      click_trans_id: '5002',
      merchant_prepare_id: second.body.merchant_prepare_id,
    });
    expect(completed.body).toMatchObject({
      error: 0,
      merchant_confirm_id: second.body.merchant_prepare_id,
    });
    expect(await rideOf(rider, ride.id)).toMatchObject({
      status: 'searching',
      payment: { provider: 'click', status: 'paid' },
    });
    await admin
      .post(`/v1/admin/rides/${ride.id}/cancel`)
      .send({ reason: 'Test tugadi' })
      .expect(200);
  });

  it('lets only the first of two providers take the money', async () => {
    const rider = await signIn(app);
    const ride = await orderCard(rider);
    const pmId = `pm-${randomUUID()}`;
    const created = await payme(app, 'CreateTransaction', {
      id: pmId,
      time: Date.now(),
      amount: FARE * 100,
      account: { order_id: ride.payment.id },
    });
    expect(created.body.result.state).toBe(1);
    // the rider gave up on Payme's page and paid with Click
    await payWithClick(app, ride.payment.id, FARE);
    const late = await payme(app, 'PerformTransaction', { id: pmId });
    expect(late.body.error.code).toBe(-31008);
    const check = await payme(app, 'CheckTransaction', { id: pmId });
    expect(check.body.result.state).toBe(-1);
    await admin
      .post(`/v1/admin/rides/${ride.id}/cancel`)
      .send({ reason: 'Test tugadi' })
      .expect(200);
  });

  it('cancels a card ride not paid in time, but not while a payment is under way', async () => {
    const rides = app.get(RidesService);
    const rider = await signIn(app);
    const ride = await orderCard(rider);
    const expire = () =>
      db()
        .updateTable('payment_intents')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', ride.payment.id)
        .execute();
    // Payme opened a transaction a moment ago: the rider is typing the SMS code
    const pmId = `pm-${randomUUID()}`;
    await payme(app, 'CreateTransaction', {
      id: pmId,
      time: Date.now(),
      amount: FARE * 100,
      account: { order_id: ride.payment.id },
    });
    await expire();
    await rides.expireUnpaid();
    expect((await rideOf(rider, ride.id)).status).toBe('awaiting_payment');
    // ... it never finished
    await payme(app, 'CancelTransaction', { id: pmId, reason: 4 });
    await db()
      .updateTable('payment_transactions')
      .set({ created_at: new Date(Date.now() - 6 * 60_000) } as never)
      .where('external_id', '=', pmId)
      .execute();
    expect(await rides.expireUnpaid()).toBeGreaterThanOrEqual(1);
    const expired = await rideOf(rider, ride.id);
    expect(expired).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      paymentStatus: 'failed',
      payment: { status: 'expired', checkout: null },
    });
    // a late payment is refused
    const late = await payme(app, 'CheckPerformTransaction', {
      amount: FARE * 100,
      account: { order_id: ride.payment.id },
    });
    expect(late.body.error.code).toBe(-31051);
  });

  it('lets the rider cancel while paying: the payment can no longer be made', async () => {
    const rider = await signIn(app);
    const ride = await orderCard(rider);
    const cancelled = await api(app, rider.accessToken)
      .post(`/v1/rides/${ride.id}/cancel`)
      .send({ reason: 'Fikrimdan qaytdim' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'not_charged',
      payment: { status: 'cancelled' },
    });
    const prepare = await click(app, 'prepare', {
      click_trans_id: '6001',
      merchant_trans_id: ride.payment.id,
      amount: FARE,
    });
    expect(prepare.body.error).toBe(-9);
  });

  describe('driver top-ups', () => {
    it('credits the balance once per payment, and takes back a refunded one', async () => {
      const d = await createDriver(app, { online: false });
      await d.http.post('/v1/driver/topups').send({ amount: 1000 }).expect(400);
      const topup = await d.http.post('/v1/driver/topups').send({ amount: 50_000 }).expect(201);
      expect(topup.body).toMatchObject({ purpose: 'topup', amount: 50_000, status: 'pending' });
      expect(topup.body.checkout.payme).toBeTruthy();
      const txId = await payWithPayme(app, topup.body.id, 50_000);
      await payme(app, 'PerformTransaction', { id: txId });
      const balance = await d.http.get('/v1/driver/balance').expect(200);
      expect(balance.body.balance).toBe(50_000);
      expect(balance.body.entries[0]).toMatchObject({
        kind: 'topup',
        amount: 50_000,
        note: 'Payme orqali to‘ldirildi',
      });
      expect(
        (await d.http.get(`/v1/driver/topups/${topup.body.id}`).expect(200)).body,
      ).toMatchObject({ status: 'paid', provider: 'payme', checkout: null });
      expect((await d.http.get('/v1/driver/topups').expect(200)).body[0].id).toBe(topup.body.id);

      // Click top-up too
      const viaClick = await d.http.post('/v1/driver/topups').send({ amount: 20_000 }).expect(201);
      await payWithClick(app, viaClick.body.id, 20_000);
      expect((await d.http.get('/v1/driver/balance').expect(200)).body.balance).toBe(70_000);

      // refunded from the Payme cabinet: the balance gives it back
      await payme(app, 'CancelTransaction', { id: txId, reason: 5 });
      const after = await d.http.get('/v1/driver/balance').expect(200);
      expect(after.body.balance).toBe(20_000);
      expect(after.body.entries[0]).toMatchObject({ kind: 'adjustment', amount: -50_000 });

      // other drivers' top-ups are not visible; riders are not drivers
      const other = await createDriver(app, { online: false });
      await other.http.get(`/v1/driver/topups/${topup.body.id}`).expect(404);
      const rider = api(app, (await signIn(app)).accessToken);
      await rider.post('/v1/driver/topups').send({ amount: 10_000 }).expect(404);
    });

    it('expires a top-up nobody paid', async () => {
      const d = await createDriver(app, { online: false });
      const topup = await d.http.post('/v1/driver/topups').send({ amount: 10_000 }).expect(201);
      await db()
        .updateTable('payment_intents')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', topup.body.id)
        .execute();
      expect(await app.get(IntentsService).expireTopups()).toBeGreaterThanOrEqual(1);
      expect((await d.http.get(`/v1/driver/topups/${topup.body.id}`).expect(200)).body.status).toBe(
        'expired',
      );
      const late = await payme(app, 'CheckPerformTransaction', {
        amount: 10_000 * 100,
        account: { order_id: topup.body.id },
      });
      expect(late.body.error.code).toBe(-31051);
    });

    it('records payouts of card money, never more than the balance', async () => {
      const d = await createDriver(app, { online: false });
      const url = `/v1/admin/billing/drivers/${d.id}/ledger`;
      await admin.post(url).send({ kind: 'topup', amount: 30_000 }).expect(201);
      await admin.post(url).send({ kind: 'payout', amount: 10_000 }).expect(400);
      await admin
        .post(url)
        .send({ kind: 'payout', amount: 40_000, note: 'Humo karta *1234' })
        .expect(409);
      const paid = await admin
        .post(url)
        .send({ kind: 'payout', amount: 10_000, note: 'Humo karta *1234, o‘tkazma 8812' })
        .expect(201);
      expect(paid.body.balance).toBe(20_000);
      const entries = await d.http.get('/v1/driver/ledger').expect(200);
      expect(entries.body.items[0]).toMatchObject({ kind: 'payout', amount: -10_000 });
    });
  });
});

describe('without a card provider', () => {
  let app: INestApplication;
  const saved: Record<string, string | undefined> = {};
  const KEYS = [
    'PAYME_MERCHANT_ID',
    'PAYME_KEY',
    'CLICK_SERVICE_ID',
    'CLICK_MERCHANT_ID',
    'CLICK_SECRET',
  ];
  beforeAll(async () => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    app = await createTestApp();
  });
  afterAll(async () => {
    Object.assign(process.env, saved);
    await app.close();
  });

  it('offers cash only and refuses card orders and top-ups', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const quote = await rider
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID })
      .expect(200);
    expect(quote.body.paymentMethods).toEqual(['cash']);
    const refused = await rider
      .post('/v1/rides')
      .send({
        quoteId: quote.body.quoteId,
        class: 'economy',
        paymentMethod: 'card',
        clientRequestId: randomUUID(),
      })
      .expect(400);
    expect(refused.body.message).toMatch(/naqd/);
    const d = await createDriver(app, { online: false });
    await d.http.post('/v1/driver/topups').send({ amount: 10_000 }).expect(400);
  });
});
