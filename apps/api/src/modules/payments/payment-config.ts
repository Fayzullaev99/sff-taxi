import type { Env } from '../../config/env.js';
import type { PaymentProvider } from '../../core/db/schema.js';

/**
 * Which card providers are configured and where the payer pays. Pure functions of the
 * environment (the same as SFF Eats' payment-config.ts, keyed by payment intent).
 */

/** A card ride not paid within this many minutes is cancelled (the quote lives as long). */
export const RIDE_PAYMENT_MINUTES = 10;
/** A top-up not paid within this many minutes expires. */
export const TOPUP_PAYMENT_MINUTES = 30;
/** Top-up limits (so'm): below the minimum the provider fee is not worth it. */
export const TOPUP_MIN = 5_000;
export const TOPUP_MAX = 5_000_000;

export function enabledProviders(env: Env): PaymentProvider[] {
  const out: PaymentProvider[] = [];
  if (env.PAYME_MERCHANT_ID && env.PAYME_KEY) out.push('payme');
  if (env.CLICK_SERVICE_ID && env.CLICK_MERCHANT_ID && env.CLICK_SECRET) out.push('click');
  return out;
}

export type IntentPurpose = 'ride' | 'topup' | 'booking';

/**
 * Where the provider's page sends the payer back: the purpose's own URL (a ride payment to
 * the rider app, a top-up to the driver app), else the shared PAYMENT_RETURN_URL, else none.
 */
export function returnUrl(env: Env, purpose: IntentPurpose, intentId: string): string | null {
  const template =
    (purpose === 'topup' ? env.PAYMENT_RETURN_URL_TOPUP : env.PAYMENT_RETURN_URL_RIDE) ??
    env.PAYMENT_RETURN_URL;
  return template?.replaceAll('{intentId}', intentId) ?? null;
}

/** The provider's hosted checkout page for paying `amount` so'm for a payment intent. */
export function checkoutUrl(
  env: Env,
  provider: PaymentProvider,
  intentId: string,
  amount: number,
  purpose: IntentPurpose = 'ride',
): string {
  const back = returnUrl(env, purpose, intentId);
  if (provider === 'payme') {
    const host = env.PAYME_TEST ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz';
    // account field "order_id" in the Payme cashbox holds the intent id
    const params = [`m=${env.PAYME_MERCHANT_ID}`, `ac.order_id=${intentId}`, `a=${amount * 100}`];
    if (back) params.push(`c=${back}`);
    return `${host}/${Buffer.from(params.join(';')).toString('base64')}`;
  }
  const q = new URLSearchParams({
    service_id: env.CLICK_SERVICE_ID!,
    merchant_id: env.CLICK_MERCHANT_ID!,
    amount: String(amount),
    transaction_param: intentId,
    ...(back ? { return_url: back } : {}),
  });
  return `https://my.click.uz/services/pay?${q.toString()}`;
}

/** Checkout links for every configured provider. */
export function checkoutUrls(
  env: Env,
  intentId: string,
  amount: number,
  purpose: IntentPurpose = 'ride',
) {
  return Object.fromEntries(
    enabledProviders(env).map((p) => [p, checkoutUrl(env, p, intentId, amount, purpose)]),
  ) as Partial<Record<PaymentProvider, string>>;
}
