import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Database } from '../src/core/db/database.js';
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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pick = () => LETTERS[randomInt(LETTERS.length)]!;
const digits = (n: number) => String(randomInt(10 ** n)).padStart(n, '0');

/** A valid driver application with unique documents and plate. */
export function application(
  over: Record<string, unknown> = {},
  vehicle: Record<string, unknown> = {},
) {
  return {
    fullName: 'Aziz Karimov',
    birthDate: '1990-05-01',
    pinfl: `3${digits(13)}`,
    licenceNumber: `A${pick()}${digits(7)}`,
    licenceCategories: ['B'],
    licenceIssuedOn: '2012-03-01',
    licenceCardNumber: `LK-${digits(8)}`,
    licenceCardExpiresOn: '2030-01-01',
    ...over,
    vehicle: {
      make: 'Chevrolet',
      model: 'Cobalt',
      colour: 'oq',
      plate: `20 ${pick()} ${digits(3)} ${pick()}${pick()}`,
      year: 2021,
      seats: 4,
      class: 'economy',
      features: ['ac'],
      ...vehicle,
    },
  };
}

export const ALL_DOCUMENTS = [
  'licence_card',
  'driver_licence',
  'passport',
  'vehicle_registration',
  'insurance',
  'vehicle_photo',
  'selfie',
] as const;

export interface DriverFixture {
  id: string;
  session: Session;
  http: ReturnType<typeof api>;
}

/**
 * A driver through the real flow: application, documents, operator approval, optionally
 * a balance top-up, then online at `at` (Guliston centre by default).
 */
export async function createDriver(
  app: INestApplication,
  opts: {
    at?: { lat: number; lng: number } | null;
    vehicle?: Record<string, unknown>;
    topup?: number;
    online?: boolean;
  } = {},
): Promise<DriverFixture> {
  const session = await signIn(app, uniquePhone(), 'driver');
  const http = api(app, session.accessToken);
  const applied = await http
    .post('/v1/driver/application')
    .send(application({}, opts.vehicle))
    .expect(200);
  const id = applied.body.id as string;
  for (const kind of ALL_DOCUMENTS) {
    await http
      .put(`/v1/driver/documents/${kind}`)
      .send({ url: `https://files.example.uz/${id}/${kind}.jpg` })
      .expect(200);
  }
  const admin = api(app, (await signInAdmin(app)).accessToken);
  // the licence card checked in the Ministry's registry (manual registry), then approval
  await admin
    .post(`/v1/admin/drivers/${id}/licence`)
    .send({ result: 'valid', note: 'Reyestrda tekshirildi' })
    .expect(200);
  await admin.post(`/v1/admin/drivers/${id}/approve`).send({}).expect(200);
  if (opts.topup) {
    await admin
      .post(`/v1/admin/billing/drivers/${id}/ledger`)
      .send({ kind: 'topup', amount: opts.topup })
      .expect(201);
  }
  if (opts.online !== false) {
    await http.post('/v1/driver/shift').send({ online: true }).expect(200);
    if (opts.at !== null)
      await http
        .post('/v1/driver/location')
        .send(opts.at ?? GULISTON)
        .expect(204);
  }
  return { id, session, http };
}

/** Points inside Guliston: ~1.35 km, ~2.9 km and ~7.3 km (estimated road) from the centre. */
export const NEAR = { lat: 40.505, lng: 68.7759 };
export const MID = { lat: 40.49, lng: 68.8 };
export const FAR = { lat: 40.54, lng: 68.75 };

/** Quote and order a ride the way the rider app does. */
export async function orderRide(
  app: INestApplication,
  rider: Session,
  opts: {
    pickup?: { lat: number; lng: number };
    dropoff?: { lat: number; lng: number };
    class?: 'economy' | 'comfort';
    options?: string[];
    comment?: string;
  } = {},
) {
  const http = api(app, rider.accessToken);
  const quote = await http
    .post('/v1/rides/quote')
    .send({
      pickup: opts.pickup ?? GULISTON,
      dropoff: opts.dropoff ?? MID,
      options: opts.options ?? [],
    })
    .expect(200);
  const ride = await http
    .post('/v1/rides')
    .send({
      quoteId: quote.body.quoteId,
      class: opts.class ?? 'economy',
      pickup: { address: 'Guliston, Mustaqillik 12', landmark: 'Bozor yonida' },
      dropoff: { address: 'Guliston temir yo‘l vokzali', landmark: null },
      comment: opts.comment ?? null,
      clientRequestId: randomUUID(),
    })
    .expect(201);
  return { quote: quote.body, ride: ride.body, id: ride.body.id as string };
}

/**
 * Test files share one database: before looking at dispatch, clear what earlier files left
 * behind — pending offers, rides still searching and drivers on shift.
 */
export async function quiesce(app: INestApplication): Promise<void> {
  const db = app.get(Database).kysely;
  await db
    .updateTable('ride_offers')
    .set({ status: 'withdrawn' })
    .where('status', '=', 'pending')
    .execute();
  await db
    .updateTable('rides')
    .set({ status: 'cancelled', cancelled_by: 'system', cancelled_at: new Date() })
    .where('status', 'in', ['searching', 'scheduled'])
    .execute();
  await db.updateTable('drivers').set({ is_online: false }).execute();
}

/** The start code of a ride (night, shared, women-only and intercity rides have one). */
export async function startPin(app: INestApplication, rideId: string): Promise<string | null> {
  const row = await app
    .get(Database)
    .kysely.selectFrom('rides')
    .select('start_pin')
    .where('id', '=', rideId)
    .executeTakeFirstOrThrow();
  return row.start_pin;
}
