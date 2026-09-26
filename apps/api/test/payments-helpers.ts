import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';

// PAYME_* / CLICK_* in vitest.config.ts
export const PAYME_KEY = 'test-payme-merchant-key';
export const CLICK_SERVICE = '12345';
export const CLICK_SECRET = 'test-click-secret-key';

/** One Payme Merchant API call, as Payme makes it (Basic auth with the cashbox key). */
export function payme(
  app: INestApplication,
  method: string,
  params: Record<string, unknown>,
  key: string | null = PAYME_KEY,
) {
  const req = request(app.getHttpServer()).post('/v1/payments/payme');
  if (key) req.set('Authorization', `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}`);
  return req.send({ jsonrpc: '2.0', id: 42, method, params }).expect(200);
}

/** A Click SHOP API call, form-encoded and signed as Click signs it. */
export function click(
  app: INestApplication,
  step: 'prepare' | 'complete',
  fields: Record<string, string | number>,
  secret = CLICK_SECRET,
) {
  const body: Record<string, string | number> = {
    service_id: CLICK_SERVICE,
    click_paydoc_id: '777',
    action: step === 'prepare' ? 0 : 1,
    error: 0,
    error_note: 'Success',
    sign_time: '2026-09-26 12:00:00',
    ...fields,
  };
  const signed = [
    body.click_trans_id,
    body.service_id,
    secret,
    body.merchant_trans_id,
    ...(step === 'complete' ? [String(body.merchant_prepare_id)] : []),
    body.amount,
    body.action,
    body.sign_time,
  ].join('');
  return request(app.getHttpServer())
    .post(`/v1/payments/click/${step}`)
    .type('form')
    .send({ ...body, sign_string: createHash('md5').update(signed).digest('hex') })
    .expect(200);
}

/** The whole Payme flow for an intent: create, then perform. Returns Payme's transaction id. */
export async function payWithPayme(
  app: INestApplication,
  intentId: string,
  amount: number,
): Promise<string> {
  const id = `pm-${randomUUID()}`;
  const created = await payme(app, 'CreateTransaction', {
    id,
    time: Date.now(),
    amount: amount * 100,
    account: { order_id: intentId },
  });
  expect(created.body.result?.state).toBe(1);
  const performed = await payme(app, 'PerformTransaction', { id });
  expect(performed.body.result?.state).toBe(2);
  return id;
}

/** The whole Click flow for an intent: prepare, then complete. */
export async function payWithClick(app: INestApplication, intentId: string, amount: number) {
  const clickTransId = String(Date.now() + Math.floor(Math.random() * 1000));
  const prepared = await click(app, 'prepare', {
    click_trans_id: clickTransId,
    merchant_trans_id: intentId,
    amount,
  });
  expect(prepared.body.error).toBe(0);
  const completed = await click(app, 'complete', {
    click_trans_id: clickTransId,
    merchant_trans_id: intentId,
    merchant_prepare_id: prepared.body.merchant_prepare_id,
    amount,
  });
  expect(completed.body.error).toBe(0);
  return clickTransId;
}
