import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import {
  type LicenceRegistry,
  type LicenceVerdict,
} from '../src/modules/drivers/licence-registry.js';
import { LicenceHandler } from '../src/modules/drivers/licence.handler.js';
import type { FiscalProvider, IssuedReceipt } from '../src/modules/fiscal/fiscal-provider.js';
import { FiscalHandler } from '../src/modules/fiscal/fiscal.module.js';
import { FiscalService } from '../src/modules/fiscal/fiscal.service.js';
import type { ReceiptPayload } from '../src/modules/fiscal/receipt-payload.js';
import { DEFAULT_FISCAL, SettingsService } from '../src/modules/settings/settings.module.js';
import {
  ALL_DOCUMENTS,
  api,
  application,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  orderRide,
  signIn,
  signInAdmin,
  startPin,
} from './helpers.js';

/** An OFD that fails when told to, and remembers what it issued. */
class FakeOfd implements FiscalProvider {
  readonly name = 'fake-ofd';
  down = false;
  issued: ReceiptPayload[] = [];
  issue(payload: ReceiptPayload): Promise<IssuedReceipt | null> {
    if (this.down) return Promise.reject(new Error('OFD down'));
    this.issued.push(payload);
    return Promise.resolve({
      receiptId: `ofd-${this.issued.length}`,
      fiscalSign: '123456789012',
      url: `https://ofd.example.uz/check/${payload.receiptNumber}`,
    });
  }
}

