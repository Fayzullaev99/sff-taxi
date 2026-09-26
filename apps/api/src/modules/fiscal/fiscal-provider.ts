import type { Env } from '../../config/env.js';
import type { ReceiptPayload } from './receipt-payload.js';

/** What the provider answers for an issued receipt. */
export interface IssuedReceipt {
  /** The provider's (OFD's) receipt id. */
  receiptId: string;
  /** The fiscal sign printed on the receipt. */
  fiscalSign: string | null;
  /** The public link to the receipt (the QR code on it), shown to the rider. */
  url: string;
}

/**
 * Issues electronic fiscal receipts through the tax authority's online fiscal data operator
 * (OFD). Resolution 200 requires the aggregator to issue one for every ride, cash rides too.
 *
 * - issue() returns null when the provider does not send anything ('none'): the receipt is
 *   prepared and kept as 'skipped', ready to be sent once a provider is switched on.
 * - it throws on a temporary failure: the worker retries the outbox event with backoff.
 * - it must be idempotent on payload.receiptNumber: a retry after a timeout must not issue
 *   a second receipt (OFD APIs accept the merchant's own receipt id for this).
 *
 * To add the real integration: implement this for the OFD operator's API (docs/
 * fiscal-and-licence.md lists what is needed from Soliq), add its name to FISCAL_PROVIDER in
 * src/config/env.ts and return it from createFiscalProvider.
 */
export interface FiscalProvider {
  readonly name: string;
  issue(payload: ReceiptPayload): Promise<IssuedReceipt | null>;
}

export const FISCAL_PROVIDER = Symbol('FISCAL_PROVIDER');

/** Until the OFD integration is contracted: receipts are prepared, not sent. */
export class NoFiscalProvider implements FiscalProvider {
  readonly name = 'none';

  issue(): Promise<IssuedReceipt | null> {
    return Promise.resolve(null);
  }
}

export function createFiscalProvider(env: Env): FiscalProvider {
  switch (env.FISCAL_PROVIDER) {
    case 'none':
      return new NoFiscalProvider();
  }
}
