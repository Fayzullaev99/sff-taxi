import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
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

describe('safety', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = api(app, (await signInAdmin(app)).accessToken);
  });
  afterAll(() => app.close());

  async function assigned(): Promise<{ rider: Session; driver: DriverFixture; id: string }> {
    const rider = await signIn(app);
    const driver = await createDriver(app);
    const { id } = await orderRide(app, rider);
    await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
    return { rider, driver, id };
  }

  async function completed() {
    const r = await assigned();
    await r.driver.http.post(`/v1/driver/rides/${r.id}/arrive`).expect(200);
    await r.driver.http.post(`/v1/driver/rides/${r.id}/start`).expect(200);
    await r.driver.http.post(`/v1/driver/rides/${r.id}/complete`).expect(200);
    return r;
  }

  describe('ratings', () => {
    it('rates both ways once per completed ride, feeding the driver’s score', async () => {
      const { rider, driver, id } = await completed();
      const r = api(app, rider.accessToken);
      await r.post(`/v1/rides/${id}/rating`).send({ stars: 6 }).expect(400);
      const rated = await r
        .post(`/v1/rides/${id}/rating`)
        .send({ stars: 2, tags: ['qo‘pol', 'tez haydadi'], comment: 'Tezlikni oshirdi' })
        .expect(201);
      expect(rated.body).toEqual({ rideId: id, role: 'rider', stars: 2 });
      await r.post(`/v1/rides/${id}/rating`).send({ stars: 5 }).expect(409);
      const me = await driver.http.get('/v1/driver/me').expect(200);
      expect(me.body.stats.ratingCount).toBe(1);
      // (2 + 5 x 4.8 prior) / 6
      expect(me.body.priority.stars).toBe(4.3);
      expect(me.body.priority.score).toBeLessThan(91);

      await driver.http.post(`/v1/driver/rides/${id}/rating`).send({ stars: 5 }).expect(201);
      await driver.http.post(`/v1/driver/rides/${id}/rating`).send({ stars: 5 }).expect(409);
      const events = (await admin.get(`/v1/admin/rides/${id}`).expect(200)).body.events;
      expect(events.filter((e: { type: string }) => e.type === 'rated')).toHaveLength(2);
    });

    it('refuses rating an unfinished, foreign or too old ride', async () => {
      const open = await assigned();
      await api(app, open.rider.accessToken)
        .post(`/v1/rides/${open.id}/rating`)
        .send({ stars: 5 })
        .expect(409);
      const done = await completed();
      const stranger = await signIn(app);
      await api(app, stranger.accessToken)
        .post(`/v1/rides/${done.id}/rating`)
        .send({ stars: 1 })
        .expect(404);
      await app
        .get(Database)
        .kysely.updateTable('rides')
        .set({ completed_at: new Date(Date.now() - 8 * 86_400_000) })
        .where('id', '=', done.id)
        .execute();
      await api(app, done.rider.accessToken)
        .post(`/v1/rides/${done.id}/rating`)
        .send({ stars: 5 })
        .expect(410);
    });
  });

  describe('SOS', () => {
    it('logs an SOS from either side, alerts operators and gives the emergency numbers', async () => {
      const { rider, driver, id } = await assigned();
      const res = await api(app, rider.accessToken)
        .post(`/v1/rides/${id}/sos`)
        .send({ ...GULISTON, note: 'Haydovchi yo‘ldan chiqib ketdi' })
        .expect(201);
      expect(res.body.emergency).toEqual({
        unified: '112',
        police: '102',
        ambulance: '103',
        fire: '101',
      });
      await driver.http.post(`/v1/driver/rides/${id}/sos`).send({}).expect(201);
      const stranger = await signIn(app);
      await api(app, stranger.accessToken).post(`/v1/rides/${id}/sos`).send({}).expect(404);

      const list = await admin.get('/v1/admin/sos').expect(200);
      const mine = list.body.filter((s: { rideId: string }) => s.rideId === id);
      expect(mine.map((s: { role: string }) => s.role).sort()).toEqual(['driver', 'rider']);
      expect(mine.find((s: { role: string }) => s.role === 'rider')).toMatchObject({
        phone: rider.phone,
        lat: GULISTON.lat,
        note: 'Haydovchi yo‘ldan chiqib ketdi',
        resolvedAt: null,
      });
      const outbox = await app
        .get(Database)
        .kysely.selectFrom('outbox')
        .select(['topic', 'payload'])
        .where('topic', 'in', ['ride.sos', 'ride.attention'])
        .execute();
      expect(outbox.filter((e) => e.payload.rideId === id).map((e) => e.topic)).toEqual(
        expect.arrayContaining(['ride.sos', 'ride.attention']),
      );

      const sosId = mine[0].id as string;
      await admin
        .post(`/v1/admin/sos/${sosId}/resolve`)
        .send({ note: 'Qo‘ng‘iroq qilindi, hammasi joyida' })
        .expect(200);
      await admin.post(`/v1/admin/sos/${sosId}/resolve`).send({ note: 'Yana' }).expect(404);
      const open = await admin.get('/v1/admin/sos').expect(200);
      expect(open.body.some((s: { id: string }) => s.id === sosId)).toBe(false);
      const all = await admin.get('/v1/admin/sos?open=false').expect(200);
      expect(all.body.find((s: { id: string }) => s.id === sosId).resolutionNote).toBe(
        'Qo‘ng‘iroq qilindi, hammasi joyida',
      );
      await api(app, rider.accessToken).get('/v1/admin/sos').expect(403);
    });
  });

  describe('share trip', () => {
    it('shows the car and the live position to anyone with the link until the ride ends', async () => {
      const { rider, driver, id } = await assigned();
      const r = api(app, rider.accessToken);
      const link = await r.post(`/v1/rides/${id}/share`).expect(200);
      expect(link.body.url).toBe(`https://taxi.example.uz/t/${link.body.token}`);
      // the same link every time
      expect((await r.post(`/v1/rides/${id}/share`).expect(200)).body.token).toBe(link.body.token);

      await driver.http
        .post('/v1/driver/location')
        .send({ lat: GULISTON.lat + 0.001, lng: GULISTON.lng, heading: 180 })
        .expect(204);
      const seen = await api(app).get(`/v1/share/${link.body.token}`).expect(200);
      expect(seen.body).toMatchObject({
        status: 'driver_assigned',
        driver: { name: 'Aziz', rating: 4.8 },
        vehicle: { make: 'Chevrolet', model: 'Cobalt', colour: 'oq' },
        position: { lat: GULISTON.lat + 0.001, heading: 180 },
      });
      expect(seen.body.trail.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(seen.body)).not.toContain(rider.phone);
      expect(JSON.stringify(seen.body)).not.toContain('+998');

      await api(app).get('/v1/share/AAAAAAAAAAAAAAAAAAAAAAAA').expect(404);
      await api(app).get('/v1/share/short').expect(400);
      await r.post(`/v1/rides/${id}/cancel`).send({}).expect(200);
      await api(app).get(`/v1/share/${link.body.token}`).expect(410);
      await r.post(`/v1/rides/${id}/share`).expect(410);
      const stranger = await signIn(app);
      await api(app, stranger.accessToken).post(`/v1/rides/${id}/share`).expect(404);
    });
  });
});
