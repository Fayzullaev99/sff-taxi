import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import {
  addRecent,
  EMPTY_PLACES,
  parsePlaces,
  type Place,
  type PlacesState,
  type SavedKind,
} from '../lib/places';

/**
 * Home, work and recent destinations, kept on this phone (the API has no rider
 * addresses yet). Cleared on sign-out: another person may sign in on the same phone.
 */
const KEY = 'sff-taxi.places';

let state: PlacesState = EMPTY_PLACES;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: PlacesState) {
  state = next;
  for (const l of listeners) l();
  void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
}

export function loadPlaces(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      state = parsePlaces(raw);
      for (const l of listeners) l();
    })
    .catch(() => undefined);
  return loaded;
}

export function savePlace(kind: SavedKind, place: Place): void {
  set({ ...state, [kind]: place });
}

export function removePlace(kind: SavedKind): void {
  set({ ...state, [kind]: null });
}

export function rememberDestination(place: Place): void {
  set({ ...state, recent: addRecent(state.recent, place) });
}

export function clearPlaces(): void {
  set(EMPTY_PLACES);
}

const get = () => state;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlaces(): PlacesState {
  return useSyncExternalStore(subscribe, get, get);
}
