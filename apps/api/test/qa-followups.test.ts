import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { api, createDriver, createTestApp, GULISTON, MID, signIn } from './helpers.js';

/** API findings of the emulator QA of the rider and driver apps. */
describe('emulator QA follow-ups', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('offers only cash for a ride for later, which cannot be paid by card', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const later = new Date(Date.now() + 3 * 3600_000);
    const quote = await rider
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, scheduledFor: later.toISOString() })
      .expect(200);
    expect(quote.body.paymentMethods).toEqual(['cash']);
    expect(quote.body.cardProviders).toEqual([]);
  });

  it('tells the driver at once when the licence card was checked', async () => {
    const driver = await createDriver(app, { online: false });
    const events = await app
      .get(Database)
      .kysely.selectFrom('outbox')
      .select('payload')
      .where('topic', '=', 'driver.licence_checked')
      .execute();
    expect(events.map((e) => e.payload)).toContainEqual({ driverId: driver.id, result: 'valid' });
  });

  it('gives errors built from message templates the usual statusCode and error fields', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const tooSoon = new Date(Date.now() + 60_000);
    const res = await rider
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID, scheduledFor: tooSoon.toISOString() })
      .expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'BAD_REQUEST' });
    expect(res.body.message).toMatch(/Oldindan buyurtma/);
    expect(res.body.key).toBeTruthy();
  });
});
