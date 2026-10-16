import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BusinessCalendar } from '../src/core/clock/business-calendar.js';
import { Database } from '../src/core/db/database.js';
import { FiscalService } from '../src/modules/fiscal/fiscal.service.js';
import { DEFAULT_PROMO } from '../src/modules/settings/settings.module.js';
import { payWithPayme } from './payments-helpers.js';
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

/** Guliston centre -> MID: economy 7 000, comfort 8 800 (helpers.ts). */
const FARE = 7000;

describe('rider promo codes, referrals and ride credit', () => {
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
  beforeEach(async () => {
    await admin.put('/v1/admin/settings/promo').send(DEFAULT_PROMO).expect(200);
  });

  let codeSeq = 0;
  /** A promo code made in the panel (unique per test). */
  async function promo(over: Record<string, unknown> = {}) {
    const res = await admin
      .post('/v1/admin/promos')
      .send({
        code: `T${Date.now().toString(36).toUpperCase()}${codeSeq++}`,
        kind: 'percent',
        value: 20,
        maxDiscount: 5000,
        description: 'Kuzgi aksiya',
        ...over,
      })
      .expect(201);
    return res.body as { id: string; code: string };
  }

  const quote = async (rider: Session, body: Record<string, unknown> = {}) =>
    (
      await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, ...body })
        .expect(200)
    ).body;

  async function order(
    rider: Session,
    q: { quoteId: string },
    over: Record<string, unknown> = {},
    status = 201,
  ) {
    const res = await api(app, rider.accessToken)
      .post('/v1/rides')
      .send({
        quoteId: q.quoteId,
        class: 'economy',
        clientRequestId: randomUUID(),
        ...over,
      })
      .expect(status);
    return res.body;
  }

  /** Assigned by an operator, then the driver takes it to the end. */
  async function complete(rideId: string) {
    await admin.post(`/v1/admin/rides/${rideId}/assign`).send({ driverId: driver.id }).expect(200);
    const current = await driver.http.get(`/v1/driver/rides/${rideId}`).expect(200);
    await driver.http.post(`/v1/driver/rides/${rideId}/arrive`).expect(200);
    await driver.http.post(`/v1/driver/rides/${rideId}/start`).send({}).expect(200);
    const done = await driver.http.post(`/v1/driver/rides/${rideId}/complete`).expect(200);
    return { before: current.body, done: done.body };
  }

  const ledger = (rideId: string) =>
    db()
      .selectFrom('driver_ledger')
      .select(['kind', 'amount'])
      .where('ride_id', '=', rideId)
      .orderBy('kind')
      .execute();

  describe('promo codes', () => {
    it('describes a code in the app’s language: Russian when written, else the Uzbek text', async () => {
      const both = await promo({ descriptionRu: 'Осенняя акция' });
      // a smaller discount: the quote picks `both`
      const uzOnly = await promo({ value: 10 });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      await http.post('/v1/promos').send({ code: both.code }).expect(200);
      await http.post('/v1/promos').send({ code: uzOnly.code }).expect(200);
      const byCode = (wallet: { promos: { code: string; description: string | null }[] }) =>
        Object.fromEntries(wallet.promos.map((p) => [p.code, p.description]));

      const ru = await http.get('/v1/promos').set('Accept-Language', 'ru').expect(200);
      expect(byCode(ru.body)).toEqual({
        [both.code]: 'Осенняя акция',
        [uzOnly.code]: 'Kuzgi aksiya',
      });
      const uz = await http.get('/v1/promos').set('Accept-Language', 'uz').expect(200);
      expect(byCode(uz.body)).toEqual({
        [both.code]: 'Kuzgi aksiya',
        [uzOnly.code]: 'Kuzgi aksiya',
      });
      // the quote names the code it applies the same way
      const q = await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .set('Accept-Language', 'ru')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      expect(q.body.discounts.classes.economy.promo.description).toBe('Осенняя акция');

      // operators (the panel is Uzbek) see both as written and may edit either
      const listed = (await admin.get(`/v1/admin/promos/${both.id}`).expect(200)).body;
      expect(listed).toMatchObject({ description: 'Kuzgi aksiya', descriptionRu: 'Осенняя акция' });
      await admin
        .patch(`/v1/admin/promos/${both.id}`)
        .send({ ...listed, descriptionRu: null })
        .expect(200);
      const after = await http.get('/v1/promos').set('Accept-Language', 'ru').expect(200);
      expect(byCode(after.body)[both.code]).toBe('Kuzgi aksiya');
    });

    it('saves a code typed in any case, shows the discount on the quote, keeps the driver whole', async () => {
      const p = await promo();
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const added = await http
        .post('/v1/promos')
        .send({ code: ` ${p.code.toLowerCase()} ` })
        .expect(200);
      expect(added.body.added).toEqual({ kind: 'promo', code: p.code });
      expect(added.body.wallet.promos[0]).toMatchObject({
        code: p.code,
        usable: true,
        kind: 'percent',
        value: 20,
        description: 'Kuzgi aksiya',
      });

      const q = await quote(rider);
      expect(q.discounts.classes.economy).toMatchObject({
        promo: { id: p.id, source: 'code', code: p.code, amount: 1400 },
        credit: 0,
        total: 1400,
        fare: FARE,
        pays: 5600,
      });
      // 20% of comfort's 8 800
      expect(q.discounts.classes.comfort).toMatchObject({ total: 1700, pays: 7100 });

      // after the launch promo: the commission is taken on the full fare (5% of 7 000)
      app.get(BusinessCalendar).pin(new Date('2027-01-13T12:00:00+05:00'));
      const ride = await order(rider, q, { promoId: p.id });
      expect(ride.fare).toMatchObject({
        quoted: FARE,
        discount: 1400,
        pays: 5600,
        promo: { code: p.code, amount: 1400 },
      });
      const { before, done } = await complete(ride.id).finally(() =>
        app.get(BusinessCalendar).pin(new Date(process.env.TEST_CALENDAR_AT!)),
      );
      // the driver takes the discounted cash and sees what the platform pays
      expect(before.collectCash).toBe(5600);
      expect(before.discount).toMatchObject({ amount: 1400, compensation: 1400 });
      expect(done.fare.total).toBe(FARE);
      // the platform pays the discount onto the balance; tax on the full fare (1% of 7 000)
      expect(await ledger(ride.id)).toEqual([
        { kind: 'commission', amount: -350 },
        { kind: 'promo_compensation', amount: 1400 },
        { kind: 'tax', amount: -70 },
      ]);
      const tax = await db()
        .selectFrom('tax_withholdings')
        .select(['base_amount', 'amount'])
        .where('ride_id', '=', ride.id)
        .executeTakeFirstOrThrow();
      expect(tax).toEqual({ base_amount: FARE, amount: 70 });
      // the receipt: the full price, the promo as a discount, the cash the rider paid
      await app.get(FiscalService).issue({ rideId: ride.id });
      const receipt = await db()
        .selectFrom('fiscal_receipts')
        .select('payload')
        .where('ride_id', '=', ride.id)
        .executeTakeFirstOrThrow();
      expect(receipt.payload).toMatchObject({
        items: [{ price: FARE * 100, discount: 1400 * 100, other: 0 }],
        receivedCash: 5600 * 100,
        receivedCard: 0,
      });
      // the rider's view and history say what was paid
      const view = await http.get(`/v1/rides/${ride.id}`).expect(200);
      expect(view.body.fare).toMatchObject({ total: FARE, riderTotal: 5600, discount: 1400 });
      const history = await http.get('/v1/rides').expect(200);
      expect(history.body.items[0].fare).toMatchObject({ discount: 1400, pays: 5600 });
      // the code was for one ride: used now
      const wallet = await http.get('/v1/promos').expect(200);
      expect(wallet.body.promos[0]).toMatchObject({
        usable: false,
        reason: 'Siz bu promokoddan foydalanib bo‘lgansiz',
      });
      const earnings = await driver.http.get('/v1/driver/earnings').expect(200);
      expect(earnings.body.promoCompensation).toBeGreaterThanOrEqual(1400);
    });

    it('explains in Uzbek why a code does not apply', async () => {
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      const unknown = await http.post('/v1/promos').send({ code: 'NOSUCHCODE1' }).expect(404);
      expect(unknown.body.message).toBe('Bunday promokod topilmadi');
      const expired = await promo({ validUntil: new Date(Date.now() - 60_000).toISOString() });
      const r1 = await http.post('/v1/promos').send({ code: expired.code }).expect(409);
      expect(r1.body).toMatchObject({ message: 'Promokod muddati tugagan', reason: 'expired' });
      const off = await promo({ isActive: false });
      expect(
        (await http.post('/v1/promos').send({ code: off.code }).expect(409)).body.message,
      ).toBe('Bu promokod faol emas');
      const bad = await http.post('/v1/promos').send({ code: 'a!' }).expect(400);
      expect(bad.body.statusCode).toBe(400);
      // an existing but unusable code counts as a miss like an unknown one: after ten
      // misses in an hour the rider is blocked, so nobody probes which codes exist
      const prober = api(app, (await signIn(app)).accessToken);
      for (let i = 0; i < 10; i++) {
        await prober.post('/v1/promos').send({ code: expired.code }).expect(409);
      }
      const blocked = await prober.post('/v1/promos').send({ code: off.code }).expect(429);
      expect(blocked.body.message).toBe(
        'Noto‘g‘ri kod ko‘p marta kiritildi. Bir soatdan keyin qayta urinib ko‘ring',
      );

      // a comfort-only code: no discount on economy, with the reason; comfort gets it
      const comfort = await promo({ classes: ['comfort'], kind: 'fixed', value: 3000 });
      await http.post('/v1/promos').send({ code: comfort.code }).expect(200);
      const q = await quote(rider);
      expect(q.discounts.classes.economy).toMatchObject({
        promo: null,
        promoNote: 'Promokod «Ekonom» sinfi uchun emas',
        pays: FARE,
      });
      expect(q.discounts.classes.comfort.promo).toMatchObject({ id: comfort.id, amount: 3000 });
      // ordering economy with it anyway is refused, not silently charged in full
      const refused = await order(rider, q, { promoId: comfort.id }, 409);
      expect(refused).toMatchObject({
        message: 'Promokod «Ekonom» sinfi uchun emas',
        reason: 'class',
      });

      // a minimum fare
      const big = await promo({ minFare: 20_000 });
      const other = await signIn(app);
      await api(app, other.accessToken).post('/v1/promos').send({ code: big.code }).expect(200);
      const q2 = await quote(other);
      expect(q2.discounts.classes.economy.promoNote).toMatch(/so‘mdan qimmat safarlar uchun$/);

      // promo codes are not for rides for later
      const later = await quote(rider, {
        scheduledFor: new Date(Date.now() + 2 * 3600_000).toISOString(),
      });
      expect(later.discounts).toBeNull();
      await order(rider, later, { promoId: comfort.id, class: 'comfort' }, 400);
    });

    it('never lets two riders use the last use of a code at once', async () => {
      const p = await promo({ usageLimit: 1 });
      const riders = await Promise.all([signIn(app), signIn(app), signIn(app)]);
      for (const r of riders) {
        await api(app, r.accessToken).post('/v1/promos').send({ code: p.code }).expect(200);
      }
      const quotes = await Promise.all(riders.map((r) => quote(r)));
      const results = await Promise.all(
        riders.map((r, i) =>
          api(app, r.accessToken).post('/v1/rides').send({
            quoteId: quotes[i].quoteId,
            class: 'economy',
            clientRequestId: randomUUID(),
            promoId: p.id,
          }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.message).toBe('Promokodning limiti tugagan');
      }
      const reserved = await db()
        .selectFrom('ride_discounts')
        .select('ride_id')
        .where('promo_id', '=', p.id)
        .execute();
      expect(reserved).toHaveLength(1);
      // the winner cancels: the use comes back and someone else may take it
      const winner = results.findIndex((r) => r.status === 201);
      await api(app, riders[winner]!.accessToken)
        .post(`/v1/rides/${results[winner]!.body.id}/cancel`)
        .send({})
        .expect(200);
      const loser = riders[(winner + 1) % 3]!;
      const again = await quote(loser);
      expect(again.discounts.classes.economy.promo.id).toBe(p.id);
      await order(loser, again, { promoId: p.id });
    });

    it('charges a card ride the discounted fare and credits the driver the full fare', async () => {
      const p = await promo({ kind: 'fixed', value: 2000 });
      const rider = await signIn(app);
      await api(app, rider.accessToken).post('/v1/promos').send({ code: p.code }).expect(200);
      const q = await quote(rider);
      const ride = await order(rider, q, { promoId: p.id, paymentMethod: 'card' });
      expect(ride.payment).toMatchObject({ amount: 5000, status: 'pending' });
      await payWithPayme(app, ride.payment.id, 5000);
      const { before } = await complete(ride.id);
      expect(before.collectCash).toBe(0);
      expect(before.discount).toMatchObject({ amount: 2000, compensation: 0 });
      // the card fare is the full fare: no separate compensation
      expect(await ledger(ride.id)).toEqual([
        { kind: 'card_fare', amount: FARE },
        { kind: 'tax', amount: -70 },
      ]);
      await app.get(FiscalService).issue({ rideId: ride.id });
      const receipt = await db()
        .selectFrom('fiscal_receipts')
        .select('payload')
        .where('ride_id', '=', ride.id)
        .executeTakeFirstOrThrow();
      expect(receipt.payload).toMatchObject({
        items: [{ price: FARE * 100, discount: 2000 * 100 }],
        receivedCash: 0,
        receivedCard: 5000 * 100,
      });
    });

    it('a cancelled card ride refunds what was charged and gives the code back', async () => {
      const p = await promo({ kind: 'fixed', value: 1000 });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      await http.post('/v1/promos').send({ code: p.code }).expect(200);
      const ride = await order(rider, await quote(rider), { promoId: p.id, paymentMethod: 'card' });
      await payWithPayme(app, ride.payment.id, 6000);
      const cancelled = await http.post(`/v1/rides/${ride.id}/cancel`).send({}).expect(200);
      expect(cancelled.body.payment).toMatchObject({ amount: 6000, status: 'refund_pending' });
      expect(cancelled.body.fare).toMatchObject({ discount: 0, pays: FARE, promo: null });
      const wallet = await http.get('/v1/promos').expect(200);
      expect(wallet.body.promos[0]).toMatchObject({ usable: true, usesLeft: 1 });
    });

    it('still collects an owed cancellation fee on a discounted cash ride', async () => {
      const p = await promo({ kind: 'fixed', value: 1000 });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);
      // an earlier cash ride cancelled late: 3 000 owed to the driver who waited
      const first = await order(rider, await quote(rider));
      await http.post(`/v1/rides/${first.id}/cancel`).send({}).expect(200);
      await db()
        .updateTable('rides')
        .set({ cancellation_fee: 3000, fee_status: 'owed', driver_id: driver.id })
        .where('id', '=', first.id)
        .execute();
      await http.post('/v1/promos').send({ code: p.code }).expect(200);
      const q = await quote(rider);
      expect(q.owedFee.amount).toBe(3000);
      const ride = await order(rider, q, { promoId: p.id });
      const { before } = await complete(ride.id);
      // fare less the discount, plus the owed fee
      expect(before.collectCash).toBe(FARE - 1000 + 3000);
      expect(await ledger(ride.id)).toEqual([
        { kind: 'cancel_fee_collected', amount: -3000 },
        { kind: 'promo_compensation', amount: 1000 },
        { kind: 'tax', amount: -70 },
      ]);
    });
  });

  describe('referrals and ride credit', () => {
    async function invite(referrer: Session, invitee: Session, deviceId: string | null = null) {
      const wallet = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      const code = wallet.body.referral.code as string;
      const res = await api(app, invitee.accessToken).post('/v1/promos').send({ code, deviceId });
      return { code, res };
    }

    it('gives the invitee the welcome discount and the referrer ride credit after the first ride', async () => {
      const referrer = await signIn(app);
      const invitee = await signIn(app);
      const wallet = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(wallet.body.referral).toMatchObject({
        enabled: true,
        code: expect.stringMatching(/^[A-Z2-9]{6}$/),
        deepLink: `sfftaxi://invite/${wallet.body.referral.code}`,
        url: `https://taxi.sff.uz/invite/${wallet.body.referral.code}`,
        referrerBonus: 10_000,
        invited: 0,
      });
      expect(wallet.body.referral.shareText).toContain(wallet.body.referral.code);
      // the same code every time
      const again = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(again.body.referral.code).toBe(wallet.body.referral.code);

      const { res } = await invite(referrer, invitee, `device-${randomUUID()}`);
      expect(res.status).toBe(200);
      expect(res.body.added.kind).toBe('referral');
      expect(res.body.wallet).toMatchObject({
        invitedBy: { status: 'pending', welcomeRidesLeft: 1 },
        canEnterReferral: false,
      });

      const q = await quote(invitee);
      expect(q.discounts.classes.economy).toMatchObject({
        promo: { source: 'referral', amount: 3500 },
        pays: 3500,
      });
      const ride = await order(invitee, q, { promoId: q.discounts.classes.economy.promo.id });
      expect(ride.fare.pays).toBe(3500);
      await complete(ride.id);

      const after = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(after.body.credit.balance).toBe(10_000);
      expect(after.body.referral).toMatchObject({ invited: 1, rewarded: 1, earned: 10_000 });
      const credits = await api(app, referrer.accessToken).get('/v1/promos/credits').expect(200);
      expect(credits.body.items[0]).toMatchObject({ kind: 'referral_bonus', amount: 10_000 });
      // the referrer hears of it (push from the outbox)
      const me = await api(app, referrer.accessToken).get('/v1/me').expect(200);
      const outbox = await db()
        .selectFrom('outbox')
        .select('payload')
        .where('topic', '=', 'promo.referral_rewarded')
        .execute();
      expect(outbox.map((o) => o.payload)).toContainEqual(
        expect.objectContaining({ referrerId: me.body.id, amount: 10_000 }),
      );
      // the welcome discount was for one ride
      const next = await quote(invitee);
      expect(next.discounts).toMatchObject({ classes: null });

      // the referrer spends the credit: at most half of the fare, given back on a cancel
      const rq = await quote(referrer);
      expect(rq.discounts.creditBalance).toBe(10_000);
      expect(rq.discounts.classes.economy).toMatchObject({ promo: null, credit: 3500, pays: 3500 });
      const spent = await order(referrer, rq, { useCredit: true });
      expect(spent.fare).toMatchObject({ credit: 3500, pays: 3500 });
      const mid = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(mid.body.credit.balance).toBe(6500);
      await api(app, referrer.accessToken)
        .post(`/v1/rides/${spent.id}/cancel`)
        .send({})
        .expect(200);
      const back = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(back.body.credit.balance).toBe(10_000);
      // spent on a completed cash ride: the driver is credited what the rider did not pay
      const used = await order(referrer, await quote(referrer), { useCredit: true });
      await complete(used.id);
      expect(await ledger(used.id)).toContainEqual({ kind: 'promo_compensation', amount: 3500 });
      await app.get(FiscalService).issue({ rideId: used.id });
      const receipt = await db()
        .selectFrom('fiscal_receipts')
        .select('payload')
        .where('ride_id', '=', used.id)
        .executeTakeFirstOrThrow();
      expect(receipt.payload).toMatchObject({
        items: [{ discount: 0, other: 3500 * 100 }],
        receivedCash: 3500 * 100,
      });
    });

    it('refuses self-referral, a second code, a used device and riders who already rode', async () => {
      const referrer = await signIn(app);
      const own = await invite(referrer, referrer);
      expect(own.res.status).toBe(400);
      expect(own.res.body.message).toBe('O‘zingizning taklif kodingizni kiritib bo‘lmaydi');

      const device = `device-${randomUUID()}`;
      const first = await signIn(app);
      expect((await invite(referrer, first, device)).res.status).toBe(200);
      const twice = await invite(referrer, first);
      expect(twice.res.status).toBe(409);
      expect(twice.res.body.message).toBe('Siz taklif kodini allaqachon kiritgansiz');
      const sameDevice = await invite(referrer, await signIn(app), device);
      expect(sameDevice.res.body.message).toBe('Bu qurilmadan taklif kodi allaqachon kiritilgan');

      // the referrer's own phone with another SIM card: the invitation was opened on it
      const phone = `device-${randomUUID()}`;
      await api(app, referrer.accessToken).get(`/v1/promos?deviceId=${phone}`).expect(200);
      const selfOther = await invite(referrer, await signIn(app), phone);
      expect(selfOther.res.status).toBe(409);
      expect(selfOther.res.body.message).toBe('O‘z kodingizni boshqa raqamdan kiritib bo‘lmaydi');

      // a rider who already completed a ride
      const rode = await signIn(app);
      const r = await order(rode, await quote(rode));
      await complete(r.id);
      const late = await invite(referrer, rode);
      expect(late.res.body.message).toBe('Taklif kodi faqat birinchi safargacha kiritiladi');
    });

    it('caps rewarded referrals per month and lets operators revoke one', async () => {
      await admin
        .put('/v1/admin/settings/promo')
        .send({ ...DEFAULT_PROMO, monthly_reward_cap: 1 })
        .expect(200);
      const referrer = await signIn(app);
      const a = await signIn(app);
      const b = await signIn(app);
      await invite(referrer, a);
      await invite(referrer, b);
      for (const s of [a, b]) {
        const q = await quote(s);
        const ride = await order(s, q, { promoId: q.discounts.classes.economy.promo.id });
        await complete(ride.id);
      }
      const list = await admin
        .get(`/v1/admin/referrals?q=${encodeURIComponent(referrer.phone.slice(-9))}`)
        .expect(200);
      const statuses = list.body.items.map((x: { status: string }) => x.status).sort();
      expect(statuses).toEqual(['capped', 'rewarded']);
      const wallet = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(wallet.body.credit.balance).toBe(10_000);

      const rewarded = list.body.items.find((x: { status: string }) => x.status === 'rewarded');
      await admin
        .post(`/v1/admin/referrals/${rewarded.id}/revoke`)
        .send({ note: 'Bir oila, bitta telefon' })
        .expect(200);
      const after = await api(app, referrer.accessToken).get('/v1/promos').expect(200);
      expect(after.body.credit.balance).toBe(0);
      await admin
        .post(`/v1/admin/referrals/${rewarded.id}/revoke`)
        .send({ note: 'Yana' })
        .expect(409);
    });
  });

  describe('operators', () => {
    it('lists codes with their use and edits them', async () => {
      const p = await promo({ kind: 'fixed', value: 1500 });
      const rider = await signIn(app);
      await api(app, rider.accessToken).post('/v1/promos').send({ code: p.code }).expect(200);
      const ride = await order(rider, await quote(rider), { promoId: p.id });
      await complete(ride.id);
      const one = await admin.get(`/v1/admin/promos/${p.id}`).expect(200);
      expect(one.body).toMatchObject({
        code: p.code,
        stats: { redeemed: 1, reserved: 0, discountTotal: 1500, saved: 1 },
        rides: [{ rideId: ride.id, discount: 1500, status: 'redeemed' }],
      });
      const list = await admin.get(`/v1/admin/promos?q=${p.code}`).expect(200);
      expect(list.body[0].stats.redeemed).toBe(1);
      // switched off: riders cannot add it any more
      const edited = await admin
        .patch(`/v1/admin/promos/${p.id}`)
        .send({ code: p.code, kind: 'fixed', value: 1500, isActive: false })
        .expect(200);
      expect(edited.body.isActive).toBe(false);
      const late = await signIn(app);
      await api(app, late.accessToken).post('/v1/promos').send({ code: p.code }).expect(409);
      // a duplicate code, a percent without a cap
      await admin
        .post('/v1/admin/promos')
        .send({ code: p.code, kind: 'fixed', value: 1000 })
        .expect(409);
      const noCap = await admin
        .post('/v1/admin/promos')
        .send({ code: 'NOCAP123', kind: 'percent', value: 10 })
        .expect(400);
      expect(JSON.stringify(noCap.body)).toContain('eng ko‘p chegirma');
      // the ride detail shows the discount
      const detail = await admin.get(`/v1/admin/rides/${ride.id}`).expect(200);
      expect(detail.body.discount).toMatchObject({
        promo: { code: p.code, amount: 1500 },
        status: 'redeemed',
      });
    });
  });
});
