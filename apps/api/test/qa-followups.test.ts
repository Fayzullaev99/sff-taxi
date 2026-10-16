import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { api, createDriver, createTestApp, GULISTON, MID, signIn, signInAdmin } from './helpers.js';

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

  it('lists a ride cancelled free in the history with no fee, its price kept apart (wave 5)', async () => {
    const rider = api(app, (await signIn(app)).accessToken);
    const quote = await rider
      .post('/v1/rides/quote')
      .send({ pickup: GULISTON, dropoff: MID })
      .expect(200);
    const ride = await rider
      .post('/v1/rides')
      .send({ quoteId: quote.body.quoteId, class: 'economy', clientRequestId: randomUUID() })
      .expect(201);
    await rider.post(`/v1/rides/${ride.body.id}/cancel`).send({}).expect(200);
    const history = await rider.get('/v1/rides').expect(200);
    const item = history.body.items.find((r: { id: string }) => r.id === ride.body.id);
    // the apps show the fee (0 here: "Bepul bekor qilindi"), never `quoted`, for a cancelled ride
    expect(item).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'rider',
      fare: { quoted: quote.body.fares.economy.total, cancellationFee: 0, total: null },
    });
    expect(item.fare.cancellationFeeStatus).toBeNull();
  });

  it('lets an operator set the car colour from the list, named per language (wave 5)', async () => {
    const driver = await createDriver(app, { online: false });
    const admin = api(app, (await signInAdmin(app)).accessToken);
    const red = await admin
      .patch(`/v1/admin/drivers/${driver.id}/vehicle`)
      .send({ colour: 'Qizil' })
      .expect(200);
    expect(red.body.vehicle).toMatchObject({ colour: 'qizil', colourCode: 'red' });
    const ru = await driver.http.get('/v1/driver/me').set('Accept-Language', 'ru').expect(200);
    expect(ru.body.vehicle).toMatchObject({ colour: 'красный', colourCode: 'red' });
    // text the list does not name stays as written, in every language
    const own = await admin
      .patch(`/v1/admin/drivers/${driver.id}/vehicle`)
      .send({ colour: 'xameleon' })
      .expect(200);
    expect(own.body.vehicle).toMatchObject({ colour: 'xameleon', colourCode: null });
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
