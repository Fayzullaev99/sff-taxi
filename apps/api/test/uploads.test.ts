import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import { detectFileType } from '../src/modules/uploads/file-types.js';
import type { ObjectStorage } from '../src/modules/uploads/object-storage.js';
import { OBJECT_STORAGE, UploadsService } from '../src/modules/uploads/uploads.service.js';
import {
  api,
  createDriver,
  createTestApp,
  GULISTON,
  orderRide,
  signIn,
  signInAdmin,
} from './helpers.js';

/**
 * Presigning is local, so access and validation run everywhere. The round trip (PUT to the
 * presigned URL, the check, the presigned read) needs SeaweedFS: `docker compose up -d s3`
 * (CI runs it as a service and sets CI=true, which makes a missing storage a failure).
 */
const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8335';
const BUCKET = 'sff-taxi-test';
const STORAGE_ENV = {
  STORAGE_S3_ENDPOINT: S3_ENDPOINT,
  STORAGE_S3_BUCKET: BUCKET,
  STORAGE_S3_ACCESS_KEY: 'taxi_dev_access',
  STORAGE_S3_SECRET_KEY: 'taxi_dev_secret_0123456789',
};

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
const s3Up = await reachable(S3_ENDPOINT);
if (!s3Up && process.env.CI === 'true') throw new Error(`S3 not reachable at ${S3_ENDPOINT}`);

