/** Uzbekistan keeps UTC+5 all year (no daylight saving time). */
const TASHKENT_OFFSET_MINUTES = 5 * 60;

export interface OpeningInterval {
  weekday: number;
  /** "HH:MM" or "HH:MM:SS" */
  opens: string;
  closes: string;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

/** Weekday (0 = Sunday) and minute of the day in Tashkent. */
export function tashkentClock(now: Date): { weekday: number; minute: number } {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MINUTES * 60_000);
  return { weekday: local.getUTCDay(), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * Whether a weekly schedule is open at `now`. An interval whose closing time is
 * not after its opening time runs past midnight into the next day
 * (22:00–03:00), and 00:00–00:00 means around the clock.
 */
export function isOpenAt(hours: readonly OpeningInterval[], now: Date): boolean {
  const { weekday, minute } = tashkentClock(now);
  const yesterday = (weekday + 6) % 7;
  return hours.some((h) => {
    const opens = minutesOf(h.opens);
    const closes = minutesOf(h.closes);
    if (closes > opens) return h.weekday === weekday && minute >= opens && minute < closes;
    // overnight: the evening part today, the early-morning part belongs to yesterday's row
    return (
      (h.weekday === weekday && minute >= opens) || (h.weekday === yesterday && minute < closes)
    );
  });
}
