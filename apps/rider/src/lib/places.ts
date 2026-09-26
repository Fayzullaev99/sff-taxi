/**
 * Saved places (home, work) and recent destinations (pure, unit-tested). The API keeps
 * no rider addresses yet, so these live on the phone (see trip/places-store.ts).
 */
import type { LatLng } from '../api/types';
import { distanceM } from './ride-state';

export interface Place extends LatLng {
  title: string;
  subtitle: string | null;
}

export type SavedKind = 'home' | 'work';

export interface PlacesState {
  home: Place | null;
  work: Place | null;
  recent: Place[];
}

export const EMPTY_PLACES: PlacesState = { home: null, work: null, recent: [] };

export const MAX_RECENT = 8;
/** Closer than this, two places are the same (a pin dropped twice on one gate). */
const SAME_PLACE_M = 60;

export function samePlace(a: Place, b: Place): boolean {
  return distanceM(a, b) < SAME_PLACE_M;
}

/** Puts a place first in the recent list, without duplicates, keeping MAX_RECENT. */
export function addRecent(recent: readonly Place[], place: Place): Place[] {
  return [place, ...recent.filter((p) => !samePlace(p, place))].slice(0, MAX_RECENT);
}

/** Reads a stored value defensively: anything malformed is dropped. */
export function parsePlaces(raw: string | null): PlacesState {
  if (!raw) return EMPTY_PLACES;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_PLACES;
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const place = (v: unknown): Place | null => {
    const p = (v ?? {}) as Record<string, unknown>;
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || typeof p.title !== 'string') {
      return null;
    }
    return {
      lat: p.lat,
      lng: p.lng,
      title: p.title.slice(0, 300),
      subtitle: typeof p.subtitle === 'string' ? p.subtitle.slice(0, 300) : null,
    };
  };
  const recent = Array.isArray(d.recent)
    ? d.recent.map(place).filter((p): p is Place => p !== null)
    : [];
  return { home: place(d.home), work: place(d.work), recent: recent.slice(0, MAX_RECENT) };
}

export const SAVED_LABELS: Record<SavedKind, string> = { home: 'Uy', work: 'Ish' };
