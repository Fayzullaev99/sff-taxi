/**
 * Saved places (home, work, others) and recent destinations (pure, unit-tested). Both live
 * in the API now (GET /places, /places/recent); older app versions kept home and work on
 * the phone, which are moved to the account once (see places/migrate.ts).
 */
import type { LatLng, PlaceInput, RecentPlace, SavedPlace } from '../api/types';
import { distanceM } from './ride-state';

/** A place as the search and the map use it: a point and the line that names it. */
export interface Place extends LatLng {
  title: string;
  subtitle: string | null;
}

export type SavedKind = 'home' | 'work';

export const SAVED_LABELS: Record<SavedKind, string> = { home: 'Uy', work: 'Ish' };

/** What the search / map screens save a pick as (`?save=`). */
export type SaveTarget = SavedKind | 'other';

export function parseSaveTarget(value: string | undefined): SaveTarget | null {
  return value === 'home' || value === 'work' || value === 'other' ? value : null;
}

export function saveTitle(target: SaveTarget): string {
  return target === 'other' ? 'Yangi manzil' : `${SAVED_LABELS[target]} manzili`;
}

/** Closer than this, two places are the same (a pin dropped twice on one gate). */
const SAME_PLACE_M = 60;

export function samePlace(a: LatLng, b: LatLng): boolean {
  return distanceM(a, b) < SAME_PLACE_M;
}

const coords = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

/** A saved place as a pick: its label ("Onam") over its address. */
export function savedToPlace(p: SavedPlace): Place {
  const label =
    p.kind === 'home' || p.kind === 'work' ? SAVED_LABELS[p.kind] : p.label?.trim() || null;
  const address = p.address?.trim() || p.landmark?.trim() || null;
  if (label && address && label !== address) {
    return { lat: p.lat, lng: p.lng, title: address, subtitle: label };
  }
  return { lat: p.lat, lng: p.lng, title: address ?? label ?? coords(p), subtitle: null };
}

/** The address line of a saved place for the draft (what the driver reads). */
export function savedAddress(p: SavedPlace): string | null {
  return p.address?.trim() || p.landmark?.trim() || p.label?.trim() || null;
}

export interface SavedPlaces {
  home: SavedPlace | null;
  work: SavedPlace | null;
  others: SavedPlace[];
}

export function groupSaved(list: readonly SavedPlace[] | undefined): SavedPlaces {
  const all = list ?? [];
  return {
    home: all.find((p) => p.kind === 'home') ?? null,
    work: all.find((p) => p.kind === 'work') ?? null,
    others: all.filter((p) => p.kind === 'other'),
  };
}

/**
 * Recent destinations to offer: the API's list (newest first, already one per spot),
 * without the ones that are a saved place anyway.
 */
export function recentPlaces(
  recent: readonly RecentPlace[] | undefined,
  saved: readonly SavedPlace[] | undefined,
  max = 8,
): Place[] {
  return (recent ?? [])
    .filter((r) => !(saved ?? []).some((s) => samePlace(s, r)))
    .slice(0, max)
    .map((r) => ({
      lat: r.lat,
      lng: r.lng,
      title: r.address?.trim() || r.landmark?.trim() || coords(r),
      subtitle: r.address && r.landmark ? r.landmark : null,
    }));
}

/** What the API needs to save a picked place. */
export function placeInput(kind: 'home' | 'work' | 'other', place: Place): PlaceInput {
  return {
    kind,
    label: null,
    address: place.title.slice(0, 300),
    lat: place.lat,
    lng: place.lng,
  };
}

// Places kept on the phone by older versions -------------------------------------------

export interface LegacyPlaces {
  home: Place | null;
  work: Place | null;
}

/** Reads what older versions stored defensively: anything malformed is dropped. */
export function parseLegacyPlaces(raw: string | null): LegacyPlaces {
  const empty = { home: null, work: null };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const place = (v: unknown): Place | null => {
    const p = (v ?? {}) as Record<string, unknown>;
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || typeof p.title !== 'string') {
      return null;
    }
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return null;
    return {
      lat: p.lat,
      lng: p.lng,
      title: p.title.slice(0, 300),
      subtitle: typeof p.subtitle === 'string' ? p.subtitle.slice(0, 300) : null,
    };
  };
  return { home: place(d.home), work: place(d.work) };
}

/**
 * The phone's home and work to save in the account: only where the account has none yet
 * (a place saved from another phone wins). Recent destinations are not moved: the API
 * builds them from the ride history.
 */
export function placesToMigrate(legacy: LegacyPlaces, server: readonly SavedPlace[]): PlaceInput[] {
  const out: PlaceInput[] = [];
  for (const kind of ['home', 'work'] as const) {
    const local = legacy[kind];
    if (local && !server.some((p) => p.kind === kind)) out.push(placeInput(kind, local));
  }
  return out;
}
