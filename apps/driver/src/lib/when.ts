/**
 * Dates and times as drivers read them: Tashkent (UTC+5, no DST), whatever the phone's
 * time zone is set to.
 */

const TASHKENT_OFFSET_MS = 5 * 3_600_000;

/** The Tashkent date `days` days from `at` (YYYY-MM-DD). */
export function tashkentDate(at: number, days = 0): string {
  return new Date(at + TASHKENT_OFFSET_MS + days * 86_400_000).toISOString().slice(0, 10);
}

/** "18:30" in Tashkent. */
export function tashkentClock(at: number): string {
  return new Date(at + TASHKENT_OFFSET_MS).toISOString().slice(11, 16);
}

/** "Bugun", "Ertaga", "Kecha" or "28.09" for a Tashkent date relative to `now`. */
export function dayLabel(date: string, now: number): string {
  if (date === tashkentDate(now)) return 'Bugun';
  if (date === tashkentDate(now, 1)) return 'Ertaga';
  if (date === tashkentDate(now, -1)) return 'Kecha';
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

/** "Bugun 18:30", "Ertaga 07:00", "28.09 07:00" — or "" for a missing/bad time. */
export function whenLabel(iso: string | null | undefined, now: number): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return '';
  return `${dayLabel(tashkentDate(at), now)} ${tashkentClock(at)}`;
}

/**
 * A ride ordered for later (`scheduledFor`): "Oldindan buyurtma · Ertaga 07:00", or null
 * for a ride ordered for now.
 */
export function scheduledLabel(iso: string | null | undefined, now: number): string | null {
  const when = whenLabel(iso, now);
  return when ? `Oldindan buyurtma · ${when}` : null;
}

/** Minutes until `iso` (negative once past), rounded down; null for a bad time. */
export function minutesUntil(iso: string | null | undefined, now: number): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? null : Math.floor((at - now) / 60_000);
}
