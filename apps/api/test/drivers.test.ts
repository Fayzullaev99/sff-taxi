import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import {
  ALL_DOCUMENTS,
  api,
  application,
  createDriver,
  createTestApp,
  GULISTON,
  signIn,
  signInAdmin,
  uniquePhone,
} from './helpers.js';

describe('drivers', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
  });
  afterAll(() => app.close());

  async function applicant() {
    const session = await signIn(app, uniquePhone(), 'driver');
    return api(app, session.accessToken);
  }

  async function uploadAll(http: ReturnType<typeof api>) {
    for (const kind of ALL_DOCUMENTS) {
      await http
        .put(`/v1/driver/documents/${kind}`)
        .send({ url: `https://files.example.uz/${kind}.jpg` })
        .expect(200);
    }
  }

  describe('application', () => {
    it('takes an application and shows what is still missing', async () => {
      const http = await applicant();
      const res = await http
        .post('/v1/driver/application')
        .send(application({ fullName: 'Dilshod Rahimov' }, { plate: '20 a 777 bc' }))
        .expect(200);
      expect(res.body).toMatchObject({
        fullName: 'Dilshod Rahimov',
        status: 'pending',
        isOnline: false,
        vehicle: { plate: '20A777BC', plateFormatted: '20 A 777 BC', class: 'economy', seats: 4 },
        missingDocuments: [...ALL_DOCUMENTS],
        balance: 0,
      });
      expect(res.body.blockers).toContain('Arizangiz operator tomonidan ko‘rib chiqilmoqda');
      expect(res.body.priority.score).toBe(91);

      const me = await http.get('/v1/me').expect(200);
      expect(me.body.driver).toMatchObject({ status: 'pending', isOnline: false });
      const rider = await signIn(app);
      expect((await api(app, rider.accessToken).get('/v1/me').expect(200)).body.driver).toBeNull();
      await api(app, rider.accessToken).get('/v1/driver/me').expect(404);

      // corrections are allowed while waiting
      const fixed = await http
        .post('/v1/driver/application')
        .send(application({}, { plate: '20 a 778 bc', colour: 'qora' }))
        .expect(200);
      expect(fixed.body.vehicle).toMatchObject({ plate: '20A778BC', colour: 'qora' });
    });

    it('enforces Resolution 200: age 21+, 3 years of experience, car rules', async () => {
      const http = await applicant();
      const young = await http
        .post('/v1/driver/application')
        .send(application({ birthDate: '2008-01-01', licenceIssuedOn: '2025-01-01' }))
        .expect(400);
      expect(young.body.issues.map((i: { path: string }) => i.path)).toEqual([
        'birthDate',
        'licenceIssuedOn',
      ]);
      const van = await http
        .post('/v1/driver/application')
        .send(application({}, { model: 'Damas', year: 2008, seats: 6 }))
        .expect(400);
      expect(van.body.issues.map((i: { path: string }) => i.path)).toEqual([
        'vehicle.model',
        'vehicle.year',
        'vehicle.seats',
      ]);
      const comfort = await http
        .post('/v1/driver/application')
        .send(application({}, { class: 'comfort', year: 2018 }))
        .expect(400);
      expect(comfort.body.message).toMatch(/Komfort/);
      const noCard = await http
        .post('/v1/driver/application')
        .send(application({ licenceCardExpiresOn: '2020-01-01' }))
        .expect(400);
      expect(noCard.body.message).toMatch(/Litsenziya kartochkasi/);

      // format problems come from validation, in Uzbek
      const bad = await http
        .post('/v1/driver/application')
        .send(application({ pinfl: '123', licenceNumber: 'X1' }, { plate: '99 Z 1 Q' }))
        .expect(400);
      const paths = bad.body.issues.map((i: { path: string }) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['pinfl', 'licenceNumber', 'vehicle.plate']));
    });

    it('refuses a plate, licence or PINFL that another driver already has', async () => {
      const first = await applicant();
      const body = application();
      await first.post('/v1/driver/application').send(body).expect(200);
      const second = await applicant();
      const dup = await second
        .post('/v1/driver/application')
        .send(application({}, { plate: body.vehicle.plate }))
        .expect(409);
      expect(dup.body.constraint).toBe('vehicles_plate_key');
      await second
        .post('/v1/driver/application')
        .send(application({ pinfl: body.pinfl }))
        .expect(409);
    });
  });

  describe('verification', () => {
    it('approves only with every document, then the driver can work', async () => {
      const http = await applicant();
      const { body } = await http.post('/v1/driver/application').send(application()).expect(200);
      const id = body.id as string;

      const missing = await admin.post(`/v1/admin/drivers/${id}/approve`).send({}).expect(422);
      expect(missing.body.message).toMatch(/Hujjatlar yetishmaydi/);

      await http
        .put('/v1/driver/documents/insurance')
        .send({ url: 'https://files.example.uz/i.jpg', expiresOn: '2020-01-01' })
        .expect(400);
      await http
        .put('/v1/driver/documents/unknown')
        .send({ url: 'https://x.uz/a.jpg' })
        .expect(400);
      await uploadAll(http);

      await http.post('/v1/driver/shift').send({ online: true }).expect(403);
      // Resolution 200: only a licence card checked in the Ministry's registry
      const unchecked = await admin.post(`/v1/admin/drivers/${id}/approve`).send({}).expect(422);
      expect(unchecked.body.message).toMatch(/Transport vazirligi/);
      const checked = await admin
        .post(`/v1/admin/drivers/${id}/licence`)
        .send({ result: 'valid', note: 'Reyestrda bor, 2030 yilgacha', expiresOn: '2030-01-01' })
        .expect(200);
      expect(checked.body.licenceCard.verification).toBe('valid');
      expect(checked.body.licenceChecks[0]).toMatchObject({ source: 'manual', result: 'valid' });
      const approved = await admin.post(`/v1/admin/drivers/${id}/approve`).send({}).expect(200);
      expect(approved.body).toMatchObject({ status: 'active', missingDocuments: [] });
      expect(approved.body.history[0]).toMatchObject({ from: 'pending', to: 'active' });
      await admin.post(`/v1/admin/drivers/${id}/approve`).send({}).expect(409);

      const online = await http.post('/v1/driver/shift').send({ online: true }).expect(200);
      expect(online.body).toMatchObject({ isOnline: true, blockers: [] });
      // corrections after approval go through an operator
      await http.post('/v1/driver/application').send(application()).expect(409);
    });

    it('rejects with a reason the driver sees, and takes a corrected application back', async () => {
      const http = await applicant();
      const { body } = await http.post('/v1/driver/application').send(application()).expect(200);
      await admin.post(`/v1/admin/drivers/${body.id}/reject`).send({}).expect(400);
      await admin
        .post(`/v1/admin/drivers/${body.id}/reject`)
        .send({ reason: 'Guvohnoma surati o‘qilmaydi' })
        .expect(200);
      const me = await http.get('/v1/driver/me').expect(200);
      expect(me.body).toMatchObject({
        status: 'rejected',
        statusReason: 'Guvohnoma surati o‘qilmaydi',
      });
      expect(me.body.blockers[0]).toBe('Ariza rad etildi: Guvohnoma surati o‘qilmaydi');

      await http.post('/v1/driver/application').send(application()).expect(200);
      const back = await admin.get(`/v1/admin/drivers/${body.id}`).expect(200);
      expect(back.body.status).toBe('pending');
      expect(back.body.history.map((h: { to: string }) => h.to)).toEqual(['pending', 'rejected']);
    });

    it('blocks with a reason (ending the shift) and unblocks', async () => {
      const d = await createDriver(app);
      await admin
        .post(`/v1/admin/drivers/${d.id}/block`)
        .send({ reason: 'Yo‘lovchi shikoyati tekshirilmoqda' })
        .expect(200);
      const me = await d.http.get('/v1/driver/me').expect(200);
      expect(me.body).toMatchObject({ status: 'blocked', isOnline: false });
      const refused = await d.http.post('/v1/driver/shift').send({ online: true }).expect(403);
      expect(refused.body.message).toBe(
        'Hisobingiz bloklangan: Yo‘lovchi shikoyati tekshirilmoqda',
      );
      await d.http.post('/v1/driver/location').send(GULISTON).expect(403);

      await admin
        .post(`/v1/admin/drivers/${d.id}/unblock`)
        .send({ reason: 'Tekshirildi' })
        .expect(200);
      await d.http.post('/v1/driver/shift').send({ online: true }).expect(200);
      await d.http.post('/v1/driver/shift').send({ online: false }).expect(200);
    });

    it('lets operators find drivers and re-class a car within the rules', async () => {
      const d = await createDriver(app, { online: false, vehicle: { year: 2023 } });
      const view = await admin.get(`/v1/admin/drivers/${d.id}`).expect(200);
      const plate = view.body.vehicle.plate as string;
      const found = await admin
        .get(`/v1/admin/drivers?status=active&q=${encodeURIComponent(plate.slice(0, 5))}`)
        .expect(200);
      expect(found.body.map((r: { id: string }) => r.id)).toContain(d.id);
      expect(
        (await admin.get('/v1/admin/drivers?status=pending').expect(200)).body.every(
          (r: { status: string }) => r.status === 'pending',
        ),
      ).toBe(true);

      const comfort = await admin
        .patch(`/v1/admin/drivers/${d.id}/vehicle`)
        .send({ class: 'comfort' })
        .expect(200);
      expect(comfort.body.vehicle.class).toBe('comfort');
      await admin.patch(`/v1/admin/drivers/${d.id}/vehicle`).send({ features: [] }).expect(400);

      const rider = await signIn(app);
      await api(app, rider.accessToken).get('/v1/admin/drivers').expect(403);
      await api(app, rider.accessToken)
        .post(`/v1/admin/drivers/${d.id}/block`)
        .send({ reason: 'xxx' })
        .expect(403);
    });
  });

  describe('shift and location', () => {
    it('keeps a driver below the minimum balance offline until topped up', async () => {
      const d = await createDriver(app, { online: false });
      await admin
        .post(`/v1/admin/billing/drivers/${d.id}/ledger`)
        .send({ kind: 'adjustment', amount: -15_000 })
        .expect(400);
      await admin
        .post(`/v1/admin/billing/drivers/${d.id}/ledger`)
        .send({ kind: 'adjustment', amount: -15_000, note: 'Naqd komissiya qarzi' })
        .expect(201);
      const refused = await d.http.post('/v1/driver/shift').send({ online: true }).expect(403);
      expect(refused.body).toMatchObject({ balance: -15_000, minBalance: -10_000 });
      expect((await d.http.get('/v1/driver/me').expect(200)).body.blockers).toContain(
        'Balans juda past',
      );

      const topped = await admin
        .post(`/v1/admin/billing/drivers/${d.id}/ledger`)
        .send({ kind: 'topup', amount: 20_000 })
        .expect(201);
      expect(topped.body).toMatchObject({ balance: 5000, canWork: true });
      await d.http.post('/v1/driver/shift').send({ online: true }).expect(200);
    });

    it('filters bad GPS fixes and keeps the last good one', async () => {
      const d = await createDriver(app);
      const inaccurate = await d.http
        .post('/v1/driver/location')
        .send({ ...GULISTON, accuracy: 500 })
        .expect(422);
      expect(inaccurate.body.reason).toBe('inaccurate');
      // Bukhara, 400 km away
      const outside = await d.http
        .post('/v1/driver/location')
        .send({ lat: 39.77, lng: 64.43 })
        .expect(422);
      expect(outside.body.reason).toBe('outside');
      // 5 km north a second later
      const jump = await d.http
        .post('/v1/driver/location')
        .send({ lat: GULISTON.lat + 0.045, lng: GULISTON.lng })
        .expect(422);
      expect(jump.body.reason).toBe('too_fast');
      const moved = { lat: GULISTON.lat + 0.001, lng: GULISTON.lng, heading: 90 };
      await d.http.post('/v1/driver/location').send(moved).expect(204);
      const view = await admin.get(`/v1/admin/drivers/${d.id}`).expect(200);
      expect(view.body.location).toMatchObject({ lat: moved.lat, lng: moved.lng, heading: 90 });
    });
  });

  describe('balance and passes', () => {
    it('sells passes from the balance, back to back', async () => {
      const d = await createDriver(app, { online: false });
      const poor = await d.http.post('/v1/driver/passes').send({ kind: 'day' }).expect(409);
      expect(poor.body.message).toMatch(/yetarli emas/);

      await admin
        .post(`/v1/admin/billing/drivers/${d.id}/ledger`)
        .send({ kind: 'topup', amount: 70_000 })
        .expect(201);
      const day = await d.http.post('/v1/driver/passes').send({ kind: 'day' }).expect(201);
      expect(day.body).toMatchObject({ kind: 'day', price: 9000, balance: 61_000 });
      const week = await d.http.post('/v1/driver/passes').send({ kind: 'week' }).expect(201);
      // the week starts when the day pass ends
      expect(week.body.startsAt).toBe(day.body.endsAt);
      expect(week.body.balance).toBe(11_000);

      const balance = await d.http.get('/v1/driver/balance').expect(200);
      expect(balance.body).toMatchObject({
        balance: 11_000,
        canWork: true,
        activePass: { kind: 'day' },
      });
      expect(
        balance.body.entries.map((e: { kind: string; amount: number }) => [e.kind, e.amount]),
      ).toEqual([
        ['pass', -50_000],
        ['pass', -9000],
        ['topup', 70_000],
      ]);
      expect((await d.http.get('/v1/driver/passes').expect(200)).body).toHaveLength(2);
      const ledger = await admin.get(`/v1/admin/billing/drivers/${d.id}/ledger`).expect(200);
      expect(ledger.body.items).toHaveLength(3);
    });

    it('never lets the ledger be edited or deleted, even by the API’s database role', async () => {
      const d = await createDriver(app, { online: false, topup: 5000 });
      const db = app.get(Database).kysely;
      await expect(
        sql`update driver_ledger set amount = 1000000 where driver_id = ${d.id}`.execute(db),
      ).rejects.toThrow(/permission denied|append-only/);
      await expect(
        sql`delete from driver_ledger where driver_id = ${d.id}`.execute(db),
      ).rejects.toThrow(/permission denied|append-only/);
      expect((await d.http.get('/v1/driver/balance').expect(200)).body.balance).toBe(5000);
    });
  });
});
