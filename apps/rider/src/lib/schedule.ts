/**
 * Rides for later (pure, unit-tested). The API takes `scheduledFor` 30 minutes to 24 hours
 * ahead, prices the ride for that time (the night add-on), takes cash only, keeps up to
 * three per rider and starts the search 15 minutes before. Riders cancel them free.
 */

export const SCHEDULE_MIN_AHEAD_MIN = 30;
export const SCHEDULE_MAX_AHEAD_H = 24;
export const SCHEDULE_DISPATCH_BEFORE_MIN = 15;
export const SCHEDULED_PER_RIDER = 3;
/** Slots every quarter hour. */
export const SLOT_MIN = 15;
/**
 * The first slot keeps a margin over the API's 30 minutes: the rider still has to read the
 * price and tap "order" (the quote itself is checked when it is made, 10 minutes valid).
 */
const MARGIN_MIN = 5;

const MIN = 60_000;

/** Pickup times a rider can choose now, every SLOT_MIN minutes, soonest first. */
export function scheduleSlots(now: Date): Date[] {
  const step = SLOT_MIN * MIN;
  const first = Math.ceil((now.getTime() + (SCHEDULE_MIN_AHEAD_MIN + MARGIN_MIN) * MIN) / step);
  const last = now.getTime() + SCHEDULE_MAX_AHEAD_H * 60 * MIN;
  const out: Date[] = [];
  for (let t = first * step; t <= last; t += step) out.push(new Date(t));
  return out;
}

/** Whether a chosen time can still be quoted (the API: 30 minutes to 24 hours ahead). */
export function schedulable(at: string | Date, now: Date): boolean {
  const ahead = (new Date(at).getTime() - now.getTime()) / MIN;
  return ahead >= SCHEDULE_MIN_AHEAD_MIN && ahead <= SCHEDULE_MAX_AHEAD_H * 60;
}

/** When the search for a scheduled ride starts. */
export function searchStartsAt(scheduledFor: string | Date): Date {
  return new Date(new Date(scheduledFor).getTime() - SCHEDULE_DISPATCH_BEFORE_MIN * MIN);
}
