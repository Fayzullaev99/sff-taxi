import { som } from './format';

/**
 * Card top-ups (`POST /v1/driver/topups {amount}` → Payme/Click checkout links; the provider
 * confirms to the API, which credits the balance once per payment). The app opens the
 * checkout page and polls `GET /v1/driver/topups/:id` until the payment is final.
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
 * (the driver is paying right now), then every 10 s until the intent expires.
 */
export function topupPollMs(startedAt: number, now: number): number {
  return now - startedAt < 120_000 ? 3_000 : 10_000;
}

export const TOPUP_STATUS_TEXT: Record<TopupStatus, string> = {
  pending: 'To‘lov kutilmoqda',
  paid: 'To‘landi',
  expired: 'Muddati o‘tdi',
  cancelled: 'Bekor qilindi',
  refund_pending: 'Qaytarilmoqda',
  refunded: 'Qaytarildi',
};
