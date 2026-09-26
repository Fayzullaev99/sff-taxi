import { Inject, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import { Database, type Tx } from '../../core/db/database.js';
import { IntentsService, REASON_TIMEOUT } from './intents.service.js';

/**
 * Payme Merchant API (JSON-RPC 2.0): Payme calls us to check a payment, then create,
 * perform, cancel and report transactions for it. Amounts are in tiyin. The platform is the
 * merchant: one Payme cashbox for card rides and driver top-ups; the cashbox's account field
 * `order_id` carries the payment intent's id. Copied from SFF Eats, keyed by intent.
 * https://developer.help.paycom.uz/protokol-merchant-api/
 */

type Json = Record<string, unknown>;
type Message = { uz: string; ru: string; en: string };

export class PaymeError extends Error {
  constructor(
    readonly code: number,
    readonly text: Message,
    readonly data?: string,
  ) {
    super(text.en);
  }
}

const msg = (uz: string, ru: string, en: string): Message => ({ uz, ru, en });
export const ERR = {
  auth: () =>
    new PaymeError(
      -32504,
      msg('Ruxsat yo‘q', 'Недостаточно привилегий', 'Insufficient privileges'),
    ),
  method: () =>
    new PaymeError(-32601, msg('Metod topilmadi', 'Метод не найден', 'Method not found')),
  params: () =>
    new PaymeError(-32600, msg('Noto‘g‘ri so‘rov', 'Неверный запрос', 'Invalid request')),
  amount: () =>
    new PaymeError(-31001, msg('Noto‘g‘ri summa', 'Неверная сумма', 'Incorrect amount')),
  notFound: () =>
    new PaymeError(
      -31003,
      msg('Tranzaksiya topilmadi', 'Транзакция не найдена', 'Transaction not found'),
    ),
  cannotCancel: () =>
    new PaymeError(
      -31007,
      msg('Bekor qilib bo‘lmaydi', 'Невозможно отменить', 'Cannot cancel transaction'),
    ),
  cannotPerform: () =>
    new PaymeError(
      -31008,
      msg('Bajarib bo‘lmaydi', 'Невозможно выполнить операцию', 'Cannot perform operation'),
    ),
  order: () =>
    new PaymeError(
      -31050,
      msg('To‘lov topilmadi', 'Платёж не найден', 'Payment not found'),
      'order_id',
    ),
  orderClosed: () =>
    new PaymeError(
      -31051,
      msg('To‘lov kutilmayapti', 'Платёж не ожидается', 'Payment is not awaited'),
      'order_id',
    ),
  busy: () =>
    new PaymeError(
      -31099,
      msg(
        'Bu to‘lov bo‘yicha boshqa tranzaksiya kutilmoqda',
        'По платежу ожидается другая транзакция',
        'Another payment is pending',
      ),
      'order_id',
    ),
};

/** Payme cancels transactions not performed within 12 hours. */
export const TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const STATE = {
  created: 1,
  performed: 2,
  cancelled: -1,
  cancelledAfterPerform: -2,
} as const;

@Injectable()
export class PaymeService {
  private readonly logger = new Logger(PaymeService.name);

  constructor(
    private readonly db: Database,
    private readonly intents: IntentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Handles one JSON-RPC call. Always answers with a JSON-RPC response (HTTP 200). */
  async handle(authorization: string | undefined, body: Json): Promise<Json> {
    const id = body.id ?? null;
    try {
      const key = this.env.PAYME_KEY;
      if (!key || !this.env.PAYME_MERCHANT_ID || !authorised(authorization, key)) {
        throw ERR.auth();
      }
      const params = (body.params ?? {}) as Json;
      const result = await this.db.transaction(async (trx): Promise<unknown> => {
        switch (body.method) {
          case 'CheckPerformTransaction':
            return this.checkPerform(trx, params);
          case 'CreateTransaction':
            return this.create(trx, params);
          case 'PerformTransaction':
            return this.perform(trx, params);
          case 'CancelTransaction':
            return this.cancel(trx, params);
          case 'CheckTransaction':
            return this.check(trx, params);
          case 'GetStatement':
            return this.statement(trx, params);
          default:
            throw ERR.method();
        }
      });
      // returned rather than thrown when the transaction must still commit
      if (result instanceof PaymeError) throw result;
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (error instanceof PaymeError) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: error.code,
            message: error.text,
            ...(error.data ? { data: error.data } : {}),
          },
        };
      }
      this.logger.error(`Payme ${String(body.method)} failed: ${(error as Error).message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32400, message: msg('Tizim xatosi', 'Системная ошибка', 'System error') },
      };
    }
  }

  private async checkPerform(trx: Tx, params: Json) {
    await this.payable(trx, params);
    return { allow: true };
  }

  private async create(trx: Tx, params: Json) {
    const externalId = str(params.id);
    const time = num(params.time);
    const existing = await this.find(trx, externalId, true);
    if (existing) {
      if (existing.state !== 'created') throw ERR.cannotPerform();
      if (Date.now() - Number(existing.provider_time) > TIMEOUT_MS) {
        await this.markCancelled(trx, existing.id, REASON_TIMEOUT);
        return ERR.cannotPerform();
      }
      return {
        create_time: Number(existing.provider_time),
        transaction: existing.id,
        state: STATE.created,
      };
    }

    const intent = await this.payable(trx, params);
    const pending = await trx
      .selectFrom('payment_transactions')
      .select('id')
      .where('intent_id', '=', intent.id)
      .where('provider', '=', 'payme')
      .where('state', '=', 'created')
      .executeTakeFirst();
    if (pending) throw ERR.busy();

    const txId = uuidv7();
    await trx
      .insertInto('payment_transactions')
      .values({
        id: txId,
        provider: 'payme',
        external_id: externalId,
        intent_id: intent.id,
        amount: intent.amount * 100,
        state: 'created',
        provider_time: time,
      })
      .execute();
    return { create_time: time, transaction: txId, state: STATE.created };
  }

  private async perform(trx: Tx, params: Json) {
    const tx = await this.find(trx, str(params.id), true);
    if (!tx) throw ERR.notFound();
    if (tx.state === 'performed') {
      return {
        transaction: tx.id,
        perform_time: tx.performed_at!.getTime(),
        state: STATE.performed,
      };
    }
    if (tx.state !== 'created') throw ERR.cannotPerform();
    const intent = await this.intents.lockPayable(trx, tx.intent_id, {
      // Payme opened the transaction inside the window; finishing it may run over
      checkWindow: false,
    });
    if (Date.now() - Number(tx.provider_time) > TIMEOUT_MS || typeof intent === 'string') {
      // too late, or the ride was cancelled (or paid by Click) meanwhile: Payme returns the money
      await this.markCancelled(trx, tx.id, REASON_TIMEOUT);
      return ERR.cannotPerform();
    }
    await this.intents.markPaid(trx, intent, 'payme');
    const performedAt = new Date();
    await trx
      .updateTable('payment_transactions')
      .set({ state: 'performed', performed_at: performedAt })
      .where('id', '=', tx.id)
      .execute();
    return { transaction: tx.id, perform_time: performedAt.getTime(), state: STATE.performed };
  }

  private async cancel(trx: Tx, params: Json) {
    const tx = await this.find(trx, str(params.id), true);
    if (!tx) throw ERR.notFound();
    const reason = num(params.reason);
    if (tx.state === 'created') {
      const at = await this.markCancelled(trx, tx.id, reason);
      return { transaction: tx.id, cancel_time: at.getTime(), state: STATE.cancelled };
    }
    if (tx.state === 'performed') {
      // a refund from the Payme cabinet: the money went back to the payer
      const at = new Date();
      await trx
        .updateTable('payment_transactions')
        .set({ state: 'refunded', cancelled_at: at, cancel_reason: reason })
        .where('id', '=', tx.id)
        .execute();
      await this.intents.markRefunded(trx, tx.intent_id, 'payme');
      return { transaction: tx.id, cancel_time: at.getTime(), state: STATE.cancelledAfterPerform };
    }
    // already cancelled or refunded: the same answer again
    const view = paymeView(tx);
    return { transaction: tx.id, cancel_time: view.cancel_time, state: view.state };
  }

  private async check(trx: Tx, params: Json) {
    const tx = await this.find(trx, str(params.id));
    if (!tx) throw ERR.notFound();
    return paymeView(tx);
  }

  private async statement(trx: Tx, params: Json) {
    const from = num(params.from);
    const to = num(params.to);
    const rows = await trx
      .selectFrom('payment_transactions')
      .selectAll()
      .where('provider', '=', 'payme')
      .where('provider_time', '>=', from)
      .where('provider_time', '<=', to)
      .orderBy('provider_time')
      .execute();
    return {
      transactions: rows.map((tx) => ({
        id: tx.external_id,
        time: Number(tx.provider_time),
        amount: tx.amount,
        account: { order_id: tx.intent_id },
        ...paymeView(tx),
      })),
    };
  }

  /** The intent in params.account, waiting for payment, for exactly params.amount tiyin. */
  private async payable(trx: Tx, params: Json) {
    const account = (params.account ?? {}) as Json;
    const intentId = typeof account.order_id === 'string' ? account.order_id : '';
    const amount = num(params.amount);
    const intent = await this.intents.lockPayable(trx, intentId);
    if (intent === 'missing') throw ERR.order();
    if (typeof intent === 'string') throw ERR.orderClosed();
    if (amount !== intent.amount * 100) throw ERR.amount();
    return intent;
  }

  private find(trx: Tx, externalId: string, lock = false) {
    return trx
      .selectFrom('payment_transactions')
      .selectAll()
      .where('provider', '=', 'payme')
      .where('external_id', '=', externalId)
      .$if(lock, (q) => q.forUpdate())
      .executeTakeFirst();
  }

  private async markCancelled(trx: Tx, id: string, reason: number) {
    const at = new Date();
    await trx
      .updateTable('payment_transactions')
      .set({ state: 'cancelled', cancelled_at: at, cancel_reason: reason })
      .where('id', '=', id)
      .execute();
    return at;
  }
}

/** Payme sends "Basic base64(Paycom:<key>)". */
export function authorised(header: string | undefined, key: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const given = Buffer.from(header.slice(6), 'base64');
  const expected = Buffer.from(`Paycom:${key}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function paymeView(tx: {
  id: string;
  state: string;
  provider_time: number | null;
  performed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: number | null;
}) {
  const state = {
    created: STATE.created,
    performed: STATE.performed,
    cancelled: STATE.cancelled,
    refunded: STATE.cancelledAfterPerform,
  }[tx.state]!;
  return {
    create_time: Number(tx.provider_time),
    perform_time: tx.performed_at?.getTime() ?? 0,
    cancel_time: tx.cancelled_at?.getTime() ?? 0,
    transaction: tx.id,
    state,
    reason: tx.cancel_reason,
  };
}

function str(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 100) throw ERR.params();
  return v;
}

function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw ERR.params();
  return v;
}
