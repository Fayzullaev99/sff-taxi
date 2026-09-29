/**
 * The open ride kept on the phone (pure, unit-tested): a cold start without network (the
 * app was killed on a trip, the phone restarted in a dead zone) still shows the ride, its
 * driver, car and plate instead of an empty map, until the API answers again.
 */
import { isOpenStatus } from './ride-state';

/** Older than this, a saved ride is not shown (a ride does not last half a day). */
export const SAVED_RIDE_MAX_AGE_MS = 12 * 60 * 60_000;

interface RideLike {
  id: string;
  status: Parameters<typeof isOpenStatus>[0];
  trail?: unknown[];
}

interface Saved<R> {
  v: 1;
  savedAt: number;
  ride: R;
}

/**
 * What to keep for a ride: its JSON while it is open (without the car's trail, which the
 * next fetch brings back), null when there is nothing to keep (no ride, or it ended).
 */
export function encodeSavedRide<R extends RideLike>(ride: R | null, now: number): string | null {
  if (!ride || !isOpenStatus(ride.status)) return null;
  const saved: Saved<R> = { v: 1, savedAt: now, ride: { ...ride, trail: [] } };
  return JSON.stringify(saved);
}

/** The kept ride if it is still worth showing, with when it was saved. */
export function decodeSavedRide<R extends RideLike>(
  raw: string | null,
  now: number,
): { ride: R; savedAt: number } | null {
  if (!raw) return null;
  let saved: Saved<R>;
  try {
    saved = JSON.parse(raw) as Saved<R>;
  } catch {
    return null;
  }
  if (!saved || saved.v !== 1 || typeof saved.savedAt !== 'number') return null;
  const ride = saved.ride;
  if (!ride || typeof ride.id !== 'string' || typeof ride.status !== 'string') return null;
  if (!isOpenStatus(ride.status)) return null;
  if (now - saved.savedAt > SAVED_RIDE_MAX_AGE_MS || saved.savedAt > now + 60_000) return null;
  return { ride, savedAt: saved.savedAt };
}