describe('fiscal receipts and licence checks', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/fiscal').send(DEFAULT_FISCAL).expect(200);
    await app.close();
  });

  /** A cash ride driven to the end by `driver`. */
  async function completedRide(driver: DriverFixture) {
    const rider = await signIn(app);
    const { id } = await orderRide(app, rider, { pickup: GULISTON, dropoff: MID });
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
    const pin = await startPin(app, id);
    await driver.http.post(`/v1/driver/rides/${id}/start`).send({ pin }).expect(200);
    await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
    return { id, rider };
  }

  const outboxEvent = async (topic: string, match: (p: Record<string, unknown>) => boolean) => {
    const rows = await db
      .selectFrom('outbox')
      .select(['id', 'topic', 'payload', 'created_at', 'processed_at', 'attempts', 'last_error'])
      .where('topic', '=', topic)
      .execute();
    return rows.find((r) => match(r.payload))!;
  };

  describe('receipts', () => {
    it('prepares a receipt for every completed ride and keeps it while no OFD is connected', async () => {
      const driver = await createDriver(app, { online: false });
      const { id, rider } = await completedRide(driver);
      const event = await outboxEvent('fiscal.receipt_due', (p) => p.rideId === id);
      expect(event).toBeTruthy();

      // FISCAL_PROVIDER=none: prepared, not sent
      expect(await app.get(FiscalService).issue({ rideId: id })).toBe('skipped');
      expect(await app.get(FiscalService).issue({ rideId: id })).toBe('already');
      const receipt = await db
        .selectFrom('fiscal_receipts')
        .selectAll()
        .where('ride_id', '=', id)
        .executeTakeFirstOrThrow();
      const pinfl = (
        await db
          .selectFrom('drivers')
          .select('pinfl')
          .where('user_id', '=', driver.id)
          .executeTakeFirstOrThrow()
      ).pinfl;
      expect(receipt).toMatchObject({ provider: 'none', status: 'skipped', amount: 7000 });
      expect(receipt.payload).toMatchObject({
        receiptNumber: `R-${id}`,
        kind: 'ride',
        items: [
          {
            name: 'Taksi xizmati (yo‘lovchi tashish)',
            mxik: '00000000000000000',
            packageCode: '0000000',
            amount: 1000,
            price: 700_000,
            vatPercent: 0,
            vat: 0,
            commissionInfo: { pinfl },
          },
        ],
        receivedCash: 700_000,
        receivedCard: 0,
      });
      const view = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(view.body.receipt).toMatchObject({ status: 'skipped', url: null });
    });

    it('sends through the OFD, retrying through the outbox until it accepts, never twice', async () => {
      const ofd = new FakeOfd();
      const fiscal = new FiscalService(app.get(Database), app.get(SettingsService), ofd);
      const worker = new OutboxDispatcher(app.get(Database), [new FiscalHandler(fiscal)]);
      // the real codes, once confirmed with the tax authority
      await admin
        .put('/v1/admin/settings/fiscal')
        .send({ ...DEFAULT_FISCAL, mxik_code: '10112001001000000', package_code: '1510994' })
        .expect(200);
      const driver = await createDriver(app, { online: false });
      const { id, rider } = await completedRide(driver);
      const event = await outboxEvent('fiscal.receipt_due', (p) => p.rideId === id);
      // settle every other due event first, so the next claims are this one
      await db
        .updateTable('outbox')
        .set({ processed_at: new Date() })
        .where('processed_at', 'is', null)
        .where('id', '!=', event.id)
        .execute();

      ofd.down = true;
      await worker.runOnce();
      const failed = await outboxEvent('fiscal.receipt_due', (p) => p.rideId === id);
      expect(failed).toMatchObject({
        attempts: 1,
        last_error: 'fiscal: OFD down',
        processed_at: null,
      });
      const pending = await db
        .selectFrom('fiscal_receipts')
        .select(['status', 'attempts', 'last_error'])
        .where('ride_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(pending).toEqual({ status: 'pending', attempts: 1, last_error: 'OFD down' });

      // the OFD is back; the backoff is over
      ofd.down = false;
      await db
        .updateTable('outbox')
        .set({ next_attempt_at: new Date(Date.now() - 1000) })
        .where('id', '=', event.id)
        .execute();
      await worker.runOnce();
      expect(
        (await outboxEvent('fiscal.receipt_due', (p) => p.rideId === id)).processed_at,
      ).not.toBeNull();
      expect(ofd.issued).toHaveLength(1);
      expect(ofd.issued[0]!.items[0]).toMatchObject({
        mxik: '10112001001000000',
        packageCode: '1510994',
      });
      const view = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(view.body.receipt).toEqual({
        status: 'sent',
        url: `https://ofd.example.uz/check/R-${id}`,
        sentAt: expect.any(String),
      });
      // a redelivered event issues nothing more
      expect(await fiscal.issue({ rideId: id })).toBe('already');
      expect(ofd.issued).toHaveLength(1);
    });

    it('issues receipts for intercity seats too, and resends kept ones once an OFD is on', async () => {
      const driver = await createDriver(app, { online: false });
      const trip = await driver.http
        .post('/v1/driver/intercity/trips')
        .send({
          from: 'guliston',
          to: 'toshkent',
          departureAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          seats: 2,
        })
        .expect(201);
      const rider = await signIn(app);
      const booking = await api(app, rider.accessToken)
        .post(`/v1/intercity/trips/${trip.body.id}/bookings`)
        .send({ seats: 2, clientRequestId: randomUUID() })
        .expect(201);
      const base = `/v1/driver/intercity/trips/${trip.body.id}`;
      await driver.http.post(`${base}/boarding`).expect(200);
      await driver.http.post(`${base}/bookings/${booking.body.id}/board`).expect(200);
      await driver.http.post(`${base}/depart`).expect(200);
      await driver.http.post(`${base}/arrive`).expect(200);

      expect(await app.get(FiscalService).issue({ bookingId: booking.body.id })).toBe('skipped');
      const receipt = await db
        .selectFrom('fiscal_receipts')
        .select(['payload', 'amount'])
        .where('booking_id', '=', booking.body.id)
        .executeTakeFirstOrThrow();
      expect(receipt.amount).toBe(140_000);
      expect(receipt.payload).toMatchObject({
        kind: 'intercity',
        items: [
          { name: 'Shaharlararo yo‘lovchi tashish (o‘rindiq)', amount: 2000, price: 14_000_000 },
        ],
        extra: { from: 'Guliston', to: 'Toshkent' },
      });

      const kept = await admin.get('/v1/admin/fiscal/receipts?status=skipped').expect(200);
      expect(kept.body.length).toBeGreaterThanOrEqual(2);
      const resent = await admin
        .post('/v1/admin/fiscal/receipts/resend')
        .send({ status: 'skipped' })
        .expect(200);
      expect(resent.body.queued).toBeGreaterThanOrEqual(2);
      expect(
        (await admin.get('/v1/admin/fiscal/receipts?status=skipped').expect(200)).body,
      ).toEqual([]);
      // the codes are validated
      await admin
        .put('/v1/admin/settings/fiscal')
        .send({ ...DEFAULT_FISCAL, mxik_code: '123' })
        .expect(400);
    });
  });

  describe('licence cards', () => {
    /** An applicant with every document, not yet checked nor approved. */
    async function applicant(card?: string) {
      const session = await signIn(app, undefined, 'driver');
      const http = api(app, session.accessToken);
      const res = await http
        .post('/v1/driver/application')
        .send(application(card ? { licenceCardNumber: card } : {}))
        .expect(200);
      for (const kind of ALL_DOCUMENTS) {
        await http
          .put(`/v1/driver/documents/${kind}`)
          .send({ url: `https://files.example.uz/${kind}.jpg` })
          .expect(200);
      }
      return { id: res.body.id as string, http };
    }

    it('starts unverified and asks the registry; a manual registry leaves it to operators', async () => {
      const { id, http } = await applicant();
      const me = await http.get('/v1/driver/me').expect(200);
      expect(me.body.licenceCard.verification).toBe('unverified');
      expect(me.body.blockers).toContain('Litsenziya kartochkasi tekshirilmoqda');
      const requested = await outboxEvent(
        'driver.licence_check_requested',
        (p) => p.driverId === id,
      );
      expect(requested).toBeTruthy();

      // the Ministry's API (when there is one) answers through the same handler
      const verdicts: LicenceVerdict[] = [
        {
          result: 'valid',
          expiresOn: '2031-05-01',
          note: 'Reyestr: faol',
          raw: { status: 'ACTIVE' },
        },
      ];
      const registry: LicenceRegistry = {
        name: 'mintrans',
        verify: () => Promise.resolve(verdicts.shift() ?? null),
      };
      const handler = new LicenceHandler(app.get(Database), registry);
      await handler.handle({
        id: requested.id,
        topic: requested.topic,
        payload: requested.payload,
        createdAt: requested.created_at,
      });
      const view = await admin.get(`/v1/admin/drivers/${id}`).expect(200);
      expect(view.body.licenceCard.verification).toBe('valid');
      expect(view.body.licenceChecks[0]).toMatchObject({
        source: 'mintrans',
        result: 'valid',
        expiresOn: '2031-05-01',
      });
      await admin.post(`/v1/admin/drivers/${id}/approve`).send({}).expect(200);

      // a manual registry answers nothing: the driver stays in the operators' queue
      const other = await applicant();
      const manual = new LicenceHandler(app.get(Database), {
        name: 'manual',
        verify: () => Promise.resolve(null),
      });
      await manual.handle({
        id: uuidv7(),
        topic: 'driver.licence_check_requested',
        payload: { driverId: other.id },
        createdAt: new Date(),
      });
      expect((await admin.get(`/v1/admin/drivers/${other.id}`)).body.licenceCard.verification).toBe(
        'unverified',
      );
    });

    it('takes a driver whose card turns out invalid off the line, and re-checks a new card', async () => {
      const driver = await createDriver(app, { at: GULISTON });
      const invalid = await admin
        .post(`/v1/admin/drivers/${driver.id}/licence`)
        .send({ result: 'invalid', note: 'Reyestrda bekor qilingan' })
        .expect(200);
      expect(invalid.body).toMatchObject({
        isOnline: false,
        licenceCard: { verification: 'invalid' },
      });
      const refused = await driver.http.post('/v1/driver/shift').send({ online: true }).expect(403);
      expect(refused.body.message).toMatch(/tasdiqlanmagan/);

      // a rejected applicant brings a new card: it must be checked again
      const { id, http } = await applicant();
      await admin
        .post(`/v1/admin/drivers/${id}/licence`)
        .send({ result: 'valid', note: 'Reyestrda bor' })
        .expect(200);
      await admin.post(`/v1/admin/drivers/${id}/reject`).send({ reason: 'Surat xira' }).expect(200);
      const same = await http.get('/v1/driver/me').expect(200);
      expect(same.body.licenceCard.verification).toBe('valid');
      await http
        .post('/v1/driver/application')
        .send(application({ licenceCardNumber: `LK-${Date.now().toString().slice(-8)}` }))
        .expect(200);
      const again = await http.get('/v1/driver/me').expect(200);
      expect(again.body.licenceCard.verification).toBe('unverified');
    });
  });
});
