import AsyncStorage from '@react-native-async-storage/async-storage';
import { decodeSavedRide, encodeSavedRide } from '../lib/saved-ride';
import { keys, queryClient } from './queries';
import type { Ride } from './types';

/**
 * Keeps the open ride on the phone (app-private storage) so a cold start without network
 * shows it at once: restored into the query cache as old data, so it is refetched as soon
 * as the API answers. Written when the ride changes, removed when it ends or on sign-out.
 */
const KEY = 'sff-taxi.open-ride';

let lastWritten: string | null = null;
let savedId: string | null = null;
/** Set while the kept ride is put back: that is not a new answer worth writing again. */
let restoring = false;

/** Before the first screen: the kept ride goes into the cache (only where nothing newer is). */
export async function restoreOpenRide(): Promise<void> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  const saved = decodeSavedRide<Ride>(raw, Date.now());
  if (!saved) {
    if (raw) void AsyncStorage.removeItem(KEY).catch(() => undefined);
    return;
  }
  lastWritten = raw;
  savedId = saved.ride.id;
  const options = { updatedAt: saved.savedAt };
  restoring = true;
  try {
    if (queryClient.getQueryData(keys.currentRide) === undefined) {
      queryClient.setQueryData(keys.currentRide, saved.ride, options);
    }
    if (queryClient.getQueryData(keys.ride(saved.ride.id)) === undefined) {
      queryClient.setQueryData(keys.ride(saved.ride.id), saved.ride, options);
    }
  } finally {
    restoring = false;
  }
}

function write(value: string | null) {
  if (value === lastWritten) return;
  lastWritten = value;
  void (value === null ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, value)).catch(
    () => undefined,
  );
}

/** Follows fetched rides for as long as the app runs; returns the unsubscribe. */
export function keepOpenRide(): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (restoring || event.type !== 'updated' || event.action.type !== 'success') return;
    const key = event.query.queryKey;
    const isCurrent = key[0] === keys.currentRide[0];
    const isRide = key[0] === 'ride' && typeof key[1] === 'string';
    if (!isCurrent && !isRide) return;
    const ride = (event.query.state.data ?? null) as Ride | null;
    if (isCurrent && !ride) {
      // no open ride any more
      savedId = null;
      write(null);
      return;
    }
    if (!ride) return;
    const encoded = encodeSavedRide(ride, Date.now());
    if (encoded) {
      // the open ride (from either query); a ride opened from the history that is not
      // open does not replace it
      savedId = ride.id;
      write(encoded);
    } else if (ride.id === savedId) {
      savedId = null;
      write(null);
    }
  });
}

/** Sign-out: nothing of the account stays on the phone. */
export function forgetOpenRide(): void {
  savedId = null;
  write(null);
}
