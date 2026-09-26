import { useCallback, useSyncExternalStore } from 'react';
import { appendTrack, type TrackPoint } from './realtime-logic';

/**
 * The assigned car's recent positions per ride, fed by `driver.location` stream events.
 * Ephemeral by design (the API sends positions straight from the driver's GPS, no outbox):
 * kept in memory only.
 */
const tracks = new Map<string, TrackPoint[]>();
const listeners = new Set<() => void>();
const EMPTY: TrackPoint[] = [];

export function pushFix(rideId: string, fix: TrackPoint): void {
  const current = tracks.get(rideId) ?? EMPTY;
  const next = appendTrack(current, fix);
  if (next === current) return;
  tracks.set(rideId, next);
  for (const l of listeners) l();
}

export function clearTrack(rideId: string): void {
  if (tracks.delete(rideId)) for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCarTrack(rideId: string | undefined): TrackPoint[] {
  const get = useCallback(() => (rideId ? (tracks.get(rideId) ?? EMPTY) : EMPTY), [rideId]);
  return useSyncExternalStore(subscribe, get, get);
}
