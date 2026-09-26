import * as Location from 'expo-location';
import { endpoints } from '../api/endpoints';
import type { GeoCity } from '../api/types';

/**
 * Guliston (Sirdaryo region), the launch city: where the map starts when neither the
 * device nor the API's /geo/config says anything better.
 */
export const DEFAULT_CENTER = { lat: 40.49598, lng: 68.77587 };

export type LocateResult =
  { ok: true; lat: number; lng: number } | { ok: false; reason: 'denied' | 'unavailable' };

/** Asks for permission if needed and returns the device's position. */
export async function locateDevice(): Promise<LocateResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { ok: false, reason: 'denied' };
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 }).catch(() => null);
    const position =
      last ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]));
    if (!position) return { ok: false, reason: 'unavailable' };
    return { ok: true, lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** What is at a map pin: an address line and whether rides start there. */
export interface PointInfo {
  address: string | null;
  /** null when the API could not be asked (offline). */
  serviceable: boolean | null;
  city: GeoCity | null;
}

/**
 * The API's geocoder first (it also knows the service areas); the phone's own geocoder
 * fills in the address when the API has none (GEOCODER=none, rate limit, offline).
 */
export async function describePoint(lat: number, lng: number): Promise<PointInfo> {
  let info: PointInfo = { address: null, serviceable: null, city: null };
  try {
    const res = await endpoints.geoReverse({ lat, lng });
    const a = res.address;
    info = {
      address: a ? [a.title, a.subtitle].filter(Boolean).join(', ') : null,
      serviceable: res.serviceable,
      city: res.city,
    };
  } catch {
    // fall through to the device geocoder
  }
  if (!info.address) info.address = await deviceAddress(lat, lng);
  return info;
}

async function deviceAddress(lat: number, lng: number): Promise<string | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!place) return null;
    const street = [place.street, place.streetNumber].filter(Boolean).join(' ');
    const parts = [street || place.name, place.district, place.city ?? place.subregion].filter(
      (p): p is string => Boolean(p && p.trim()),
    );
    const unique = parts.filter((p, i) => parts.indexOf(p) === i);
    return unique.length ? unique.join(', ') : null;
  } catch {
    return null;
  }
}

/** Fallback label when no address text is known. */
export function coordinatesLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
