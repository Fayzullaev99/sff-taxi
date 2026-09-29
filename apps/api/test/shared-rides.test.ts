import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { RidesService } from '../src/modules/rides/rides.service.js';
import { type Fake, startFake } from './fakes.js';
import {
  api,
  createDriver,
  createTestApp,
  type DriverFixture,
  GULISTON,
  quiesce,
  type Session,
  signIn,
  signInAdmin,
} from './helpers.js';

/** A point `north` / `east` metres from the Guliston centre. */
const at = (north: number, east = 0) => ({
  lat: GULISTON.lat + north / 110_574,
  lng: GULISTON.lng + east / (111_320 * Math.cos((GULISTON.lat * Math.PI) / 180)),
});
const YANGIYER = { lat: 40.2700751, lng: 68.8165984 };

describe('shared rides, women drivers, fixed routes (wave 4)', () => {
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
  beforeEach(async () => {
    await quiesce(app);
  });

  async function quote(rider: Session, pickup: object, dropoff: object) {
    return (
      await api(app, rider.accessToken)
        .post('/v1/rides/quote')
        .send({ pickup, dropoff, options: [] })
        .expect(200)
    ).body;
  }

  async function order(
    rider: Session,
    pickup: object,
    dropoff: object,
    extra: Record<string, unknown> = {},
    status = 201,
  ) {
    const q = await quote(rider, pickup, dropoff);
    const res = await api(app, rider.accessToken)
      .post('/v1/rides')
      .send({
        quoteId: q.quoteId,
        class: 'economy',
        pickup: { address: 'Olib ketish', landmark: null },
        dropoff: { address: 'Borish', landmark: null },
        clientRequestId: randomUUID(),
        ...extra,
      })
      .expect(status);
    return { quote: q, ride: res.body };
  }

  async function offerOf(d: DriverFixture) {
    const offers = (await d.http.get('/v1/driver/offers').expect(200)).body as {
      id: string;
      ride: { id: string };
      along: { detourS: number; stops: { rideId: string; type: string }[] } | null;
    }[];
    return offers[0] ?? null;
  }

  async function riderView(rider: Session, id: string) {
    return (await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200)).body;
  }

  /** Accept, arrive and start (with the code the rider tells). */
  async function pickUp(d: DriverFixture, rider: Session, rideId: string) {
    await d.http.post(`/v1/driver/rides/${rideId}/arrive`).expect(200);
    const pin = (await riderView(rider, rideId)).startPin as string | null;
    const res = await d.http.post(`/v1/driver/rides/${rideId}/start`).send({ pin });
    expect(res.body).toMatchObject({ status: 'in_progress' });
  }

  describe('the seating rule', () => {
    it('shows it in the quote and refuses more than three people', async () => {
      const rider = await signIn(app);
      const { quote: q } = await order(rider, GULISTON, at(0, 3000));
      expect(q.seats).toEqual({ max: 3, front: 1, rearMax: 2 });
      const again = await quote(rider, GULISTON, at(0, 3000));
      await api(app, rider.accessToken)
        .post('/v1/rides')
        .send({
          quoteId: again.quoteId,
          class: 'economy',
          clientRequestId: randomUUID(),
          passengers: 4,
        })
        .expect(400);
    });

    it('is enforced by the database whatever the code does', async () => {
      const d = await createDriver(app);
      const rider = await signIn(app);
      const { ride } = await order(rider, GULISTON, at(0, 2500), { passengers: 3 });
      await dispatch.tick();
      const offer = await offerOf(d);
      await d.http.post(`/v1/driver/offers/${offer!.id}/accept`).expect(200);
      // people without the app on top of three riders: over the seats
      const over = sql`update drivers set extra_passengers = 1, destination = '{"lat":40.5,"lng":68.8,"address":null,"landmark":null}', destination_lat = 40.5, destination_lng = 68.8 where user_id = ${d.id}`;
      await over.execute(db);
      const bump = sql`update rides set passengers = 3, updated_at = now() where id = ${ride.id}`;
      await expect(bump.execute(db)).rejects.toMatchObject({ code: 'SF001' });
      // and the app refuses it too
      await d.http.put('/v1/driver/preferences').send({ extraPassengers: 1 }).expect(409);
      await sql`update drivers set extra_passengers = 0, destination = null, destination_lat = null, destination_lng = null where user_id = ${d.id}`.execute(
        db,
      );
      // a second ride outside any pool for the same driver (the seats allow it)
      await sql`update rides set passengers = 1 where id = ${ride.id}`.execute(db);
      const other = await signIn(app);
      const second = await order(other, GULISTON, at(0, 900));
      const give = sql`update rides set status = 'driver_assigned', driver_id = ${d.id} where id = ${second.ride.id}`;
      await expect(give.execute(db)).rejects.toMatchObject({ code: 'SF002' });
    });

    it('asks a driver with people in the car where they are going', async () => {
      const d = await createDriver(app);
      await d.http.put('/v1/driver/preferences').send({ extraPassengers: 2 }).expect(400);
      const me = (
        await d.http
          .put('/v1/driver/preferences')
          .send({
            poolEnabled: true,
            extraPassengers: 2,
            destination: { ...at(0, 8000), address: 'Yangiyer yo‘li' },
          })
          .expect(200)
      ).body;
      expect(me.pool).toMatchObject({ enabled: true, extraPassengers: 2 });
      expect(me.pool.seats).toMatchObject({ occupied: 2, free: 1, front: 1, rear: 1 });
      await d.http.put('/v1/driver/preferences').send({ extraPassengers: 3 }).expect(200);
      await d.http
        .put('/v1/driver/preferences')
        .send({ extraPassengers: 0, destination: null })
        .expect(200);
    });
  });

  describe('sharing a car', () => {
    it('takes a rider on the way, splits the price and keeps the plan', async () => {
      const d = await createDriver(app);
      await d.http.put('/v1/driver/preferences').send({ poolEnabled: true }).expect(200);
      const riderA = await signIn(app);
      const riderB = await signIn(app);

      // A: 6 km east, sharing allowed
      const a = await order(riderA, GULISTON, at(0, 6000), { shareable: true });
      expect(a.quote.pool).toMatchObject({ available: true, discountPercent: 15, cashOnly: true });
      expect(a.ride.hasStartPin).toBe(true);
      await dispatch.tick();
      const offerA = await offerOf(d);
      expect(offerA!.ride.id).toBe(a.ride.id);
      await d.http.post(`/v1/driver/offers/${offerA!.id}/accept`).expect(200);
      await pickUp(d, riderA, a.ride.id);

      // B, halfway along A's way to the same place, sees the car before ordering
      const qB = await quote(riderB, at(0, 3000), at(0, 6000));
      expect(qB.pool.cars.length).toBe(1);
      expect(qB.pool.cars[0]).toMatchObject({ inCar: 1, free: 2, capacity: 3 });
      const b = await order(riderB, at(0, 3000), at(0, 6000), { shareable: true });
      await dispatch.tick();
      const offerB = await offerOf(d);
      expect(offerB!.ride.id).toBe(b.ride.id);
      expect(offerB!.along!.stops.map((s) => s.type)).toContain('pickup');
      await d.http.post(`/v1/driver/offers/${offerB!.id}/accept`).expect(200);

      // both pay less: A shared half of the trip (the full 15%), B all of it
      const viewA = await riderView(riderA, a.ride.id);
      const viewB = await riderView(riderB, b.ride.id);
      expect(viewA.fare.poolDiscount).toBe(Math.floor((viewA.fare.quoted * 0.15) / 100) * 100);
      expect(viewB.fare.poolDiscount).toBe(Math.floor((viewB.fare.quoted * 0.15) / 100) * 100);
      expect(viewA.fare.pays).toBe(viewA.fare.quoted - viewA.fare.poolDiscount);
      expect(viewB.car).toMatchObject({ riders: 2 });

      // the driver sees every stop ahead, in order; the next is B's pickup
      const current = (await d.http.get('/v1/driver/rides/current').expect(200)).body.ride;
      expect(current.id).toBe(b.ride.id);
      expect(
        current.pool.stops.map(
          (s: { rideId: string; type: string }) =>
            `${s.rideId === a.ride.id ? 'A' : 'B'}:${s.type}`,
        ),
      ).toEqual(expect.arrayContaining(['B:pickup', 'A:dropoff', 'B:dropoff']));
      expect(current.pool.stops[0]).toMatchObject({ rideId: b.ride.id, type: 'pickup' });

      await pickUp(d, riderB, b.ride.id);
      await d.http.post(`/v1/driver/rides/${a.ride.id}/complete`).expect(200);
      await d.http.post(`/v1/driver/rides/${b.ride.id}/complete`).expect(200);
      const doneA = await riderView(riderA, a.ride.id);
      const doneB = await riderView(riderB, b.ride.id);
      expect(doneA.fare.total).toBe(doneA.fare.quoted - doneA.fare.poolDiscount);
      expect(doneB.fare.total).toBe(doneB.fare.quoted - doneB.fare.poolDiscount);
      // the driver still earns more than from A alone
      expect(doneA.fare.total + doneB.fare.total).toBeGreaterThan(doneA.fare.quoted);
      const pool = await db
        .selectFrom('ride_pools')
        .select('status')
        .where('driver_id', '=', d.id)
        .execute();
      expect(pool.every((p) => p.status === 'closed')).toBe(true);
    });

    it('gives the price back when the other rider cancels before getting in', async () => {
      const d = await createDriver(app);
      await d.http.put('/v1/driver/preferences').send({ poolEnabled: true }).expect(200);
      const riderA = await signIn(app);
      const riderB = await signIn(app);
      const a = await order(riderA, GULISTON, at(0, 6000), { shareable: true });
      await dispatch.tick();
      await d.http.post(`/v1/driver/offers/${(await offerOf(d))!.id}/accept`).expect(200);
      await pickUp(d, riderA, a.ride.id);
      const b = await order(riderB, at(0, 3000), at(0, 6000), { shareable: true });
      await dispatch.tick();
      await d.http.post(`/v1/driver/offers/${(await offerOf(d))!.id}/accept`).expect(200);
      expect((await riderView(riderA, a.ride.id)).fare.poolDiscount).toBeGreaterThan(0);
      await api(app, riderB.accessToken).post(`/v1/rides/${b.ride.id}/cancel`).send({}).expect(200);
      const viewA = await riderView(riderA, a.ride.id);
      expect(viewA.fare.poolDiscount).toBe(0);
      expect(viewA.fare.pays).toBe(viewA.fare.quoted);
      await d.http.post(`/v1/driver/rides/${a.ride.id}/complete`).expect(200);
    });

    it('never puts a rider who did not agree to share in an occupied car', async () => {
      const d = await createDriver(app);
      await d.http.put('/v1/driver/preferences').send({ poolEnabled: true }).expect(200);
      const riderA = await signIn(app);
      const a = await order(riderA, GULISTON, at(0, 6000), { shareable: true });
      await dispatch.tick();
      await d.http.post(`/v1/driver/offers/${(await offerOf(d))!.id}/accept`).expect(200);
      const solo = await order(await signIn(app), at(0, 3000), at(0, 6000));
      await dispatch.tick();
      expect(await offerOf(d)).toBeNull();
      await api(app, riderA.accessToken).post(`/v1/rides/${a.ride.id}/cancel`).send({}).expect(200);
      await admin
        .post(`/v1/admin/rides/${solo.ride.id}/cancel`)
        .send({ reason: 'test' })
        .expect(200);
    });

    it('refuses a shared ride paid by card and a start without the code', async () => {
      const rider = await signIn(app);
      const q = await quote(rider, GULISTON, at(0, 3000));
      await api(app, rider.accessToken)
        .post('/v1/rides')
        .send({
          quoteId: q.quoteId,
          class: 'economy',
          paymentMethod: 'card',
          shareable: true,
          clientRequestId: randomUUID(),
        })
        .expect(400);
      const d = await createDriver(app);
      const { ride } = await order(rider, GULISTON, at(0, 3000), { shareable: true });
      await dispatch.tick();
      await d.http.post(`/v1/driver/offers/${(await offerOf(d))!.id}/accept`).expect(200);
      await d.http.post(`/v1/driver/rides/${ride.id}/arrive`).expect(200);
      await d.http.post(`/v1/driver/rides/${ride.id}/start`).send({}).expect(400);
      const pin = (await riderView(rider, ride.id)).startPin as string;
      const wrong = pin === '0000' ? '1111' : '0000';
      await d.http.post(`/v1/driver/rides/${ride.id}/start`).send({ pin: wrong }).expect(400);
      await pickUp2(d, rider, ride.id);
      await d.http.post(`/v1/driver/rides/${ride.id}/complete`).expect(200);
    });

    async function pickUp2(d: DriverFixture, rider: Session, rideId: string) {
      const pin = (await riderView(rider, rideId)).startPin as string;
      await d.http.post(`/v1/driver/rides/${rideId}/start`).send({ pin }).expect(200);
    }
  });

  describe('heading somewhere and racing for the last seat', () => {
    it('offers a driver heading home only rides on the way', async () => {
      const d = await createDriver(app);
      await d.http
        .put('/v1/driver/preferences')
        .send({ destination: { ...at(0, 8000), address: 'Uy' } })
        .expect(200);
      const back = await order(await signIn(app), GULISTON, at(0, -4000));
      await dispatch.tick();
      expect(await offerOf(d)).toBeNull();
      await admin
        .post(`/v1/admin/rides/${back.ride.id}/cancel`)
        .send({ reason: 'test' })
        .expect(200);
      const onTheWay = await order(await signIn(app), at(0, 500), at(0, 5000));
      await dispatch.tick();
      expect((await offerOf(d))!.ride.id).toBe(onTheWay.ride.id);
      await admin
        .post(`/v1/admin/rides/${onTheWay.ride.id}/cancel`)
        .send({ reason: 'test' })
        .expect(200);
      await d.http.put('/v1/driver/preferences').send({ destination: null }).expect(200);
    });

    it('gives the last seat to one rider only, however many join at once', async () => {
      const d = await createDriver(app);
      await d.http.put('/v1/driver/preferences').send({ poolEnabled: true }).expect(200);
      const riderA = await signIn(app);
      const a = await order(riderA, GULISTON, at(0, 6000), { shareable: true });
      await dispatch.tick();
      await d.http.post(`/v1/driver/offers/${(await offerOf(d))!.id}/accept`).expect(200);
      // two riders of 2 people each: only one fits beside A (3 seats)
      const b = await order(await signIn(app), at(0, 2000), at(0, 6000), {
        shareable: true,
        passengers: 2,
      });
      const c = await order(await signIn(app), at(0, 2500), at(0, 6000), {
        shareable: true,
        passengers: 2,
      });
      const rides = app.get(RidesService);
      const give = (id: string) =>
        app.get(Database).transaction(async (trx) => {
          const ride = await rides.lockRide(trx, id);
          await rides.giveToDriver(trx, ride, d.id, {
            actor: 'operator',
            actorId: null,
            manual: true,
          });
        });
      const results = await Promise.allSettled([give(b.ride.id), give(c.ride.id)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const seated = await db
        .selectFrom('rides')
        .select((eb) => eb.fn.sum<number>('passengers').as('n'))
        .where('driver_id', '=', d.id)
        .where('status', 'in', ['driver_assigned', 'driver_arrived', 'in_progress'])
        .executeTakeFirstOrThrow();
      expect(Number(seated.n)).toBe(3);
      for (const r of [a, b, c]) {
        await admin.post(`/v1/admin/rides/${r.ride.id}/cancel`).send({ reason: 'test' });
      }
    });
  });

  describe('a woman driver', () => {
    it('is offered only to women riders and only verified women drivers get the ride', async () => {
      const man = await createDriver(app, { at: at(200) });
      const woman = await createDriver(app, { at: at(1500) });
      const rider = await signIn(app);
      const http = api(app, rider.accessToken);

      const before = await quote(rider, GULISTON, at(0, 3000));
      expect(before.womenOnly).toMatchObject({ available: false, reason: 'profile_gender' });
      await order(rider, GULISTON, at(0, 3000), { womenOnly: true }, 403);

      await http.patch('/v1/me').send({ gender: 'female' }).expect(200);
      // switching straight back is refused (abuse)
      await http.patch('/v1/me').send({ gender: 'male' }).expect(409);
      expect((await http.get('/v1/me').expect(200)).body.gender).toBe('female');

      // no verified woman yet: nobody gets it
      const first = await order(rider, GULISTON, at(0, 3000), { womenOnly: true });
      await dispatch.tick();
      expect(await offerOf(man)).toBeNull();
      expect(await offerOf(woman)).toBeNull();
      await http.post(`/v1/rides/${first.ride.id}/cancel`).send({}).expect(200);

      await admin
        .post(`/v1/admin/drivers/${woman.id}/gender`)
        .send({ gender: 'female' })
        .expect(200);
      const q = await quote(rider, GULISTON, at(0, 3000));
      expect(q.womenOnly).toMatchObject({ available: true, drivers: { cars: 1 } });
      const second = await order(rider, GULISTON, at(0, 3000), { womenOnly: true });
      await dispatch.tick();
      expect(await offerOf(man)).toBeNull();
      expect((await offerOf(woman))!.ride.id).toBe(second.ride.id);
      await http.post(`/v1/rides/${second.ride.id}/cancel`).send({}).expect(200);
    });

    it('lets a verified woman driver take women riders only', async () => {
      const woman = await createDriver(app);
      await woman.http.put('/v1/driver/preferences').send({ womenRidersOnly: true }).expect(403);
      await admin
        .post(`/v1/admin/drivers/${woman.id}/gender`)
        .send({ gender: 'female' })
        .expect(200);
      await woman.http.put('/v1/driver/preferences').send({ womenRidersOnly: true }).expect(200);
      const manRider = await signIn(app);
      const ride = await order(manRider, GULISTON, at(0, 2000));
      await dispatch.tick();
      expect(await offerOf(woman)).toBeNull();
      await api(app, manRider.accessToken)
        .post(`/v1/rides/${ride.ride.id}/cancel`)
        .send({})
        .expect(200);
    });
  });

  describe('fixed route prices', () => {
    it('prices Yangiyer -> Guliston at 10 000 a seat, even before Yangiyer opens in-city', async () => {
      const rider = await signIn(app);
      const q = await quote(rider, YANGIYER, GULISTON);
      expect(q.route).toMatchObject({
        from: { slug: 'yangiyer' },
        to: { slug: 'guliston' },
        prices: { economy: { seat: 10_000, car: null } },
      });
      const { ride } = await order(rider, YANGIYER, GULISTON, { fareMode: 'seat', passengers: 2 });
      expect(ride.fare.quoted).toBe(20_000);
      expect(ride).toMatchObject({ fareMode: 'seat', shareable: true, passengers: 2 });
      expect(ride.fare.breakdown.fixed).toMatchObject({
        mode: 'seat',
        price: 10_000,
        passengers: 2,
      });
      await api(app, rider.accessToken).post(`/v1/rides/${ride.id}/cancel`).send({}).expect(200);
    });

    it('lets operators set a whole-car price both ways', async () => {
      const routes = (
        await admin
          .put('/v1/admin/routes')
          .send({
            from: 'shirin',
            to: 'guliston',
            seatPrice: 15_000,
            carPrice: 50_000,
            bothWays: true,
          })
          .expect(200)
      ).body as { from: { slug: string }; to: { slug: string }; carPrice: number }[];
      expect(routes.filter((r) => r.carPrice === 50_000)).toHaveLength(2);
      const rider = await signIn(app);
      const q = await quote(rider, GULISTON, { lat: 40.2302986, lng: 69.1263086 });
      expect(q.fares.economy.total).toBe(50_000);
      expect(q.fares.economy.fixed).toMatchObject({ mode: 'car', price: 50_000 });
      const pub = (await api(app).get('/v1/routes').expect(200)).body as unknown[];
      expect(pub.length).toBeGreaterThanOrEqual(6);
    });

    it('refuses a seat where the route has no seat price', async () => {
      const rider = await signIn(app);
      const q = await quote(rider, GULISTON, at(0, 3000));
      expect(q.route).toBeNull();
      await api(app, rider.accessToken)
        .post('/v1/rides')
        .send({
          quoteId: q.quoteId,
          class: 'economy',
          fareMode: 'seat',
          clientRequestId: randomUUID(),
        })
        .expect(400);
    });
  });
});
