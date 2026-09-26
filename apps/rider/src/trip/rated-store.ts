import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Rides this phone already rated. The rider view does not say whether the rider rated
 * a ride (API gap), so the app remembers it to not ask twice.
 */
const KEY = 'sff-taxi.rated';
const MAX = 100;

let rated: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function load() {
  if (loaded) return;
  loaded = true;
  void AsyncStorage.getItem(KEY)
    .then((raw) => {
      const list: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        rated = [...new Set([...rated, ...list.filter((x): x is string => typeof x === 'string')])];
        emit();
      }
    })
    .catch(() => undefined);
}

export function markRated(rideId: string): void {
  if (rated.includes(rideId)) return;
  rated = [rideId, ...rated].slice(0, MAX);
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify(rated)).catch(() => undefined);
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIsRated(rideId: string): boolean {
  const get = () => rated.includes(rideId);
  return useSyncExternalStore(subscribe, get, get);
}
