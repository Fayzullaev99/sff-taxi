import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import { Database, type Tx } from '../../core/db/database.js';
import { IntentsService } from './intents.service.js';

/**
 * Click SHOP API: Click calls Prepare (action 0) to check the payment and open a
 * transaction, then Complete (action 1) once the payer paid, or with error < 0 if they did
 * not. Requests are form-encoded and signed with an MD5 of the fields and our secret key.
 * `merchant_trans_id` is the payment intent's id. https://docs.click.uz/click-api-request/
 * Copied from SFF Eats, keyed by intent.
 */

type Params = Record<string, unknown>;
export type ClickResponse = Record<string, string | number>;
type Reply = (error: readonly [number, string], extra?: ClickResponse) => ClickResponse;

export const ERROR = {
  ok: [0, 'Success'],
  sign: [-1, 'SIGN CHECK FAILED!'],
  amount: [-2, 'Incorrect parameter amount'],
  action: [-3, 'Action not found'],
  paid: [-4, 'Already paid'],
  order: [-5, 'Order does not exist'],
  transaction: [-6, 'Transaction does not exist'],
  update: [-7, 'Failed to update user'],
  request: [-8, 'Error in request from click'],
  cancelled: [-9, 'Transaction cancelled'],
} as const;

const REQUIRED = [
  'click_trans_id',
  'service_id',
  'merchant_trans_id',
  'amount',
  'action',
  'sign_time',
  'sign_string',
];

export function clickSign(fields: (string | number)[]): string {
  return createHash('md5').update(fields.join('')).digest('hex');
}

@Injectable()
export class ClickService {
  private readonly logger = new Logger(ClickService.name);

  constructor(
    private readonly db: Database,
    private readonly intents: IntentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async handle(step: 'prepare' | 'complete', p: Params): Promise<ClickResponse> {
    const reply: Reply = (error, extra = {}) => ({
      click_trans_id: String(p.click_trans_id ?? ''),
      merchant_trans_id: String(p.merchant_trans_id ?? ''),
      ...extra,
      error: error[0],
      error_note: error[1],
    });
    const secret = this.env.CLICK_SECRET;
    const serviceId = this.env.CLICK_SERVICE_ID;
    if (!secret || !serviceId || REQUIRED.some((k) => p[k] === undefined || p[k] === '')) {
      return reply(ERROR.request);
    }
    const action = String(p.action);
    if ((step === 'prepare' && action !== '0') || (step === 'complete' && action !== '1')) {
      return reply(ERROR.action);
    }
    if (String(p.service_id) !== serviceId) return reply(ERROR.request);
    const signed = [
      String(p.click_trans_id),
      String(p.service_id),
      secret,
      String(p.merchant_trans_id),
      ...(step === 'complete' ? [String(p.merchant_prepare_id ?? '')] : []),
      String(p.amount),
      action,
      String(p.sign_time),
    ];
    if (!sameHex(clickSign(signed), String(p.sign_string))) return reply(ERROR.sign);

    try {
      return await this.db.transaction((trx) =>
        step === 'prepare' ? this.prepare(trx, p, reply) : this.complete(trx, p, reply),
      );
    } catch (error) {
      this.logger.error(`Click ${step} failed: ${(error as Error).message}`);
      return reply(ERROR.update);
    }
  }

  private async prepare(trx: Tx, p: Params, reply: Reply) {
    const existing = await this.find(trx, String(p.click_trans_id));
    if (existing) {
      if (existing.intent_id !== String(p.merchant_trans_id)) return reply(ERROR.transaction);
      if (existing.state === 'performed') return reply(ERROR.paid);
      if (existing.state !== 'created') return reply(ERROR.cancelled);
      return reply(ERROR.ok, { merchant_prepare_id: existing.seq });
    }
    const intent = await this.intents.lockPayable(trx, String(p.merchant_trans_id));
    if (intent === 'missing') return reply(ERROR.order);
    if (intent === 'paid') return reply(ERROR.paid);
    if (intent === 'closed') return reply(ERROR.cancelled);
    if (!sameAmount(p.amount, intent.amount)) return reply(ERROR.amount);

    const created = await trx
      .insertInto('payment_transactions')
      .values({
        id: uuidv7(),
        provider: 'click',
        external_id: String(p.click_trans_id),
        intent_id: intent.id,
        amount: intent.amount * 100,
        state: 'created',
      })
      .returning('seq')
      .executeTakeFirstOrThrow();
    return reply(ERROR.ok, { merchant_prepare_id: created.seq });
  }

  private async complete(trx: Tx, p: Params, reply: Reply) {
    const tx = await this.find(trx, String(p.click_trans_id), true);
    if (
      !tx ||
      String(tx.seq) !== String(p.merchant_prepare_id) ||
      tx.intent_id !== String(p.merchant_trans_id)
    ) {
      return reply(ERROR.transaction);
    }
    if (tx.state === 'performed') return reply(ERROR.paid, { merchant_confirm_id: tx.seq });
    if (tx.state !== 'created') return reply(ERROR.cancelled);

    // Click reports a failed or abandoned payment with a negative error
    if (Number(p.error ?? 0) < 0) {
      await this.markCancelled(trx, tx.id);
      return reply(ERROR.cancelled);
    }
    if (!sameAmount(p.amount, tx.amount / 100)) return reply(ERROR.amount);

    // prepared inside the payment window; completing it may run a little over
    const intent = await this.intents.lockPayable(trx, tx.intent_id, { checkWindow: false });
    if (typeof intent === 'string') {
      // the ride was cancelled (or paid by Payme) meanwhile: Click returns the money
      await this.markCancelled(trx, tx.id);
      return reply(intent === 'paid' ? ERROR.paid : ERROR.cancelled);
    }
    await this.intents.markPaid(trx, intent, 'click');
    await trx
      .updateTable('payment_transactions')
      .set({ state: 'performed', performed_at: new Date() })
      .where('id', '=', tx.id)
      .execute();
    return reply(ERROR.ok, { merchant_confirm_id: tx.seq });
  }

  private find(trx: Tx, clickTransId: string, lock = false) {
    return trx
      .selectFrom('payment_transactions')
      .selectAll()
      .where('provider', '=', 'click')
      .where('external_id', '=', clickTransId)
      .$if(lock, (q) => q.forUpdate())
      .executeTakeFirst();
  }

  private async markCancelled(trx: Tx, id: string) {
    await trx
      .updateTable('payment_transactions')
      .set({ state: 'cancelled', cancelled_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
}

/** Click sends amounts like "15000" or "15000.00"; ours are whole so'm. */
export function sameAmount(value: unknown, due: number): boolean {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n - due) < 0.005;
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}