// a 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe('uploads', () => {
  let app: INestApplication;
  beforeAll(async () => {
    Object.assign(process.env, STORAGE_ENV);
    app = await createTestApp();
    if (s3Up) await app.get<ObjectStorage>(OBJECT_STORAGE).ensureBucket();
  });
  afterAll(async () => {
    await app.close();
    for (const key of Object.keys(STORAGE_ENV)) delete process.env[key];
  });

  /** Registers, PUTs and completes a file the way the driver app does. */
  async function upload(
    http: ReturnType<typeof api>,
    purpose: 'document' | 'profile_photo' | 'vehicle_photo',
    body: Buffer = PNG,
    contentType = 'image/png',
  ): Promise<string> {
    const created = await http
      .post('/v1/uploads')
      .send({ purpose, contentType, sizeBytes: body.length })
      .expect(201);
    const put = await fetch(created.body.upload.url, {
      method: 'PUT',
      headers: created.body.upload.headers,
      body,
    });
    expect(put.status).toBe(200);
    await http.post(`/v1/uploads/${created.body.id}/complete`).expect(200);
    return created.body.id as string;
  }

  it('recognises files by their bytes', () => {
    expect(detectFileType(PNG)).toBe('image/png');
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectFileType(PDF)).toBe('application/pdf');
    expect(detectFileType(Buffer.from('<html><script>'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\0'))).toBeNull();
  });

  it('hands out presigned PUTs by purpose, type and size', async () => {
    const user = api(app, (await signIn(app)).accessToken);
    const config = await user.get('/v1/uploads/config').expect(200);
    expect(config.body).toMatchObject({
      enabled: true,
      purposes: {
        document: { maxBytes: 10 * 1024 * 1024 },
        profile_photo: { contentTypes: ['image/jpeg', 'image/png', 'image/webp'] },
      },
    });

    const res = await user
      .post('/v1/uploads')
      .send({ purpose: 'document', contentType: 'application/pdf', sizeBytes: 1000 })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'pending', purpose: 'document' });
    expect(res.body.upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(res.body.upload.url).toMatch(
      new RegExp(`^${S3_ENDPOINT}/${BUCKET}/u/[0-9a-f-]{36}/document/[A-Za-z0-9_-]{22}\\.pdf\\?`),
    );
    expect(res.body.upload.url).toContain('X-Amz-Signature=');

    // a photo riders see is an image, never a PDF; sizes per purpose
    const pdfPhoto = await user
      .post('/v1/uploads')
      .send({ purpose: 'profile_photo', contentType: 'application/pdf', sizeBytes: 1000 })
      .expect(400);
    expect(pdfPhoto.body.message).toMatch(/JPEG, PNG yoki WebP/);
    await user
      .post('/v1/uploads')
      .send({ purpose: 'vehicle_photo', contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 })
      .expect(400);
    const svg = await user
      .post('/v1/uploads')
      .send({ purpose: 'document', contentType: 'image/svg+xml', sizeBytes: 10 })
      .expect(400);
    expect(svg.body.issues[0].message).toBe('Faqat JPEG, PNG, WebP rasm yoki PDF yuklash mumkin');
    await api(app).post('/v1/uploads').send({}).expect(401);
  });

  it.skipIf(!s3Up)('stores what the app PUTs, checks it and serves it privately', async () => {
    const owner = api(app, (await signIn(app)).accessToken);
    const created = await owner
      .post('/v1/uploads')
      .send({ purpose: 'document', contentType: 'image/png', sizeBytes: PNG.length })
      .expect(201);
    // nothing there yet
    await owner.post(`/v1/uploads/${created.body.id}/complete`).expect(409);
    const put = await fetch(created.body.upload.url, {
      method: 'PUT',
      headers: created.body.upload.headers,
      body: PNG,
    });
    expect(put.status).toBe(200);
    // the signature covers the type: another one is refused by the storage itself
    const wrongType = await fetch(created.body.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: PNG,
    });
    expect(wrongType.status).toBeGreaterThanOrEqual(400);

    // strangers cannot complete or read it
    const stranger = api(app, (await signIn(app)).accessToken);
    await stranger.post(`/v1/uploads/${created.body.id}/complete`).expect(404);

    const done = await owner.post(`/v1/uploads/${created.body.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ status: 'ready', contentType: 'image/png' });
    await owner.post(`/v1/uploads/${created.body.id}/complete`).expect(200);
    const read = await fetch(done.body.url);
    expect(read.status).toBe(200);
    expect(Buffer.from(await read.arrayBuffer()).equals(PNG)).toBe(true);

    // the bucket is private: the object URL without a signature is refused
    const bare = (done.body.url as string).split('?')[0]!;
    expect((await fetch(bare)).status).toBe(403);

    await stranger.get(`/v1/uploads/${created.body.id}`).expect(404);
    const admin = api(app, (await signInAdmin(app)).accessToken);
    const seen = await admin.get(`/v1/uploads/${created.body.id}`).expect(200);
    expect(seen.body.url).toContain('X-Amz-Signature=');
  });

  it.skipIf(!s3Up)('deletes an upload whose bytes are not what was declared', async () => {
    const owner = api(app, (await signIn(app)).accessToken);
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const created = await owner
      .post('/v1/uploads')
      .send({ purpose: 'document', contentType: 'application/pdf', sizeBytes: html.length })
      .expect(201);
    await fetch(created.body.upload.url, {
      method: 'PUT',
      headers: created.body.upload.headers,
      body: html,
    });
    const refused = await owner.post(`/v1/uploads/${created.body.id}/complete`).expect(400);
    expect(refused.body.message).toMatch(/turga mos emas/);
    await owner.post(`/v1/uploads/${created.body.id}/complete`).expect(404);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const row = await app
      .get(Database)
      .kysely.selectFrom('uploads')
      .select('id')
      .where('id', '=', created.body.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
    const key = new URL(created.body.upload.url).pathname.slice(BUCKET.length + 2);
    expect(await storage.head(key)).toBeNull();
  });

  it.skipIf(!s3Up)(
    'attaches documents and photos to the driver, shown to whom may see them',
    async () => {
      const driver = await createDriver(app, { online: true, at: GULISTON });
      // a PDF scan of the passport replaces the old URL
      const passport = await upload(driver.http, 'document', PDF, 'application/pdf');
      const me = await driver.http
        .put('/v1/driver/documents/passport')
        .send({ uploadId: passport })
        .expect(200);
      const doc = me.body.documents.find((d: { kind: string }) => d.kind === 'passport');
      expect(doc).toMatchObject({ uploadId: passport });
      expect(doc.url).toContain('X-Amz-Signature=');
      expect((await fetch(doc.url)).status).toBe(200);
      // not both, not neither
      await driver.http
        .put('/v1/driver/documents/insurance')
        .send({ uploadId: passport, url: 'https://files.example.uz/x.jpg' })
        .expect(400);

      // someone else's file, a file not completed, a file for another purpose: refused
      const other = api(app, (await signIn(app)).accessToken);
      const foreign = await upload(other, 'document');
      await driver.http
        .put('/v1/driver/documents/insurance')
        .send({ uploadId: foreign })
        .expect(404);
      const pending = await driver.http
        .post('/v1/uploads')
        .send({ purpose: 'document', contentType: 'image/png', sizeBytes: PNG.length })
        .expect(201);
      await driver.http
        .put('/v1/driver/documents/insurance')
        .send({ uploadId: pending.body.id })
        .expect(409);
      const photo = await upload(driver.http, 'profile_photo');
      await driver.http.put('/v1/driver/documents/insurance').send({ uploadId: photo }).expect(400);
      await driver.http.put('/v1/driver/vehicle/photo').send({ uploadId: photo }).expect(400);

      // the face and the car riders see
      await driver.http.put('/v1/driver/photo').send({ uploadId: photo }).expect(200);
      const car = await upload(driver.http, 'vehicle_photo');
      const profile = await driver.http
        .put('/v1/driver/vehicle/photo')
        .send({ uploadId: car })
        .expect(200);
      expect(profile.body.photoUrl).toContain('X-Amz-Signature=');
      expect(profile.body.vehicle.photoUrl).toContain('X-Amz-Signature=');

      // operators verify from the same view
      const admin = api(app, (await signInAdmin(app)).accessToken);
      const verified = await admin.get(`/v1/admin/drivers/${driver.id}`).expect(200);
      expect(
        verified.body.documents.find((d: { kind: string }) => d.kind === 'passport').url,
      ).toContain('X-Amz-Signature=');

      // the rider of the driver's ride sees the face and the car, never the documents
      const rider = await signIn(app);
      const { id } = await orderRide(app, rider);
      await admin.post(`/v1/admin/rides/${id}/assign`).send({ driverId: driver.id }).expect(200);
      const view = await api(app, rider.accessToken).get(`/v1/rides/${id}`).expect(200);
      expect(view.body.driver.photoUrl).toContain('X-Amz-Signature=');
      expect(view.body.driver.vehiclePhotoUrl).toContain('X-Amz-Signature=');
      expect(JSON.stringify(view.body)).not.toContain('/document/');
      await admin.post(`/v1/admin/rides/${id}/cancel`).send({ reason: 'Test tugadi' }).expect(200);
    },
  );

  it.skipIf(!s3Up)('removes uploads that were never completed after a day', async () => {
    const owner = api(app, (await signIn(app)).accessToken);
    const created = await owner
      .post('/v1/uploads')
      .send({ purpose: 'document', contentType: 'image/png', sizeBytes: PNG.length })
      .expect(201);
    const done = await upload(owner, 'document');
    const db = app.get(Database).kysely;
    await db
      .updateTable('uploads')
      .set({ created_at: new Date(Date.now() - 25 * 3_600_000) } as never)
      .where('id', 'in', [created.body.id, done])
      .execute();
    expect(await app.get(UploadsService).removeAbandoned()).toBeGreaterThanOrEqual(1);
    const left = await db
      .selectFrom('uploads')
      .select('id')
      .where('id', 'in', [created.body.id, done])
      .execute();
    expect(left.map((r) => r.id)).toEqual([done]);
  });
});

describe('uploads without storage', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('answers 503 until STORAGE_S3_* is set', async () => {
    const user = api(app, (await signIn(app)).accessToken);
    const config = await user.get('/v1/uploads/config').expect(200);
    expect(config.body.enabled).toBe(false);
    const res = await user
      .post('/v1/uploads')
      .send({ purpose: 'document', contentType: 'image/png', sizeBytes: 10 })
      .expect(503);
    expect(res.body.message).toBe('Fayl yuklash serverda hali sozlanmagan');
  });
});
