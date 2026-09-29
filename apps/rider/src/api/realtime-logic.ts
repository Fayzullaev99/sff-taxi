/**
 * The rider's side of the server-sent event stream, without React Native (unit-tested):
 * reading an event, the reconnect back-off and the car's recent track.
 */
import type { RealtimeEvent } from './types';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** One `data:` payload of the stream as an event the app knows, else null (ignored). */
export function parseRealtimeEvent(raw: string): RealtimeEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'ready':
    case 'ping':
      return { type: d.type };
    case 'ride.changed':
      // a co-rider joined or left (the price changed): refetch like any ride update
      return isStr(d.rideId)
        ? { type: 'ride.updated', rideId: d.rideId, status: isStr(d.status) ? d.status : '' }
        : null;
    case 'ride.updated':
      return isStr(d.rideId) && isStr(d.status)
        ? { type: 'ride.updated', rideId: d.rideId, status: d.status }
        : null;
    case 'driver.location':
      if (!isStr(d.rideId) || !isNum(d.lat) || !isNum(d.lng)) return null;
      if (Math.abs(d.lat) > 90 || Math.abs(d.lng) > 180) return null;
      return {
        type: 'driver.location',
        rideId: d.rideId,
        lat: d.lat,
        lng: d.lng,
        heading: isNum(d.heading) ? d.heading : null,
        at: isStr(d.at) ? d.at : new Date().toISOString(),
        etaS: isNum(d.etaS) && d.etaS >= 0 ? d.etaS : null,
        destinationEtaS:
          isNum(d.destinationEtaS) && d.destinationEtaS >= 0 ? d.destinationEtaS : null,
      };
    case 'ride.refund':
      return isStr(d.rideId) && isStr(d.status)
        ? {
            type: 'ride.refund',
            rideId: d.rideId,
            status: d.status,
            amount: isNum(d.amount) ? d.amount : 0,
          }
        : null;
    case 'intercity.updated':
      return isStr(d.tripId) && isStr(d.status)
        ? {
            type: 'intercity.updated',
            tripId: d.tripId,
            bookingId: isStr(d.bookingId) ? d.bookingId : null,
            status: d.status,
          }
        : null;
    case 'complaint.updated':
      return isStr(d.complaintId) && isStr(d.status)
        ? {
            type: 'complaint.updated',
            complaintId: d.complaintId,
            rideId: isStr(d.rideId) ? d.rideId : '',
            status: d.status,
          }
        : null;
    default:
      return null;
  }
}

export const MAX_BACKOFF_MS = 30_000;

/** Exponential back-off with jitter: 1 s, 2 s, 4 s ... up to 30 s. */
export function backoffMs(attempt: number, random: number = Math.random()): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt)) + random * 500;
}

/**
 * The API writes a ping every 10 s and a car on its way sends a fix every few seconds: a
 * stream silent for 25 s (two missed pings and a slow 3G hop) is dead even if the socket
 * was never closed (a phone moving between cells often keeps a half-open connection). Same
 * idea as Uber's 4 s heartbeat / 7 s dead link, scaled to this API's heartbeat.
 */
export const STREAM_DEAD_MS = 25_000;
/** A stream that has not opened this long after asking is given up and asked again. */
export const STREAM_OPEN_TIMEOUT_MS = 15_000;

export type StreamHealth = 'connecting' | 'open' | 'dead';

/**
 * The stream's state for the watchdog: dead when it never opened in time, or when nothing
 * (not even a ping) came for STREAM_DEAD_MS.
 */
export function streamHealth(
  s: { startedAt: number; openedAt: number | null; lastMessageAt: number | null },
  now: number,
): StreamHealth {
  if (s.openedAt === null) {
    return now - s.startedAt > STREAM_OPEN_TIMEOUT_MS ? 'dead' : 'connecting';
  }
  const last = Math.max(s.openedAt, s.lastMessageAt ?? 0);
  return now - last > STREAM_DEAD_MS ? 'dead' : 'open';
}

export interface TrackPoint {
  lat: number;
  lng: number;
  heading: number | null;
  at: string;
}

/** How many recent fixes the map draws behind the car. */
export const TRAIL_LENGTH = 20;

/**
 * Adds a fix to the car's track. Fixes arriving out of order (older than the newest)
 * are dropped, as are exact repeats; the track keeps the newest TRAIL_LENGTH points.
 */
export function appendTrack(track: readonly TrackPoint[], fix: TrackPoint): TrackPoint[] {
  const last = track[track.length - 1];
  if (last) {
    if (new Date(fix.at).getTime() < new Date(last.at).getTime()) return track as TrackPoint[];
    if (last.lat === fix.lat && last.lng === fix.lng) {
      return [...track.slice(0, -1), { ...fix, heading: fix.heading ?? last.heading }];
    }
  }
  const next = [...track, fix];
  return next.length > TRAIL_LENGTH ? next.slice(next.length - TRAIL_LENGTH) : next;
}

/**
 * The car's track to draw: the API's trail since the assignment (fetched with the ride)
 * followed by the fixes streamed since, oldest first, without duplicates.
 */
export function mergeTrail(
  fetched: readonly TrackPoint[] | undefined,
  live: readonly TrackPoint[],
): TrackPoint[] {
  let track: TrackPoint[] = [];
  const all = [...(fetched ?? []), ...live].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  for (const fix of all) {
    track = appendTrack(track, {
      lat: fix.lat,
      lng: fix.lng,
      heading: fix.heading ?? null,
      at: fix.at,
    });
  }
  return track;
}

/**
 * The car's position to show: the newest live fix if it is newer than the one in the
 * fetched ride, else the fetched one.
 */
export function carPosition(
  track: readonly TrackPoint[],
  fetched: { lat: number; lng: number; heading: number | null; at: string | null } | null,
): TrackPoint | null {
  const live = track[track.length - 1] ?? null;
  if (!fetched) return live;
  if (!live) return { ...fetched, at: fetched.at ?? new Date(0).toISOString() };
  const fetchedAt = fetched.at ? new Date(fetched.at).getTime() : 0;
  return new Date(live.at).getTime() >= fetchedAt
    ? live
    : { ...fetched, at: fetched.at ?? new Date(0).toISOString() };
}
