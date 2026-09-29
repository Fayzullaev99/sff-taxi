import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { DEFAULT_TARIFF } from '../src/lib/tariff.js';
import { PositionsJob } from '../src/modules/realtime/positions.job.js';
import type { RealtimeBus, RealtimeMessage } from '../src/modules/realtime/realtime.publisher.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  orderRide,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
  uniquePhone,
  startPin,
} from './helpers.js';

const near = (metres: number) => ({ lat: GULISTON.lat + metres / 110_574, lng: GULISTON.lng });

describe('rider app and operator panel gaps', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/tariff').send(DEFAULT_TARIFF).expect(200);
    await app.close();
  });

  /** A ride assigned to `driver` by an operator. */
  async function assigned(driver: DriverFixture, rider?: Session) {
    const who = rider ?? (await signIn(app));
    const { id } = await orderRide(app, who, { pickup: GULISTON, dropoff: MID });
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    return { id, rider: who };
  }

  describe('rider', () => {
    beforeEach(() => quiesce(app));

    it('shows the nearest free car per class on the quote', async () => {
      const rider = api(app, (await signIn(app)).accessToken);
      const none = await rider
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      expect(none.body.availability).toEqual({
        economy: { etaS: null, cars: 0 },
        comfort: { etaS: null, cars: 0 },
      });
      await createDriver(app, { at: near(600) });
      await createDriver(app, { at: near(1500), vehicle: { class: 'comfort', year: 2024 } });
      const some = await rider
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      // both cars can take an economy ride; only the comfort one a comfort ride
      expect(some.body.availability.economy.cars).toBe(2);
      expect(some.body.availability.comfort.cars).toBe(1);
      expect(some.body.availability.economy.etaS).toBeGreaterThan(0);
      expect(some.body.availability.comfort.etaS).toBeGreaterThan(
        some.body.availability.economy.etaS,
      );
    });

    it('shows the coming car’s ETA and trail, the ride’s own rules and whether it was rated', async () => {
      const driver = await createDriver(app, { at: near(2000) });
      const { id, rider } = await assigned(driver);
      // the driver drives towards the pickup
      await driver.http.post('/v1/driver/location').send(near(1900)).expect(204);
      await driver.http.post('/v1/driver/location').send(near(1850)).expect(204);
      // operators changed the tariff after the order: the ride keeps its own rules
      const changed = structuredClone(DEFAULT_TARIFF);
      changed.waiting.free_minutes = 5;
      changed.cancellation_fee = 5000;
      await admin.put('/v1/admin/settings/tariff').send(changed).expect(200);

      const view = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(view.body.rules).toEqual({
        freeWaitingMinutes: 2,
        waitingPerMinute: 500,
        cancellationFee: 3000,
      });
      expect(view.body.rated).toBe(false);
      expect(view.body.driverEta).toMatchObject({ source: 'estimate' });
      expect(view.body.driverEta.etaS).toBeGreaterThan(0);
      // the trail since the assignment, oldest first
      expect(view.body.trail.map((p: { lat: number }) => p.lat)).toEqual([
        near(1900).lat,
        near(1850).lat,
      ]);
      await admin.put('/v1/admin/settings/tariff').send(DEFAULT_TARIFF).expect(200);

      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      const pin = await startPin(app, id);
      await driver.http.post(`/v1/driver/rides/${id}/start`).send({ pin }).expect(200);
      await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
      const done = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(done.body).toMatchObject({ driverEta: null, trail: [], rated: false });
      await api(app, rider.accessToken)
        .post(`/v1/rides/${id}/rating`)
        .send({ stars: 5 })
        .expect(201);
      expect((await api(app, rider.accessToken).get(`/v1/rides/${id}`)).body.rated).toBe(true);
    });

    it('keeps saved places (one home, one work, up to 20) and recent destinations', async () => {
      const session = await signIn(app);
      const rider = api(app, session.accessToken);
      const home = await rider
        .post('/v1/places')
        .send({ kind: 'home', address: 'Guliston, Navro‘z 5', lat: 40.49, lng: 68.78 })
        .expect(201);
      // a second home replaces the first
      const moved = await rider
        .post('/v1/places')
        .send({ kind: 'home', address: 'Guliston, Bog‘ 2', lat: 40.5, lng: 68.77 })
        .expect(201);
      expect(moved.body.id).toBe(home.body.id);
      const work = await rider
        .post('/v1/places')
        .send({ kind: 'work', label: 'Ish', address: 'GulDU', lat: 40.51, lng: 68.79 })
        .expect(201);
      // renaming keeps everything else (no defaults re-applied by the PATCH schema)
      const renamed = await rider
        .patch(`/v1/places/${work.body.id}`)
        .send({ label: 'Universitet' })
        .expect(200);
      expect(renamed.body).toMatchObject({ label: 'Universitet', address: 'GulDU', lat: 40.51 });
      for (let i = 0; i < 18; i++) {
        await rider
          .post('/v1/places')
          .send({ kind: 'other', label: `Joy ${i}`, lat: 40.49 + i / 1000, lng: 68.77 })
          .expect(201);
      }
      await rider.post('/v1/places').send({ kind: 'other', lat: 40.4, lng: 68.7 }).expect(409);
      const list = await rider.get('/v1/places').expect(200);
      expect(list.body).toHaveLength(20);
      expect(list.body.slice(0, 2).map((p: { kind: string }) => p.kind)).toEqual(['home', 'work']);
      await api(app, (await signIn(app)).accessToken)
        .delete(`/v1/places/${work.body.id}`)
        .expect(404);
      await rider.delete(`/v1/places/${work.body.id}`).expect(204);

      await orderRide(app, session, { pickup: GULISTON, dropoff: MID });
      const recent = await rider.get('/v1/places/recent').expect(200);
      expect(recent.body[0]).toMatchObject({
        address: 'Guliston temir yo‘l vokzali',
        lat: MID.lat,
        lng: MID.lng,
      });
    });
  });

  describe('operator', () => {
    beforeEach(() => quiesce(app));

    it('orders by phone at the quoted fare, once per request id', async () => {
      const phone = uniquePhone();
      const quote = await admin
        .post('/v1/admin/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID })
        .expect(200);
      // the tariff changes after the price was read out: the caller pays what they heard
      const dearer = structuredClone(DEFAULT_TARIFF);
      dearer.classes.economy.bands[1]!.price = 9000;
      await admin.put('/v1/admin/settings/tariff').send(dearer).expect(200);
      const body = {
        riderPhone: phone,
        riderName: 'Dilnoza',
        pickup: { address: 'Guliston bozori', landmark: 'Markaziy darvoza' },
        dropoff: { address: 'Vokzal', landmark: null },
        quoteId: quote.body.quoteId,
        clientRequestId: randomUUID(),
      };
      const [a, b] = await Promise.all([
        admin.post('/v1/admin/rides').send(body),
        admin.post('/v1/admin/rides').send(body),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(a.body).toMatchObject({
        channel: 'phone',
        fare: { quoted: 7000 },
        pickup: { address: 'Guliston bozori', lat: GULISTON.lat, lng: GULISTON.lng },
      });
      await admin.put('/v1/admin/settings/tariff').send(DEFAULT_TARIFF).expect(200);
      // without a quote, the addresses need coordinates
      await admin
        .post('/v1/admin/rides')
        .send({ ...body, riderPhone: uniquePhone(), quoteId: null, clientRequestId: null })
        .expect(400);
      await admin
        .post(`/v1/admin/rides/${a.body.id}/cancel`)
        .send({ reason: 'Test tugadi' })
        .expect(200);
    });

    it('looks a caller up by phone: account, open ride, recent rides and places', async () => {
      const unknown = await admin
        .post('/v1/admin/customers/lookup')
        .send({ phone: uniquePhone() })
        .expect(200);
      expect(unknown.body.found).toBe(false);

      const session = await signIn(app);
      await api(app, session.accessToken)
        .post('/v1/places')
        .send({ kind: 'home', address: 'Uy', lat: 40.5, lng: 68.77 })
        .expect(201);
      const { id } = await orderRide(app, session, { pickup: GULISTON, dropoff: MID });
      const found = await admin
        .post('/v1/admin/customers/lookup')
        .send({ phone: session.phone })
        .expect(200);
      expect(found.body).toMatchObject({
        found: true,
        user: { noShows: 0, rating: 4.8 },
        openRide: { id, status: 'searching' },
        recentRides: [{ id }],
        savedPlaces: [{ kind: 'home', address: 'Uy' }],
      });
      expect(found.body.recentPlaces.map((p: { lat: number }) => p.lat)).toEqual([
        GULISTON.lat,
        MID.lat,
      ]);
      await api(app, session.accessToken)
        .post('/v1/admin/customers/lookup')
        .send({ phone: session.phone })
        .expect(403);
    });

    it('filters and pages the ride list, per driver too, and lists drivers with their standing', async () => {
      const driver = await createDriver(app, { at: GULISTON, topup: 15_000 });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { id } = await assigned(driver);
        await admin.post(`/v1/admin/rides/${id}/cancel`).send({ reason: 'Test' }).expect(200);
        ids.push(id);
      }
      const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      const mine = await admin
        .get(
          `/v1/admin/rides?status=all&driverId=${driver.id}&class=economy&from=${today}&to=${today}`,
        )
        .expect(200);
      // cancelled rides keep no driver: the list follows who drove; assigned-then-cancelled keep it
      expect(mine.body.map((r: { id: string }) => r.id)).toEqual([...ids].reverse());
      const page = await admin
        .get(`/v1/admin/drivers/${driver.id}/rides?cursor=${ids[2]}`)
        .expect(200);
      expect(page.body.map((r: { id: string }) => r.id)).toEqual([ids[1], ids[0]]);
      const yesterday = new Date(Date.now() + 5 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
      expect(
        (await admin.get(`/v1/admin/rides?status=all&driverId=${driver.id}&to=${yesterday}`)).body,
      ).toEqual([]);

      const drivers = await admin.get('/v1/admin/drivers?status=active').expect(200);
      expect(drivers.body.find((d: { id: string }) => d.id === driver.id)).toMatchObject({
        isOnline: true,
        balance: 15_000,
        rating: 4.8,
        priority: expect.any(Number),
        licenceStatus: 'valid',
      });
    });

    it('sends operators every online driver’s position in one batch', async () => {
      const free = await createDriver(app, { at: near(300) });
      const busy = await createDriver(app, { at: near(900) });
      await assigned(busy);
      const sent: RealtimeMessage[] = [];
      const bus = { publish: (m: RealtimeMessage) => Promise.resolve(void sent.push(m)) };
      const job = new PositionsJob(app.get(Database), bus as unknown as RealtimeBus);
      expect(await job.runOnce()).toBe(2);
      expect(sent[0]!.to).toEqual({ admins: true });
      const event = sent[0]!.event as Extract<
        RealtimeMessage['event'],
        { type: 'drivers.positions' }
      >;
      expect(event.type).toBe('drivers.positions');
      expect(event.drivers.find((d) => d.id === free.id)).toMatchObject({ busy: false });
      expect(event.drivers.find((d) => d.id === busy.id)).toMatchObject({ busy: true });
    });

    it('takes complaints (lost items too), answers in a thread and resolves them', async () => {
      const driver = await createDriver(app, { at: GULISTON });
      const { id, rider } = await assigned(driver);
      await driver.http.post(`/v1/driver/rides/${id}/arrive`).expect(200);
      const pin = await startPin(app, id);
      await driver.http.post(`/v1/driver/rides/${id}/start`).send({ pin }).expect(200);
      await driver.http.post(`/v1/driver/rides/${id}/complete`).expect(200);
      const r = api(app, rider.accessToken);
      const opened = await r
        .post(`/v1/rides/${id}/complaints`)
        .send({ type: 'lost_item', text: 'Orqa o‘rindiqda sumkam qoldi' })
        .expect(201);
      expect(opened.body).toMatchObject({ status: 'open', typeLabel: 'Mashinada narsa qoldi' });
      expect(opened.body).not.toHaveProperty('driverId');
      await r
        .post(`/v1/rides/${id}/complaints`)
        .send({ type: 'lost_item', text: 'Yana' })
        .expect(409);
      await api(app, (await signIn(app)).accessToken)
        .post(`/v1/rides/${id}/complaints`)
        .send({ type: 'other', text: 'Begona safar' })
        .expect(404);

      const inbox = await admin.get('/v1/admin/complaints').expect(200);
      expect(inbox.body.items.find((c: { id: string }) => c.id === opened.body.id)).toMatchObject({
        driverId: driver.id,
        riderPhone: rider.phone,
      });
      const answered = await admin
        .post(`/v1/admin/complaints/${opened.body.id}/messages`)
        .send({ text: 'Haydovchi bilan bog‘landik, sumka topildi' })
        .expect(201);
      expect(answered.body.status).toBe('in_progress');
      await r
        .post(`/v1/complaints/${opened.body.id}/messages`)
        .send({ text: 'Rahmat, ertaga olib ketaman' })
        .expect(201);
      const resolved = await admin
        .post(`/v1/admin/complaints/${opened.body.id}/resolve`)
        .send({ resolution: 'item_returned', note: 'Sumka egasiga qaytarildi' })
        .expect(200);
      expect(resolved.body).toMatchObject({ status: 'resolved', resolution: 'item_returned' });
      const seen = await r.get(`/v1/complaints/${opened.body.id}`).expect(200);
      expect(seen.body.messages.map((m: { authorRole: string }) => m.authorRole)).toEqual([
        'admin',
        'rider',
      ]);
      await r
        .post(`/v1/complaints/${opened.body.id}/messages`)
        .send({ text: 'Yana bir savol' })
        .expect(409);
      expect((await r.get('/v1/complaints').expect(200)).body.items[0].id).toBe(opened.body.id);
      const events = await db
        .selectFrom('outbox')
        .select('payload')
        .where('topic', '=', 'complaint.changed')
        .execute();
      expect(
        events.filter((e) => (e.payload as { complaintId: string }).complaintId === opened.body.id),
      ).toHaveLength(4);

      // low driver ratings for operators
      await r.post(`/v1/rides/${id}/rating`).send({ stars: 2, comment: 'Qo‘pol' }).expect(201);
      const low = await admin.get(`/v1/admin/ratings?of=driver&maxStars=3&subjectId=${driver.id}`);
      expect(low.body.items).toEqual([
        expect.objectContaining({ rideId: id, stars: 2, comment: 'Qo‘pol', authorRole: 'rider' }),
      ]);
    });
  });
});
