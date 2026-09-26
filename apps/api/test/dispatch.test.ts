import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import { DispatchHandler } from '../src/modules/dispatch/dispatch.handler.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { defaultOsrm, type Fake, startFake } from './fakes.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  orderRide,
  type Session,
  signIn,
  signInAdmin,
} from './helpers.js';

/** A point `north` / `east` metres from the Guliston centre (the pickup in these tests). */
const at = (north: number, east = 0) => ({
  lat: GULISTON.lat + north / 110_574,
  lng: GULISTON.lng + east / (111_320 * Math.cos((GULISTON.lat * Math.PI) / 180)),
});
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

describe('dispatch', () => {
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
    await app?.close();
    await fake?.close();
  });

  // every test starts with nobody on shift and nothing waiting
  beforeEach(async () => {
    fake.osrm = defaultOsrm;
    await db
      .updateTable('ride_offers')
      .set({ status: 'withdrawn' })
      .where('status', '=', 'pending')
      .execute();
    await db
      .updateTable('rides')
      .set({ status: 'cancelled', cancelled_by: 'system', cancelled_at: new Date() })
      .where('status', '=', 'searching')
      .execute();
    await db.updateTable('drivers').set({ is_online: false }).execute();
  });

  async function offersOf(d: DriverFixture) {
    return (await d.http.get('/v1/driver/offers').expect(200)).body as {
      id: string;
      kind: string;
      etaS: number;
      ride: { id: string };
    }[];
  }

  async function newRide(rider?: Session, opts: Parameters<typeof orderRide>[2] = {}) {
    return orderRide(app, rider ?? (await signIn(app)), { pickup: GULISTON, ...opts });
  }

  async function adminRide(id: string) {
    return (await admin.get(`/v1/admin/rides/${id}`).expect(200)).body;
  }

  describe('direct offers', () => {
    it('offers the ride to the best road ETA, not the nearest straight line', async () => {
      // A is 500 m away across the canal: 10 minutes by road; B is 1.2 km away on a straight road
      const a = await createDriver(app, { at: at(500) });
      const b = await createDriver(app, { at: at(0, 1200) });
      const aPos = at(500);
      fake.osrm = (o, d) =>
        Math.abs(o.lat - aPos.lat) < 1e-4 && Math.abs(o.lng - aPos.lng) < 1e-4
          ? { distance: 6000, duration: 600 }
          : defaultOsrm(o, d);
      const { id } = await newRide();

      await dispatch.tick();
      expect(await offersOf(a)).toEqual([]);
      const [offer] = await offersOf(b);
      expect(offer).toMatchObject({ kind: 'direct', ride: { id } });
      expect(offer!.etaS).toBeLessThan(300);
      const view = await adminRide(id);
      expect(view.dispatch).toMatchObject({ stage: 'direct', directOffers: 1 });
      expect(view.offers).toEqual([
        expect.objectContaining({ driverId: b.id, kind: 'direct', status: 'pending' }),
      ]);
      // a tick before the timeout changes nothing
      await dispatch.tick(later(10));
      expect((await adminRide(id)).offers).toHaveLength(1);
    });

    it('cascades to the next driver every 15 s, up to 3, then broadcasts within 3 km', async () => {
      const d1 = await createDriver(app, { at: at(300) });
      const d2 = await createDriver(app, { at: at(900) });
      const d3 = await createDriver(app, { at: at(1500) });
      const d4 = await createDriver(app, { at: at(2500) });
      const beyond = await createDriver(app, { at: at(4000) });
      const { id } = await newRide();

      await dispatch.tick();
      expect((await offersOf(d1))[0]?.ride.id).toBe(id);
      await dispatch.tick(later(16));
      expect(await offersOf(d1)).toEqual([]);
      expect((await offersOf(d2))[0]?.ride.id).toBe(id);
      // declining moves on at once (the outbox handler), without waiting for the timeout
      const [o2] = await offersOf(d2);
      await d2.http.post(`/v1/driver/offers/${o2!.id}/decline`).expect(204);
      const outbox = new OutboxDispatcher(app.get(Database), [app.get(DispatchHandler)]);
      while ((await outbox.runOnce()) > 0);
      expect((await offersOf(d3))[0]?.ride.id).toBe(id);

      await dispatch.tick(later(32));
      const view = await adminRide(id);
      expect(view.dispatch.stage).toBe('broadcast');
      const broadcast = view.offers.filter((o: { kind: string }) => o.kind === 'broadcast');
      // everyone within 3 km except the driver who declined; the one 4 km away is not asked
      expect(broadcast.map((o: { driverId: string }) => o.driverId).sort()).toEqual(
        [d1.id, d3.id, d4.id].sort(),
      );
      expect(await offersOf(beyond)).toEqual([]);
      expect(await offersOf(d2)).toEqual([]);
      expect(view.offers.map((o: { status: string }) => o.status)).toEqual([
        'expired',
        'declined',
        'expired',
        'pending',
        'pending',
        'pending',
      ]);

      // the first to accept wins; the other broadcast offers are withdrawn
      const [o4] = await offersOf(d4);
      const won = await d4.http.post(`/v1/driver/offers/${o4!.id}/accept`).expect(200);
      expect(won.body).toMatchObject({ id, status: 'driver_assigned' });
      // d1's broadcast offer was withdrawn when d4 won
      const o1 = broadcast.find((o: { driverId: string }) => o.driverId === d1.id);
      const late = await d1.http.post(`/v1/driver/offers/${o1!.id}/accept`).expect(409);
      expect(late.body.message).toBe('Taklif endi amal qilmaydi');
      const final = await adminRide(id);
      expect(final.driver.id).toBe(d4.id);
      expect(final.offers.filter((o: { status: string }) => o.status === 'pending')).toEqual([]);
      expect((await d4.http.get('/v1/driver/me').expect(200)).body.stats).toMatchObject({
        offersReceived: 1,
        offersAccepted: 1,
      });
    });

    it('breaks ETA ties by the priority score, and only ties', async () => {
      const low = await createDriver(app, { at: at(600) });
      const high = await createDriver(app, { at: at(900) });
      // "low" skipped most of its offers
      await db
        .updateTable('drivers')
        .set({ offers_received: 40, offers_accepted: 5 })
        .where('user_id', '=', low.id)
        .execute();
      const first = await newRide();
      await dispatch.tick();
      expect((await offersOf(high))[0]?.ride.id).toBe(first.id);
      expect(await offersOf(low)).toEqual([]);

      // far enough apart, the nearer driver wins whatever the score
      await db
        .updateTable('drivers')
        .set({ is_online: false })
        .where('user_id', '=', high.id)
        .execute();
      const far = await createDriver(app, { at: at(3000) });
      const second = await newRide();
      await dispatch.tick();
      expect((await offersOf(low))[0]?.ride.id).toBe(second.id);
      expect(await offersOf(far)).toEqual([]);
    });

    it('only asks drivers who can do the ride', async () => {
      const economy = await createDriver(app, { at: at(200) });
      const stale = await createDriver(app, {
        at: at(250),
        vehicle: { class: 'comfort', year: 2024 },
      });
      await db
        .updateTable('drivers')
        .set({ located_at: new Date(Date.now() - 10 * 60_000) })
        .where('user_id', '=', stale.id)
        .execute();
      const broke = await createDriver(app, {
        at: at(300),
        vehicle: { class: 'comfort', year: 2024 },
      });
      await admin
        .post(`/v1/admin/billing/drivers/${broke.id}/ledger`)
        .send({ kind: 'adjustment', amount: -50_000, note: 'Qarz' })
        .expect(201);
      const noSeat = await createDriver(app, {
        at: at(350),
        vehicle: { class: 'comfort', year: 2024 },
      });
      const right = await createDriver(app, {
        at: at(1500),
        vehicle: { class: 'comfort', year: 2024, features: ['ac', 'child_seat'] },
      });
      const { id } = await newRide(undefined, { class: 'comfort', options: ['child_seat'] });
      await dispatch.tick();
      for (const d of [economy, stale, broke, noSeat]) expect(await offersOf(d)).toEqual([]);
      expect((await offersOf(right))[0]?.ride.id).toBe(id);
    });
  });

  describe('when nobody takes the ride', () => {
    it('waits for a free driver, then broadcasts, alerts operators, and finally gives up', async () => {
      const { id } = await newRide();
      await dispatch.tick();
      expect((await adminRide(id)).dispatch.stage).toBe('direct');
      // after the 45 s the direct offers would have taken: a broadcast (to nobody)
      await dispatch.tick(later(46));
      expect((await adminRide(id)).dispatch).toMatchObject({ stage: 'broadcast' });
      // a driver coming free during the broadcast window still gets it
      const late = await createDriver(app, { at: at(800) });
      await dispatch.tick(later(50));
      expect((await offersOf(late))[0]).toMatchObject({ kind: 'broadcast', ride: { id } });
      const [offer] = await offersOf(late);
      await late.http.post(`/v1/driver/offers/${offer!.id}/decline`).expect(204);

      await dispatch.tick(later(46 + 31));
      const alerted = await adminRide(id);
      expect(alerted.dispatch.stage).toBe('operator');
      expect(alerted.dispatch.attentionAt).not.toBeNull();
      expect(alerted.events.map((e: { type: string }) => e.type)).toContain('attention');
      const alert = await db
        .selectFrom('outbox')
        .select('payload')
        .where('topic', '=', 'ride.attention')
        .execute();
      expect(alert.map((a) => a.payload.rideId)).toContain(id);

      // operators see who could take it
      const candidates = await admin.get(`/v1/admin/dispatch/rides/${id}/candidates`).expect(200);
      expect(candidates.body).toEqual([]);

      await dispatch.tick(later(601));
      const gone = await adminRide(id);
      expect(gone).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'system',
        cancelReason: 'Haydovchi topilmadi',
      });
    });

    it('lets operators assign by hand from the candidates', async () => {
      const busy = await createDriver(app, { at: at(100) });
      const { id: first } = await newRide();
      await dispatch.tick();
      const [o] = await offersOf(busy);
      await busy.http.post(`/v1/driver/offers/${o!.id}/accept`).expect(200);

      const free = await createDriver(app, { at: at(2000) });
      const { id } = await newRide();
      const candidates = await admin.get(`/v1/admin/dispatch/rides/${id}/candidates`).expect(200);
      expect(candidates.body.map((c: { driverId: string }) => c.driverId)).toEqual([free.id]);
      expect(candidates.body[0].etaS).toBeGreaterThan(0);
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: free.id }).expect(200);

      const live = await admin.get('/v1/admin/dispatch/live').expect(200);
      const states = Object.fromEntries(
        live.body.drivers.map((d: { id: string; state: string }) => [d.id, d.state]),
      );
      expect(states[busy.id]).toBe('busy');
      expect(states[free.id]).toBe('busy');
      expect(live.body.rides.map((r: { id: string }) => r.id)).toEqual(
        expect.arrayContaining([first, id]),
      );
    });
  });

  describe('never two drivers, never two rides', () => {
    it('gives a broadcast ride to exactly one of two drivers accepting at once', async () => {
      const drivers = await Promise.all(
        [1, 2, 3, 4].map((i) => createDriver(app, { at: at(i * 400) })),
      );
      await db
        .updateTable('drivers')
        .set({ is_online: false })
        .where('user_id', '=', drivers[2]!.id)
        .execute();
      await db
        .updateTable('drivers')
        .set({ is_online: false })
        .where('user_id', '=', drivers[3]!.id)
        .execute();
      const { id } = await newRide();
      // skip the direct stage: both drivers let their offers expire
      await dispatch.tick();
      await dispatch.tick(later(16));
      await dispatch.tick(later(32));
      await dispatch.tick(later(48));
      expect((await adminRide(id)).dispatch.stage).toBe('broadcast');
      const offers = await Promise.all(drivers.slice(0, 2).map((d) => offersOf(d)));
      expect(offers.map((o) => o[0]?.kind)).toEqual(['broadcast', 'broadcast']);

      const results = await Promise.all(
        drivers
          .slice(0, 2)
          .map((d, i) => d.http.post(`/v1/driver/offers/${offers[i]![0]!.id}/accept`)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const ride = await adminRide(id);
      const winner = drivers[results.findIndex((r) => r.status === 200)]!;
      expect(ride.driver.id).toBe(winner.id);
      const assigned = ride.events.filter((e: { type: string }) => e.type === 'assigned');
      expect(assigned).toHaveLength(1);
    });

    it('offers a driver one ride at a time and nothing once busy', async () => {
      const only = await createDriver(app, { at: at(300) });
      const first = await newRide();
      const second = await newRide();
      await dispatch.tick();
      const offers = await offersOf(only);
      expect(offers.map((o) => o.ride.id)).toEqual([first.id]);
      expect((await adminRide(second.id)).offers).toEqual([]);

      await only.http.post(`/v1/driver/offers/${offers[0]!.id}/accept`).expect(200);
      await dispatch.tick(later(1));
      expect(await offersOf(only)).toEqual([]);
      expect((await adminRide(second.id)).offers).toEqual([]);
    });

    it('refuses answers to someone else’s, expired or withdrawn offers', async () => {
      const d = await createDriver(app, { at: at(300) });
      const other = await createDriver(app, { at: at(5000) });
      const { id } = await newRide();
      await dispatch.tick();
      const [offer] = await offersOf(d);
      await other.http.post(`/v1/driver/offers/${offer!.id}/accept`).expect(404);
      await dispatch.tick(later(16));
      await d.http.post(`/v1/driver/offers/${offer!.id}/accept`).expect(409);
      // going off shift withdraws the offer a driver holds
      const [next] = await offersOf(other);
      if (next) {
        await other.http.post('/v1/driver/shift').send({ online: false }).expect(200);
        const statuses = (await adminRide(id)).offers.map((o: { status: string }) => o.status);
        expect(statuses).toContain('withdrawn');
      }
    });
  });
});
