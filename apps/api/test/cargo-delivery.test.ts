import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/env.js';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { DEFAULT_CARGO } from '../src/lib/cargo.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { FiscalService } from '../src/modules/fiscal/fiscal.service.js';
import { NotificationsHandler } from '../src/modules/notifications/notifications.handler.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import { type Fake, startFake } from './fakes.js';
import {
  api,
  application,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  MID,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
  startPin,
  uniquePhone,
} from './helpers.js';

/** A point `north` metres from the Guliston centre. */
const at = (north: number) => ({ lat: GULISTON.lat + north / 110_574, lng: GULISTON.lng });

const DAMAS = {
  service: 'cargo',
  make: 'Chevrolet',
  model: 'Damas',
  colour: 'oq',
  year: 2012,
  seats: 1,
  body: 'van',
  payloadKg: 550,
  grossKg: 1500,
  features: [],
};
const GAZEL = {
  ...DAMAS,
  make: 'GAZ',
  model: 'Gazel Next',
  year: 2016,
  seats: 2,
  body: 'truck',
  payloadKg: 1500,
  grossKg: 3500,
};

describe('cargo and delivery', () => {
  let app: INestApplication;
  let fake: Fake;
  let admin: ReturnType<typeof api>;
  let db: Database['kysely'];
  let dispatch: DispatchService;

  beforeAll(async () => {
    fake = await startFake();
    Object.assign(process.env, fake.env());
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
    db = app.get(Database).kysely;
    dispatch = app.get(DispatchService);
  });
  afterAll(async () => {
    await admin.put('/v1/admin/settings/cargo').send(DEFAULT_CARGO).expect(200);
    await app?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    await quiesce(app);
  });

  async function quote(rider: Session, body: Record<string, unknown>, status = 200) {
    return (
      await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup: GULISTON, dropoff: MID, options: [], ...body })
        .expect(status)
    ).body;
  }

  async function order(rider: Session, body: Record<string, unknown>, status = 201) {
    return (
      await api(app, rider.accessToken)
        .post('/v1/rides')
        .send({
          pickup: { address: 'Guliston, Mustaqillik 12', landmark: null },
          dropoff: { address: 'Guliston, Navoiy 5', landmark: null },
          clientRequestId: randomUUID(),
          ...body,
        })
        .expect(status)
    ).body;
  }

  async function offersOf(d: DriverFixture) {
    return (await d.http.get('/v1/driver/offers').expect(200)).body as {
      id: string;
      ride: { id: string; service: string; cargo: unknown; parcel: unknown };
    }[];
  }

  async function drive(d: DriverFixture, rideId: string) {
    await d.http.post(`/v1/driver/rides/${rideId}/arrive`).expect(200);
    const pin = await startPin(app, rideId);
    await d.http.post(`/v1/driver/rides/${rideId}/start`).send({ pin }).expect(200);
    return (await d.http.post(`/v1/driver/rides/${rideId}/complete`).expect(200)).body;
  }

  describe('drivers', () => {
    it('accepts a Damas for cargo and refuses it as a taxi', async () => {
      const s = await signIn(app, uniquePhone(), 'driver');
      const http = api(app, s.accessToken);
      const asTaxi = await http
        .post('/v1/driver/application')
        .send(application({}, { ...DAMAS, service: 'taxi', body: undefined }))
        .expect(400);
      expect(asTaxi.body.issues.map((i: { path: string }) => i.path)).toContain('vehicle.model');

      const res = await http
        .post('/v1/driver/application')
        .send(application({}, DAMAS))
        .expect(200);
      expect(res.body.vehicle).toMatchObject({
        service: 'cargo',
        body: 'van',
        payloadKg: 550,
        cargoClass: 'cargo_s',
      });
      const gazel = await signIn(app, uniquePhone(), 'driver');
      const g = await api(app, gazel.accessToken)
        .post('/v1/driver/application')
        .send(application({}, GAZEL))
        .expect(200);
      expect(g.body.vehicle.cargoClass).toBe('cargo_m');
    });

    it('refuses a cargo car without a cargo body, and a heavy truck without category C', async () => {
      const http = api(app, (await signIn(app, uniquePhone(), 'driver')).accessToken);
      const res = await http
        .post('/v1/driver/application')
        .send(application({}, { ...DAMAS, body: 'sedan', payloadKg: null }))
        .expect(400);
      expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual([
        'vehicle.body',
        'vehicle.payloadKg',
      ]);
      const heavy = { ...GAZEL, model: 'Isuzu NQR', grossKg: 7500, payloadKg: 4000 };
      await http.post('/v1/driver/application').send(application({}, heavy)).expect(400);
      await http
        .post('/v1/driver/application')
        .send(application({ licenceCategories: ['B', 'C'] }, heavy))
        .expect(200);
    });

    it('a cargo car cannot publish passenger trips', async () => {
      const d = await createDriver(app, { vehicle: DAMAS, online: false });
      const departureAt = new Date(Date.now() + 3 * 3600_000).toISOString();
      await d.http
        .post('/v1/driver/intercity/trips')
        .send({ from: 'guliston', to: 'toshkent', departureAt, seats: 1 })
        .expect(403);
    });
  });

  describe('cargo', () => {
    it('quotes every cargo class with loaders, fixed; taxi quotes are unchanged', async () => {
      const rider = await signIn(app);
      const taxi = await quote(rider, {});
      expect(taxi.service).toBe('taxi');
      expect(Object.keys(taxi.fares).sort()).toEqual(['comfort', 'economy']);

      const q = await quote(rider, {
        service: 'cargo',
        cargo: { loaders: 1, riderRides: true, description: 'Muzlatgich', weightKg: 80 },
      });
      expect(q.service).toBe('cargo');
      expect(Object.keys(q.fares).sort()).toEqual(['cargo_m', 'cargo_s']);
      // ~2.9 km: within the included 10 km
      expect(q.fares.cargo_s.total).toBe(35_000 + 30_000);
      expect(q.fares.cargo_m.total).toBe(56_000 + 30_000);
      expect(q.cargo).toMatchObject({
        loaders: 1,
        riderRides: true,
        description: 'Muzlatgich',
        weightKg: 80,
        maxLoaders: 2,
        maxRiders: 1,
        classes: { cargo_s: { maxPayloadKg: 700, fits: true } },
      });
      expect(q.pool.available).toBe(false);
      expect(q.availability).toHaveProperty('cargo_s');

      await quote(rider, { service: 'cargo', cargo: { loaders: 3 } }, 400);
    });

    it('goes to a cargo car of a fitting class only, never to a taxi car', async () => {
      const taxiCar = await createDriver(app, { at: at(100) });
      const damas = await createDriver(app, { at: at(600), vehicle: DAMAS });
      const gazel = await createDriver(app, { at: at(1200), vehicle: GAZEL });
      const rider = await signIn(app);
      const q = await quote(rider, { service: 'cargo', cargo: { loaders: 0, weightKg: 300 } });
      const ride = await order(rider, { quoteId: q.quoteId, class: 'cargo_s' });
      expect(ride).toMatchObject({
        service: 'cargo',
        class: 'cargo_s',
        cargo: { loaders: 0, riderRides: false, weightKg: 300 },
        delivery: null,
      });

      await dispatch.processRide(ride.id);
      expect(await offersOf(taxiCar)).toEqual([]);
      const offers = await offersOf(damas);
      expect(offers).toHaveLength(1);
      expect(offers[0]!.ride).toMatchObject({ service: 'cargo', cargo: { weightKg: 300 } });
      expect(await offersOf(gazel)).toEqual([]);

      // an operator cannot give it to a taxi car either
      await admin
        .post(`/v1/admin/rides/${ride.id}/assign`)
        .send({ driverId: taxiCar.id })
        .expect(409);

      await damas.http.post(`/v1/driver/offers/${offers[0]!.id}/accept`).expect(200);
      const view = await damas.http.get(`/v1/driver/rides/${ride.id}`).expect(200);
      expect(view.body).toMatchObject({
        service: 'cargo',
        vehicle: { body: 'van', cargoClass: 'cargo_s' },
      });
      const done = await drive(damas, ride.id);
      expect(done).toMatchObject({ status: 'completed', fare: { total: q.fares.cargo_s.total } });

      await app.get(FiscalService).issue({ rideId: ride.id });
      const receipt = await db
        .selectFrom('fiscal_receipts')
        .select('payload')
        .where('ride_id', '=', ride.id)
        .executeTakeFirstOrThrow();
      expect(receipt.payload).toMatchObject({ items: [{ name: 'Yuk tashish xizmati' }] });
    });

    it('a medium load goes to a medium car only; a load over the payload is refused', async () => {
      const damas = await createDriver(app, { at: at(100), vehicle: DAMAS });
      const gazel = await createDriver(app, { at: at(900), vehicle: GAZEL });
      const rider = await signIn(app);
      const heavy = await quote(rider, { service: 'cargo', cargo: { weightKg: 1000 } });
      expect(heavy.cargo.classes.cargo_s.fits).toBe(false);
      await order(rider, { quoteId: heavy.quoteId, class: 'cargo_s' }, 400);
      await order(rider, { quoteId: heavy.quoteId, class: 'economy' }, 400);
      await order(rider, { quoteId: heavy.quoteId, class: 'cargo_m', shareable: true }, 400);
      const ride = await order(rider, { quoteId: heavy.quoteId, class: 'cargo_m' });
      await dispatch.processRide(ride.id);
      expect(await offersOf(damas)).toEqual([]);
      expect(await offersOf(gazel)).toHaveLength(1);
    });

    it('charges extra loading minutes after the included ones', async () => {
      const damas = await createDriver(app, { at: at(100), vehicle: DAMAS });
      const rider = await signIn(app);
      const q = await quote(rider, { service: 'cargo' });
      const ride = await order(rider, { quoteId: q.quoteId, class: 'cargo_s' });
      await admin
        .post(`/v1/admin/rides/${ride.id}/assign`)
        .send({ driverId: damas.id })
        .expect(200);
      await damas.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
      // 25 minutes of loading: 5 paid minutes at 300
      await db
        .updateTable('rides')
        .set({ arrived_at: new Date(Date.now() - 25 * 60_000 - 5000) })
        .where('id', '=', ride.id)
        .execute();
      const pin = await startPin(app, ride.id);
      const started = await damas.http
        .post(`/v1/driver/rides/${ride.id}/start`)
        .send({ pin })
        .expect(200);
      expect(started.body.fare.waiting).toBe(6 * 300);
      const rider2 = await api(app, rider.accessToken).get(`/v1/rides/${ride.id}`).expect(200);
      expect(rider2.body.rules).toMatchObject({ freeWaitingMinutes: 20, waitingPerMinute: 300 });
    });

    it('taxi rides never go to a cargo car', async () => {
      const damas = await createDriver(app, { at: at(100), vehicle: DAMAS });
      const taxiCar = await createDriver(app, { at: at(1500) });
      const rider = await signIn(app);
      const q = await quote(rider, {});
      expect(q.availability.economy.cars).toBe(1);
      const ride = await order(rider, { quoteId: q.quoteId, class: 'economy' });
      await order(rider, { quoteId: q.quoteId, class: 'cargo_s' }, 400);
      await dispatch.processRide(ride.id);
      expect(await offersOf(damas)).toEqual([]);
      expect(await offersOf(taxiCar)).toHaveLength(1);
    });

    it('can be switched off', async () => {
      await admin
        .put('/v1/admin/settings/cargo')
        .send({ ...DEFAULT_CARGO, enabled: false })
        .expect(200);
      const rider = await signIn(app);
      await quote(rider, { service: 'cargo' }, 400);
      await admin.put('/v1/admin/settings/cargo').send(DEFAULT_CARGO).expect(200);
      const bad = { ...DEFAULT_CARGO, loader_price: -1 };
      await admin.put('/v1/admin/settings/cargo').send(bad).expect(400);
    });
  });

  describe('delivery', () => {
    it('a parcel goes by a taxi car to the recipient the driver can call', async () => {
      const damas = await createDriver(app, { at: at(100), vehicle: DAMAS });
      const taxiCar = await createDriver(app, { at: at(800) });
      const sender = await signIn(app);
      const taxi = await quote(sender, {});
      const q = await quote(sender, {
        service: 'delivery',
        parcel: { description: 'Hujjatlar', weightKg: 2 },
      });
      expect(q.service).toBe('delivery');
      expect(q.fares.economy.total).toBe(taxi.fares.economy.total);
      expect(q.delivery).toMatchObject({ percent: 100, maxWeightKg: 10, recipientRequired: true });
      await quote(sender, { service: 'delivery', parcel: { weightKg: 15 } }, 400);

      await order(sender, { quoteId: q.quoteId, class: 'economy' }, 400);
      await order(
        sender,
        {
          quoteId: q.quoteId,
          class: 'economy',
          shareable: true,
          recipient: { name: 'Dilnoza', phone: '+998901112233' },
        },
        400,
      );
      const ride = await order(sender, {
        quoteId: q.quoteId,
        class: 'economy',
        recipient: { name: 'Dilnoza', phone: '90 111 22 33' },
      });
      expect(ride).toMatchObject({
        service: 'delivery',
        shareable: false,
        cargo: null,
        delivery: {
          parcel: { description: 'Hujjatlar', weightKg: 2 },
          recipientName: 'Dilnoza',
          recipientPhone: '+998901112233',
        },
      });

      await dispatch.processRide(ride.id);
      expect(await offersOf(damas)).toEqual([]);
      const [offer] = await offersOf(taxiCar);
      expect(offer!.ride).toMatchObject({ service: 'delivery', parcel: { weightKg: 2 } });
      await taxiCar.http.post(`/v1/driver/offers/${offer!.id}/accept`).expect(200);
      const view = await taxiCar.http.get('/v1/driver/rides/current').expect(200);
      expect(view.body.ride.delivery).toMatchObject({ recipientPhone: '+998901112233' });

      await drive(taxiCar, ride.id);
      await app.get(FiscalService).issue({ rideId: ride.id });
      const receipt = await db
        .selectFrom('fiscal_receipts')
        .select('payload')
        .where('ride_id', '=', ride.id)
        .executeTakeFirstOrThrow();
      expect(receipt.payload).toMatchObject({
        items: [{ name: 'Yetkazib berish xizmati (posilka)' }],
      });

      // the recipient gets an SMS when the parcel is on its way; the sender hears it arrived
      const handler = new NotificationsHandler(app.get(Database), app.get(Notifier), app.get(ENV));
      const outbox = new OutboxDispatcher(app.get(Database), [handler]);
      while ((await outbox.runOnce()) > 0);
      const sent = await db
        .selectFrom('notifications')
        .select(['kind', 'channel'])
        .where('ride_id', '=', ride.id)
        .execute();
      expect(sent).toContainEqual({ kind: 'parcel_on_the_way', channel: 'sms' });
    });
  });
});
