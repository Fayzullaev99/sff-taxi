import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { MAX_ATTEMPTS, OutboxDispatcher } from '../src/core/outbox/dispatcher.js';
import type { OutboxHandler } from '../src/core/outbox/handler.js';
import { REDIS } from '../src/core/redis/redis.token.js';
import { api, createDriver, createTestApp, GULISTON, signIn, signInAdmin } from './helpers.js';

/**
 * Regression tests for the production-readiness audit against the SFF Eats lessons checklist
 * (D:\sff-eats\docs\lessons-from-sff-automation.md; docs/audit.md here).
 */
describe('production-readiness audit', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('locks sign-in for a fixed-code phone after too many wrong codes, whatever codes were requested', async () => {
    // store-review phones sign in with a fixed code and no SMS, so asking for a new code is
    // free: every new code used to bring OTP_MAX_ATTEMPTS fresh guesses at the fixed code
    const phone = '+998900000099';
    const anon = api(app);
    for (let round = 0; round < 3; round++) {
      await anon.post('/v1/auth/code').send({ phone }).expect(202);
      for (let i = 0; i < 4; i++) {
        const res = await anon
          .post('/v1/auth/verify')
          .send({ phone, code: '000000', client: 'rider' });
        expect([400, 429]).toContain(res.status);
      }
    }
    await anon.post('/v1/auth/code').send({ phone }).expect(202);
    const locked = await anon
      .post('/v1/auth/verify')
      .send({ phone, code: '123456', client: 'rider' })
      .expect(429);
    expect(locked.body.message).toMatch(/noto‘g‘ri kod/);
    await app.get<Redis>(REDIS).del(`rl:otp:wrong:${phone}`);
    await anon
      .post('/v1/auth/verify')
      .send({ phone, code: '123456', client: 'rider' })
      .expect(200);
  });

  it('refuses an operator’s double click on a cash top-up', async () => {
    const driver = await createDriver(app, { online: false });
    const admin = api(app, (await signInAdmin(app)).accessToken);
    const url = `/v1/admin/billing/drivers/${driver.id}/ledger`;
    const [a, b] = await Promise.all([
      admin.post(url).send({ kind: 'topup', amount: 50_000 }),
      admin.post(url).send({ kind: 'topup', amount: 50_000 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // another amount is another decision
    await admin.post(url).send({ kind: 'topup', amount: 20_000 }).expect(201);
    const balance = await driver.http.get('/v1/driver/balance').expect(200);
    expect(balance.body.balance).toBe(70_000);
  });

  it('takes the wildcards an operator types in a search literally', async () => {
    const admin = api(app, (await signInAdmin(app)).accessToken);
    await createDriver(app, { online: false });
    const all = await admin.get('/v1/admin/drivers').expect(200);
    expect(all.body.length).toBeGreaterThan(0);
    // "%" used to match every driver and "_" every phone
    expect((await admin.get('/v1/admin/drivers?q=%25').expect(200)).body).toEqual([]);
    expect((await admin.get('/v1/admin/drivers?q=_').expect(200)).body).toEqual([]);
    expect((await admin.get('/v1/admin/rides?status=completed&q=%25').expect(200)).body).toEqual(
      [],
    );
  });

  describe('outbox', () => {
    const db = () => app.get(Database).kysely;
    const newEvent = async () => {
      const id = uuidv7();
      await db()
        .insertInto('outbox')
        .values({ id, topic: 'audit.probe', payload: JSON.stringify({ probe: true }) })
        .execute();
      return id;
    };
    const eventRow = (id: string) =>
      db().selectFrom('outbox').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

    beforeAll(async () => {
      // earlier events of this run have no worker: settle them so claims below see ours
      const drain = new OutboxDispatcher(app.get(Database), []);
      while ((await drain.runOnce()) > 0);
    });

    it('counts an attempt when it is claimed, so a crashing event cannot loop forever', async () => {
      const id = await newEvent();
      const dispatcher = new OutboxDispatcher(app.get(Database), []);
      // a worker claims the event and dies before finishing it
      expect((await dispatcher.claim())?.id).toBe(id);
      expect(await eventRow(id)).toMatchObject({ attempts: 1, processed_at: null });
      // leased: nobody else takes it right away...
      expect(await dispatcher.claim()).toBeNull();
      // ...but once the lease is over it is retried, and the attempts keep counting
      await db()
        .updateTable('outbox')
        .set({ next_attempt_at: new Date(), attempts: MAX_ATTEMPTS - 1 })
        .where('id', '=', id)
        .execute();
      expect((await dispatcher.claim())?.attempts).toBe(MAX_ATTEMPTS);
      await db()
        .updateTable('outbox')
        .set({ next_attempt_at: new Date() })
        .where('id', '=', id)
        .execute();
      // the last attempt was used up: it is dead, never claimed again
      expect(await dispatcher.claim()).toBeNull();

      // operators see it, and retry it once the cause is fixed
      const admin = api(app, (await signInAdmin(app)).accessToken);
      const dead = await admin.get('/v1/admin/outbox?state=dead').expect(200);
      expect(dead.body.map((e: { id: string }) => e.id)).toContain(id);
      await admin.post(`/v1/admin/outbox/${id}/retry`).expect(200);
      expect(await dispatcher.runOnce()).toBe(1);
      expect((await eventRow(id)).processed_at).not.toBeNull();
      await admin.post(`/v1/admin/outbox/${id}/retry`).expect(404);
      // riders and drivers do not see the queue
      const rider = await signIn(app);
      await api(app, rider.accessToken).get('/v1/admin/outbox').expect(403);
    });

    it('re-runs only the handlers that had not finished when a worker died', async () => {
      const id = await newEvent();
      const calls: string[] = [];
      const handler = (name: string, fail = false): OutboxHandler => ({
        name,
        handles: () => true,
        handle: async () => {
          if (fail) throw new Error('down');
          calls.push(name);
        },
      });
      const first = new OutboxDispatcher(app.get(Database), [
        handler('realtime'),
        handler('notifications', true),
      ]);
      await first.runOnce();
      expect(await eventRow(id)).toMatchObject({ attempts: 1, last_error: 'notifications: down' });
      await db()
        .updateTable('outbox')
        .set({ next_attempt_at: new Date() })
        .where('id', '=', id)
        .execute();
      const second = new OutboxDispatcher(app.get(Database), [
        handler('realtime'),
        handler('notifications'),
      ]);
      await second.runOnce();
      expect(calls).toEqual(['realtime', 'notifications']);
      expect((await eventRow(id)).processed_at).not.toBeNull();
    });
  });
});

describe('rate limits on public and costly routes', () => {
  let app: INestApplication;
  const previous = process.env.RATE_LIMIT_IP_MULTIPLIER;
  const clear = async () => {
    const redis = app.get<Redis>(REDIS);
    // sign-ins of earlier files count against this address too (otp:ip)
    const keys = [...(await redis.keys('rl:route:*')), ...(await redis.keys('rl:otp:ip:*'))];
    if (keys.length) await redis.del(...keys);
  };
  beforeAll(async () => {
    // production values: every test request comes from one address
    process.env.RATE_LIMIT_IP_MULTIPLIER = '1';
    app = await createTestApp();
    // earlier test files used this address in the same window
    await clear();
  });
  afterAll(async () => {
    process.env.RATE_LIMIT_IP_MULTIPLIER = previous;
    await clear();
    await app.close();
  });

  it('answers 429 once one address reads the public tariff too fast', async () => {
    const anon = api(app);
    const url = `/v1/tariffs?lat=${GULISTON.lat}&lng=${GULISTON.lng}`;
    for (let i = 0; i < 120; i++) await anon.get(url).expect(200);
    const res = await anon.get(url).expect(429);
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('limits quotes per rider, not per address', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const other = api(app, (await signIn(app)).accessToken);
    const body = { pickup: GULISTON, dropoff: { lat: 40.49, lng: 68.8 } };
    for (let i = 0; i < 30; i++) await rider.post('/v1/rides/quote').send(body).expect(200);
    await rider.post('/v1/rides/quote').send(body).expect(429);
    await other.post('/v1/rides/quote').send(body).expect(200);
  });
});
