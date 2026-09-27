import AsyncStorage from '@react-native-async-storage/async-storage';
import { describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys, queryClient, useRecentPlaces, useSavedPlaces } from '../api/queries';
import type { RecentPlace, SavedPlace } from '../api/types';
import { notify } from '../lib/dialogs';
import {
  groupSaved,
  parseLegacyPlaces,
  type Place,
  placeInput,
  placesToMigrate,
  recentPlaces,
  type SavedPlaces,
  withoutRecent,
} from '../lib/places';

/**
 * Saved places and recent destinations, from the API (synced across the rider's phones).
 * Older versions kept home, work and recent destinations on the phone: home and work are
 * moved to the account once (migrateLegacyPlaces), then the phone's copy is deleted.
 */
const LEGACY_KEY = 'sff-taxi.places';
/** Older versions remembered rated rides on the phone; the API says `rated` now. */
const LEGACY_RATED_KEY = 'sff-taxi.rated';

export function usePlaces(): SavedPlaces & { list: SavedPlace[]; recent: Place[] } {
  const saved = useSavedPlaces();
  const recent = useRecentPlaces();
  const list = saved.data ?? [];
  return { ...groupSaved(list), list, recent: recentPlaces(recent.data, list) };
}

/** Saves a place; home and work replace the previous one (the API does that). */
export async function savePlace(
  kind: 'home' | 'work' | 'other',
  place: Place,
): Promise<SavedPlace> {
  const saved = await endpoints.createPlace(placeInput(kind, place));
  queryClient.setQueryData<SavedPlace[]>(keys.places, (list) =>
    list
      ? [...list.filter((p) => p.id !== saved.id && (kind === 'other' || p.kind !== kind)), saved]
      : [saved],
  );
  void queryClient.invalidateQueries({ queryKey: keys.places });
  return saved;
}

/** Saves a pick from the search or the map; says why when the API refuses (20 at most). */
export async function savePicked(kind: 'home' | 'work' | 'other', place: Place): Promise<boolean> {
  try {
    await savePlace(kind, place);
    return true;
  } catch (e) {
    notify('Manzil saqlanmadi', describeError(e));
    return false;
  }
}

export async function removePlace(id: string): Promise<void> {
  await endpoints.deletePlace(id);
  queryClient.setQueryData<SavedPlace[]>(keys.places, (list) => list?.filter((p) => p.id !== id));
  void queryClient.invalidateQueries({ queryKey: keys.places });
}

/** A new ride changes the recent destinations. */
export function refreshRecentPlaces(): void {
  void queryClient.invalidateQueries({ queryKey: keys.recentPlaces });
}

/**
 * Takes a destination off the recent list (the ride history keeps it; a new ride there
 * brings it back). Off the list at once; back if the API refuses.
 */
export async function hideRecentPlace(key: string): Promise<boolean> {
  const before = queryClient.getQueryData<RecentPlace[]>(keys.recentPlaces);
  queryClient.setQueryData<RecentPlace[]>(keys.recentPlaces, (list) => withoutRecent(list, key));
  try {
    await endpoints.hideRecentPlace(key);
    return true;
  } catch (e) {
    queryClient.setQueryData(keys.recentPlaces, before);
    notify('Manzil yashirilmadi', describeError(e));
    return false;
  } finally {
    void queryClient.invalidateQueries({ queryKey: keys.recentPlaces });
  }
}

/** Brings every hidden recent destination back. */
export async function unhideRecentPlaces(): Promise<boolean> {
  try {
    await endpoints.unhideRecentPlaces();
    return true;
  } catch (e) {
    notify('Bajarilmadi', describeError(e));
    return false;
  } finally {
    void queryClient.invalidateQueries({ queryKey: keys.recentPlaces });
  }
}

let migrating: Promise<void> | null = null;

/**
 * Moves the phone's home and work (older versions) to the signed-in account, once: where
 * the account already has one (saved from another phone), that one wins. The phone's copy
 * is deleted only after the API took them, so an offline start tries again next time.
 */
export function migrateLegacyPlaces(): Promise<void> {
  migrating ??= (async () => {
    const raw = await AsyncStorage.getItem(LEGACY_KEY).catch(() => null);
    void AsyncStorage.removeItem(LEGACY_RATED_KEY).catch(() => undefined);
    if (raw === null) return;
    const server = await queryClient.fetchQuery({
      queryKey: keys.places,
      queryFn: endpoints.places,
    });
    for (const input of placesToMigrate(parseLegacyPlaces(raw), server)) {
      await endpoints.createPlace(input);
    }
    await AsyncStorage.removeItem(LEGACY_KEY);
    await queryClient.invalidateQueries({ queryKey: keys.places });
  })()
    .catch(() => undefined)
    .finally(() => {
      migrating = null;
    });
  return migrating;
}

/** Sign-out: nothing of this account may stay on the phone (the API keeps the places). */
export function clearLegacyPlaces(): void {
  void AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined);
}
