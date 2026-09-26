import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ConsoleSmsProvider } from '../src/core/sms/console.provider.js';
import { SMS_PROVIDER } from '../src/core/sms/sms.provider.js';

/** The platform operator configured in vitest.config.ts. */
export const ADMIN_PHONE = '+998900000001';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
  await app.init();
  return app;
}

const usedPhones = new Set<string>();

/** Valid Uzbek number not yet used in this run. */
export function uniquePhone(): string {
  let phone: string;
  do phone = `+99891${String(randomInt(10_000_000)).padStart(7, '0')}`;
  while (usedPhones.has(phone));
  usedPhones.add(phone);
  return phone;
}

/** The code from the last SMS the console provider "sent" to this phone. */
export function lastOtp(app: INestApplication, phone: string): string {
  const sms = app.get<ConsoleSmsProvider>(SMS_PROVIDER);
  const code = sms.lastTo(phone)?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No OTP SMS was sent to ${phone}`);
  return code;
}

export interface Session {
  phone: string;
  accessToken: string;
  refreshToken: string;
}

/** The real SMS sign-in flow. */
export async function signIn(
  app: INestApplication,
  phone = uniquePhone(),
  client: 'rider' | 'driver' | 'admin' = 'rider',
): Promise<Session> {
  const http = request(app.getHttpServer());
  await http.post('/v1/auth/code').send({ phone }).expect(202);
  const res = await request(app.getHttpServer())
    .post('/v1/auth/verify')
    .send({ phone, code: lastOtp(app, phone), client })
    .expect(200);
  return { phone, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

/** The operator signs in with a fixed code (vitest.config.ts), so no SMS and no resend limit. */
export async function signInAdmin(app: INestApplication): Promise<Session> {
  await request(app.getHttpServer()).post('/v1/auth/code').send({ phone: ADMIN_PHONE }).expect(202);
  const res = await request(app.getHttpServer())
    .post('/v1/auth/verify')
    .send({ phone: ADMIN_PHONE, code: '111111', client: 'admin' })
    .expect(200);
  return {
    phone: ADMIN_PHONE,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export function api(app: INestApplication, token?: string) {
  const agent = request(app.getHttpServer());
  const auth = <T extends request.Test>(t: T) =>
    token ? t.set('Authorization', `Bearer ${token}`) : t;
  return {
    get: (url: string) => auth(agent.get(url)),
    post: (url: string) => auth(agent.post(url)),
    patch: (url: string) => auth(agent.patch(url)),
    put: (url: string) => auth(agent.put(url)),
    delete: (url: string) => auth(agent.delete(url)),
  };
}

/** Central Guliston, the launch city (migrations/0002_geo.sql). */
export const GULISTON = { lat: 40.49598, lng: 68.77587 };
