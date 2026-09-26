/**
 * When the app refetches. The event stream (SSE) nudges on every change; polling is the
 * safety net, slow while the stream is up and fast without it. Offers are the one thing
 * that must never be missed, so they poll every few seconds while online without a stream.
 */

export const POLL = {
  /** With the stream open, everything is refreshed this often anyway. */
  withStream: 60_000,
  offersWithoutStream: 4_000,
  rideWithoutStream: 10_000,
  profileWithoutStream: 30_000,
} as const;

export function pollInterval(streamOpen: boolean, withoutStreamMs: number): number {
  return streamOpen ? POLL.withStream : withoutStreamMs;
}

/** Offers are only fetched while online and free (the API sends none otherwise). */
export function offersPollMs(online: boolean, busy: boolean, streamOpen: boolean): number | false {
  if (!online || busy) return false;
  return streamOpen ? 20_000 : POLL.offersWithoutStream;
}

export interface PendingOffer {
  id: string;
  expiresAt: string;
}

/**
 * The offer to show full-screen: the one expiring last among those not yet answered or
 * dismissed on this phone (a broadcast can overlap a direct offer; the freshest wins),
 * or null.
 */
export function offerToShow<T extends PendingOffer>(
  offers: readonly T[] | undefined,
  handled: ReadonlySet<string>,
  serverNow: number,
): T | null {
  let best: T | null = null;
  for (const o of offers ?? []) {
    if (handled.has(o.id)) continue;
    const at = Date.parse(o.expiresAt);
    if (Number.isNaN(at) || at <= serverNow) continue;
    if (!best || at > Date.parse(best.expiresAt)) best = o;
  }
  return best;
}

/** Push/notification tap targets (`data` set by the API's notifications handler). */
export type PushTarget =
  { kind: 'offer'; offerId: string } | { kind: 'ride'; rideId: string } | { kind: 'home' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `{kind:'offer', offerId}` opens the offer; ride pushes (`rider_cancelled`, …) with a
 * `rideId` open the ride; account pushes (`driver_active`, `driver_blocked`, …) open home.
 */
export function pushTarget(data: unknown): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { kind?: unknown; offerId?: unknown; rideId?: unknown };
  if (typeof d.kind !== 'string') return null;
  if (d.kind === 'offer') {
    return typeof d.offerId === 'string' && UUID.test(d.offerId)
      ? { kind: 'offer', offerId: d.offerId.toLowerCase() }
      : null;
  }
  if (typeof d.rideId === 'string' && UUID.test(d.rideId)) {
    return { kind: 'ride', rideId: d.rideId.toLowerCase() };
  }
  if (d.kind.startsWith('driver_')) return { kind: 'home' };
  return null;
}
