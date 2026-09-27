import { som } from './format';

/**
 * Card top-ups (`POST /v1/driver/topups {amount}` → Payme/Click checkout links; the provider
 * confirms to the API, which credits the balance once per payment). The app opens the
 * checkout page and waits: the stream's `topup.updated` (and the `topup_paid` push) says
 * when it is paid; polling `GET /v1/driver/topups/:id` is the fallback until then.
 */

export type TopupStatus =
  'pending' | 'paid' | 'expired' | 'cancelled' | 'refund_pending' | 'refunded';

export const PROVIDER_LABELS: Record<string, string> = { payme: 'Payme', click: 'Click' };

/** Quick amounts, so's. */
export const TOPUP_PRESETS = [20_000, 50_000, 100_000, 200_000] as const;

/** Typed text → whole so'm, or the reason it cannot be sent. */
export function parseTopupAmount(
  input: string,
  limits: { min: number; max: number },
): { amount: number } | { error: string } {
  const digits = input.replace(/[\s.,’'‘]/g, '');
  if (!/^\d+$/.test(digits)) return { error: 'Summani raqamlar bilan yozing' };
  const amount = Number(digits);
  if (amount < limits.min) return { error: `Kamida ${som(limits.min)}` };
  if (amount > limits.max) return { error: `Ko‘pi bilan ${som(limits.max)}` };
  return { amount };
}

/** What to suggest: enough to go online again, rounded up to 1 000, at least the minimum. */
export function suggestedTopup(shortBy: number, limits: { min: number; max: number }): number {
  const need = Math.ceil(Math.max(0, shortBy) / 1000) * 1000;
  return Math.min(limits.max, Math.max(limits.min, need));
}

export type TopupPhase = 'waiting' | 'paid' | 'failed';

export function topupPhase(status: string): TopupPhase {
  if (status === 'paid' || status === 'refund_pending' || status === 'refunded') return 'paid';
  if (status === 'expired' || status === 'cancelled') return 'failed';
  return 'waiting';
}

/**
 * How often to ask whether the payment went through: every 3 s for the first two minutes
 * (the driver is paying right now), then every 10 s until the intent expires. With the
 * event stream open the API announces the payment (`topup.updated`), so asking is only
 * the fallback for a missed event: every 15 s.
 */
export function topupPollMs(startedAt: number, now: number, streamOpen = false): number {
  if (streamOpen) return 15_000;
  return now - startedAt < 120_000 ? 3_000 : 10_000;
}

/**
 * The watched top-up's refetch interval: none once it is final (paid — by the event or by
 * the answer — expired or cancelled), else `topupPollMs`.
 */
export function topupRefetchMs(
  status: string | undefined,
  startedAt: number,
  now: number,
  streamOpen: boolean,
): number | false {
  if (status && topupPhase(status) !== 'waiting') return false;
  return topupPollMs(startedAt, now, streamOpen);
}

/**
 * The top-up after a `topup.updated` event (`status: 'paid'`): marked paid at once so the
 * screen stops asking; the refetch that follows brings `paidAt` and the provider.
 */
export function withPaidEvent<T extends { id: string; status: string; amount: number }>(
  topup: T | undefined,
  event: { intentId: string; status: string; amount: number },
): T | undefined {
  if (!topup || topup.id !== event.intentId || event.status !== 'paid') return topup;
  if (topupPhase(topup.status) === 'paid') return topup;
  return { ...topup, status: 'paid', amount: event.amount || topup.amount };
}

export const TOPUP_STATUS_TEXT: Record<TopupStatus, string> = {
  pending: 'To‘lov kutilmoqda',
  paid: 'To‘landi',
  expired: 'Muddati o‘tdi',
  cancelled: 'Bekor qilindi',
  refund_pending: 'Qaytarilmoqda',
  refunded: 'Qaytarildi',
};
