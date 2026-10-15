import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { DispatchService } from '../src/modules/dispatch/dispatch.service.js';
import { SettingsService } from '../src/modules/settings/settings.module.js';
import { DEFAULT_TARIFF, type Tariff } from '../src/lib/tariff.js';
import { type Fake, startFake } from './fakes.js';
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

/** A point `north` metres from the Guliston centre. */
const at = (north: number) => ({ lat: GULISTON.lat + north / 110_574, lng: GULISTON.lng });

const MINIVAN = {
  class: 'minivan',
  make: 'Chevrolet',
  model: 'Orlando',
  year: 2023,
  seats: 6,
  features: ['ac', 'big_trunk'],
};
const BUSINESS = { class: 'business', make: 'Chevrolet', model: 'Malibu 2', year: 2025 };

/** Every class switched on (the launch tariff has minivan and business off). */
const ALL_ON: Tariff = {
  ...DEFAULT_TARIFF,
  classes: {
    ...DEFAULT_TARIFF.classes,
    minivan: { ...DEFAULT_TARIFF.classes.minivan, enabled: true },
    business: { ...DEFAULT_TARIFF.classes.business, enabled: true },
  },
};

describe('taxi classes: minivan and business', () => {
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
    await admin?.put('/v1/admin/settings/tariff').send(DEFAULT_TARIFF);
    await app?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    await quiesce(app);
    await admin.put('/v1/admin/settings/tariff').send(DEFAULT_TARIFF).expect(200);
  });

  async function quote(rider: Session, body: Record<string, unknown> = {}) {
    return api(app, rider.accessToken)
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, options: [], ...body })
      .expect(200);
  }

  function order(rider: Session, quoteId: string, body: Record<string, unknown>) {
    return api(app, rider.accessToken)
      .post('/v1/rides')
      .send({
        quoteId,
        pickup: { address: 'Guliston, Mustaqillik 12', landmark: null },
        dropoff: { address: 'Vokzal', landmark: null },
        comment: null,
        clientRequestId: randomUUID(),
        ...body,
      });
  }

  async function offersOf(d: DriverFixture) {
    return (await d.http.get('/v1/driver/offers').expect(200)).body as { ride: { id: string } }[];
  }

  it('quotes only the classes switched on, and refuses to order a switched-off one', async () => {
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    expect(Object.keys(q.fares)).toEqual(['economy', 'comfort']);
    expect(q.classes.map((c: { id: string; label: string }) => [c.id, c.label])).toEqual([
      ['economy', 'Ekonom'],
      ['comfort', 'Komfort'],
    ]);
    expect(Object.keys(q.availability)).toEqual(['economy', 'comfort']);
    const res = await order(rider, q.quoteId, { class: 'minivan' }).expect(400);
    expect(res.body.message).toBe('«Miniven» sinfi hozircha ishlamaydi: boshqa sinfni tanlang');
  }, 120_000);

  it('prices every class once operators switch them on', async () => {
    await admin.put('/v1/admin/settings/tariff').send(ALL_ON).expect(200);
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    expect(Object.keys(q.fares)).toEqual(['economy', 'comfort', 'minivan', 'business']);
    expect(q.fares.minivan.total).toBeGreaterThan(q.fares.comfort.total);
    expect(q.fares.business.total).toBeGreaterThan(q.fares.minivan.total);
    expect(q.seats.byClass).toEqual({ economy: 3, comfort: 3, minivan: 6, business: 3 });
    const minivan = q.classes.find((c: { id: string }) => c.id === 'minivan');
    expect(minivan).toMatchObject({ label: 'Miniven', maxPassengers: 6 });
  }, 120_000);

  it('keeps working with a tariff stored before the new classes (they stay off)', async () => {
    const { minivan: _m, business: _b, ...old } = DEFAULT_TARIFF.classes;
    const json = JSON.stringify({ ...DEFAULT_TARIFF, classes: old });
    await db
      .insertInto('settings')
      .values({ key: 'tariff', value: json })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: json }))
      .execute();
    (app.get(SettingsService) as unknown as { cache: Map<string, unknown> }).cache.clear();
    const stored = (await admin.get('/v1/admin/settings/tariff').expect(200)).body;
    expect(stored.classes.minivan.enabled).toBe(false);
    expect(stored.classes.business.bands[0].price).toBe(9500);
    const q = (await quote(await signIn(app))).body;
    expect(Object.keys(q.fares)).toEqual(['economy', 'comfort']);
    // economy is never switched off
    await admin
      .put('/v1/admin/settings/tariff')
      .send({ ...DEFAULT_TARIFF, classes: { ...old, economy: { ...old.economy, enabled: false } } })
      .expect(400);
  }, 120_000);

  it('carries up to 6 people in a minivan; shares only economy and comfort', async () => {
    await admin.put('/v1/admin/settings/tariff').send(ALL_ON).expect(200);
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    const tooMany = await order(rider, q.quoteId, { class: 'economy', passengers: 4 }).expect(400);
    expect(tooMany.body.message).toContain('Minivenni tanlang');
    await order(rider, q.quoteId, { class: 'minivan', passengers: 7 }).expect(400);
    const shared = await order(rider, q.quoteId, { class: 'business', shareable: true }).expect(
      400,
    );
    expect(shared.body.message).toBe('Hamroh bilan safar faqat Ekonom va Komfort sinflarida');
    const ride = await order(rider, q.quoteId, { class: 'minivan', passengers: 5 }).expect(201);
    expect(ride.body).toMatchObject({ class: 'minivan', passengers: 5 });
  }, 120_000);

  it('offers a minivan ride to minivans only, and a business car economy only if it opts in', async () => {
    await admin.put('/v1/admin/settings/tariff').send(ALL_ON).expect(200);
    const sedan = await createDriver(app, { at: at(200) });
    const van = await createDriver(app, { at: at(900), vehicle: MINIVAN });
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    expect(q.availability.minivan.cars).toBe(1);
    // the minivan does not take economy by default: only the sedan counts
    expect(q.availability.economy.cars).toBe(1);
    const ride = (await order(rider, q.quoteId, { class: 'minivan', passengers: 5 }).expect(201))
      .body;
    await dispatch.tick();
    expect(await offersOf(sedan)).toEqual([]);
    expect((await offersOf(van))[0]?.ride.id).toBe(ride.id);

    // a business car: business rides; economy ones once its driver takes lower classes
    await quiesce(app);
    const exec = await createDriver(app, { at: at(100), vehicle: BUSINESS });
    const me = (await exec.http.get('/v1/driver/me').expect(200)).body;
    expect(me.classes).toMatchObject({
      own: 'business',
      lower: ['comfort', 'economy'],
      takesLower: false,
      rides: ['business'],
    });
    expect(me.classes.qualifiesFor).toContain('business');
    const rider2 = await signIn(app);
    const q2 = (await quote(rider2)).body;
    const cheap = (await order(rider2, q2.quoteId, { class: 'economy' }).expect(201)).body;
    await dispatch.tick();
    expect(await offersOf(exec)).toEqual([]);
    const prefs = await exec.http
      .put('/v1/driver/preferences')
      .send({ takesLowerClasses: true })
      .expect(200);
    expect(prefs.body.classes.rides).toEqual(['business', 'comfort', 'economy']);
    await dispatch.tick(new Date(Date.now() + 60_000));
    expect((await offersOf(exec))[0]?.ride.id).toBe(cheap.id);
  }, 120_000);

  it('gives economy rides to comfort cars unless the driver turns it off', async () => {
    const comfort = await createDriver(app, {
      at: at(100),
      vehicle: { class: 'comfort', model: 'Onix', year: 2024 },
    });
    expect((await comfort.http.get('/v1/driver/me').expect(200)).body.classes.takesLower).toBe(
      true,
    );
    await comfort.http.put('/v1/driver/preferences').send({ takesLowerClasses: false }).expect(200);
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    expect(q.availability.economy.cars).toBe(0);
    expect(q.availability.comfort.cars).toBe(1);
    const economy = await createDriver(app, { at: at(50) });
    await economy.http.put('/v1/driver/preferences').send({ takesLowerClasses: true }).expect(400);
  }, 120_000);

  it('lets operators assign only a car able to serve the class', async () => {
    await admin.put('/v1/admin/settings/tariff').send(ALL_ON).expect(200);
    const sedan = await createDriver(app, { at: at(200) });
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    const ride = (await order(rider, q.quoteId, { class: 'business' }).expect(201)).body;
    const res = await admin
      .post(`/v1/admin/rides/${ride.id}/assign`)
      .send({ driverId: sedan.id })
      .expect(409);
    expect(res.body.message).toBe('Bu mashina «Biznes» buyurtmasiga mos emas');
  }, 120_000);

  it('applies and re-classes cars by the class rules', async () => {
    const van = await createDriver(app, { vehicle: MINIVAN, online: false });
    const view = (await admin.get(`/v1/admin/drivers/${van.id}`).expect(200)).body;
    expect(view.vehicle).toMatchObject({ class: 'minivan', seats: 6, body: 'minivan' });
    // an operator cannot make a 6-seat car economy (a sedan's 4 seats)
    await admin.patch(`/v1/admin/drivers/${van.id}/vehicle`).send({ class: 'economy' }).expect(400);

    const sedan = await createDriver(app, {
      vehicle: { model: 'Malibu 2', year: 2025, features: ['ac'] },
      online: false,
    });
    // a driver rated below 4.8 is not moved up to business
    await db
      .updateTable('drivers')
      .set({ rating_sum: 40, rating_count: 10 })
      .where('user_id', '=', sedan.id)
      .execute();
    const low = await admin
      .patch(`/v1/admin/drivers/${sedan.id}/vehicle`)
      .send({ class: 'business' })
      .expect(400);
    expect(low.body.message).toContain('reytingi kamida 4.8');
    await db
      .updateTable('drivers')
      .set({ rating_sum: 50, rating_count: 10 })
      .where('user_id', '=', sedan.id)
      .execute();
    const up = await admin
      .patch(`/v1/admin/drivers/${sedan.id}/vehicle`)
      .send({ class: 'business' })
      .expect(200);
    expect(up.body.vehicle.class).toBe('business');
    // a Cobalt is not a business car, whatever the operator says
    const cobalt = await createDriver(app, { vehicle: { year: 2025 }, online: false });
    await admin
      .patch(`/v1/admin/drivers/${cobalt.id}/vehicle`)
      .send({ class: 'business' })
      .expect(400);
    const config = (await cobalt.http.get('/v1/driver/config').expect(200)).body;
    expect(config.classes.map((c: { id: string }) => c.id)).toEqual([
      'economy',
      'comfort',
      'minivan',
      'business',
    ]);
    expect(config.classes[2]).toMatchObject({ label: 'Miniven', enabled: false });
  }, 120_000);

  it('keeps 6 people within a minivan’s seats in the database too', async () => {
    await admin.put('/v1/admin/settings/tariff').send(ALL_ON).expect(200);
    const van = await createDriver(app, { at: at(100), vehicle: MINIVAN });
    const rider = await signIn(app);
    const q = (await quote(rider)).body;
    const ride = (await order(rider, q.quoteId, { class: 'minivan', passengers: 6 }).expect(201))
      .body;
    await admin.post(`/v1/admin/rides/${ride.id}/assign`).send({ driverId: van.id }).expect(200);
    const row = await db
      .selectFrom('rides')
      .select(['status', 'passengers'])
      .where('id', '=', ride.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'driver_assigned', passengers: 6 });
    // a sedan class with 4 people is refused by the table's check
    await expect(
      db.updateTable('rides').set({ class: 'economy' }).where('id', '=', ride.id).execute(),
    ).rejects.toThrow(/rides_passengers_check/);
  }, 120_000);
});
