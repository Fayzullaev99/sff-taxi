/**
 * Which GPS fix is good enough (pure, unit-tested). Phones hand out cached positions that
 * can be minutes old and network (cell / Wi-Fi) positions that are hundreds of metres off:
 * a pickup point wants a fresh fix within a few dozen metres, so older or vaguer fixes are
 * only a fallback when nothing better comes in time.
 */

export interface Fix {
  lat: number;
  lng: number;
  /** Radius of 68% confidence in metres; null when the platform did not say. */
  accuracyM: number | null;
  /** When the fix was taken (epoch ms). */
  at: number;
}

export interface FixRules {
  /** Older than this, a fix is stale. */
  maxAgeMs: number;
  /** Vaguer than this, a fix is not precise enough. */
  maxAccuracyM: number;
}

/** "My location" for a pickup: at most 30 s old and within 50 m. */
export const PRECISE: FixRules = { maxAgeMs: 30_000, maxAccuracyM: 50 };

/** The first map position on start: a couple of minutes old or a block off is fine. */
export const ROUGH: FixRules = { maxAgeMs: 2 * 60_000, maxAccuracyM: 500 };

export function fixAgeMs(fix: Fix, now: number): number {
  return Math.max(0, now - fix.at);
}

/** A fix that meets the rules: fresh and precise enough. Unknown accuracy counts as vague. */
export function isGoodFix(fix: Fix | null, now: number, rules: FixRules): fix is Fix {
  if (!fix) return false;
  if (fixAgeMs(fix, now) > rules.maxAgeMs) return false;
  return fix.accuracyM !== null && fix.accuracyM <= rules.maxAccuracyM;
}

/**
 * The better of two fixes: a good one beats one that is not; between two of the same kind
 * the more precise wins, unless the other is much newer (a phone on the move).
 */
export function betterFix(a: Fix | null, b: Fix | null, now: number, rules: FixRules): Fix | null {
  if (!a) return b;
  if (!b) return a;
  const goodA = isGoodFix(a, now, rules);
  const goodB = isGoodFix(b, now, rules);
  if (goodA !== goodB) return goodA ? a : b;
  const accA = a.accuracyM ?? Number.POSITIVE_INFINITY;
  const accB = b.accuracyM ?? Number.POSITIVE_INFINITY;
  // more than the freshness window apart: the newer one, the other describes the past
  if (Math.abs(a.at - b.at) > rules.maxAgeMs) return a.at > b.at ? a : b;
  if (accA !== accB) return accA < accB ? a : b;
  return a.at >= b.at ? a : b;
}

/** Fixes this far apart or more are different places (the map moves to the newer one). */
export const MOVE_THRESHOLD_M = 25;
