/**
 * Exponential backoff with jitter: base, 2×base, 4×base … capped at `maxMs`, each spread
 * over 50–100 % so a town's worth of phones coming back online do not retry in step.
 * `attempt` counts from 0.
 */
export function backoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: number = Math.random(),
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(30, Math.max(0, attempt)));
  return Math.round(exp * (0.5 + Math.min(1, Math.max(0, random)) / 2));
}

/** Resolves after `ms` (for retry loops). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
