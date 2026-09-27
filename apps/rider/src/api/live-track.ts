import { useCallback, useSyncExternalStore } from 'react';
import type { EtaReading } from '../lib/ride-state';
import { appendTrack, type TrackPoint } from './realtime-logic';

/**
 * The assigned car's recent positions per ride, its road ETA to the pickup and, on the trip, to the destination, fed by
 * `driver.location` stream events. Ephemeral by design (the API sends positions straight
 * from the driver's GPS, no outbox): kept in memory only.
 */
const tracks = new Map<string, TrackPoint[]>();
const etas = new Map<string, EtaReading>();
/** During the trip: the road ETA to the destination. */
const destinationEtas = new Map<string, EtaReading>();
const listeners = new Set<() => void>();
const EMPTY: TrackPoint[] = [];

function emit() {
  for (const l of listeners) l();
}

/** Keeps the newer reading; true when it changed. */
function setEta(map: Map<string, EtaReading>, rideId: string, etaS: number | null, at: string) {
  if (etaS === null) return false;
  const last = map.get(rideId);
  if (last && new Date(at).getTime() < new Date(last.at).getTime()) return false;
  map.set(rideId, { etaS, at });
  return true;
}

export function pushFix(
  rideId: string,
  fix: TrackPoint,
  etaS: number | null = null,
  destinationEtaS: number | null = null,
): void {
  let changed = setEta(etas, rideId, etaS, fix.at);
  if (setEta(destinationEtas, rideId, destinationEtaS, fix.at)) changed = true;
  const current = tracks.get(rideId) ?? EMPTY;
  const next = appendTrack(current, fix);
  if (next !== current) {
    tracks.set(rideId, next);
    changed = true;
  }
  if (changed) emit();
}

export function clearTrack(rideId: string): void {
  const a = tracks.delete(rideId);
  const b = etas.delete(rideId);
  const c = destinationEtas.delete(rideId);
  if (a || b || c) emit();
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

/** The newest road ETA to the pickup the stream brought, or null. */
export function useLiveEta(rideId: string | undefined): EtaReading | null {
  const get = useCallback(() => (rideId ? (etas.get(rideId) ?? null) : null), [rideId]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The newest road ETA to the destination (on the trip) the stream brought, or null. */
export function useLiveDestinationEta(rideId: string | undefined): EtaReading | null {
  const get = useCallback(() => (rideId ? (destinationEtas.get(rideId) ?? null) : null), [rideId]);
  return useSyncExternalStore(subscribe, get, get);
}
