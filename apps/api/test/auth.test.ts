import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, lastOtp, signIn, signInAdmin, uniquePhone } from './helpers.js';

describe('auth', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('signs a new phone in with an SMS code and creates the account', async () => {
    const phone = uniquePhone();
    await api(app)
      .post('/v1/auth/code')
      .send({ phone: phone.slice(4) })
      .expect(202);
    const res = await api(app)
      .post('/v1/auth/verify')
      .send({ phone, code: lastOtp(app, phone), client: 'rider' })
      .expect(200);
    expect(res.body.isNewUser).toBe(true);
    const me = await api(app, res.body.accessToken).get('/v1/me').expect(200);
    expect(me.body).toMatchObject({ phone, isAdmin: false });

    const named = await api(app, res.body.accessToken)
      .patch('/v1/me')
      .send({ fullName: 'Aziza' })
      .expect(200);
    expect(named.body.fullName).toBe('Aziza');

    // one space between words (a keyboard's double space showed on the driver's screen)
    const spaced = await api(app, res.body.accessToken)
      .patch('/v1/me')
      .send({ fullName: '  Madinaxon  Abdulazizova \t Nurmuhammad qizi ' })
      .expect(200);
    expect(spaced.body.fullName).toBe('Madinaxon Abdulazizova Nurmuhammad qizi');
    await api(app, res.body.accessToken).patch('/v1/me').send({ fullName: '   ' }).expect(400);
  });

  it('rejects a wrong code and locks the code after too many attempts', async () => {
    const phone = uniquePhone();
    await api(app).post('/v1/auth/code').send({ phone }).expect(202);
    const code = lastOtp(app, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await api(app)
        .post('/v1/auth/verify')
        .send({ phone, code: wrong, client: 'rider' })
        .expect(400);
    }
    const locked = await api(app)
      .post('/v1/auth/verify')
      .send({ phone, code, client: 'rider' })
      .expect(400);
    expect(locked.body.message).toMatch(/Juda ko‘p/);
  });

  it('allows one code per minute per phone', async () => {
    const phone = uniquePhone();
    await api(app).post('/v1/auth/code').send({ phone }).expect(202);
    await api(app).post('/v1/auth/code').send({ phone }).expect(429);
  });

  it('signs a store reviewer in with the fixed code and no SMS', async () => {
    await api(app).post('/v1/auth/code').send({ phone: '+998900000099' }).expect(202);
    await api(app)
      .post('/v1/auth/verify')
      .send({ phone: '+998900000099', code: '123456', client: 'rider' })
      .expect(200);
  });

  it('rotates refresh tokens and revokes the family when one is reused', async () => {
    const session = await signIn(app);
    const first = await api(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    // the old token again: treated as stolen, everything in the family dies
    await api(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    await api(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);
  });

  it('logs out by revoking the session', async () => {
    const session = await signIn(app);
    await api(app).post('/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);
    await api(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('requires a token and keeps operator routes for operators', async () => {
    await api(app).get('/v1/me').expect(401);
    const rider = await signIn(app);
    await api(app, rider.accessToken).get('/v1/admin/settings/tariff').expect(403);
    const admin = await signInAdmin(app);
    const me = await api(app, admin.accessToken).get('/v1/me').expect(200);
    expect(me.body.isAdmin).toBe(true);
    await api(app, admin.accessToken).get('/v1/admin/settings/tariff').expect(200);
  });

  it('answers health checks', async () => {
    const res = await api(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });
});
