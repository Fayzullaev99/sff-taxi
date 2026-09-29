import * as Location from 'expo-location';
import { AppState, Linking, Platform } from 'react-native';
import { endpoints } from '../api/endpoints';
import type { GeoCity, GeoReverse } from '../api/types';
import { chooseAddress } from '../lib/device-address';
import { coordKey, LruCache } from '../lib/lru';
import { type Fix, PRECISE, ROUGH } from './fix';
import { locate, type LocateOutcome, type LocationDriver } from './locate';

/**
 * Guliston (Sirdaryo region), the launch city: where the map starts when neither the
 * device nor the API's /geo/config says anything better.
 */
export const DEFAULT_CENTER = { lat: 40.49598, lng: 68.77587 };

const toFix = (p: Location.LocationObject): Fix => ({
  lat: p.coords.latitude,
  lng: p.coords.longitude,
  accuracyM: typeof p.coords.accuracy === 'number' ? p.coords.accuracy : null,
  at: typeof p.timestamp === 'number' && p.timestamp > 0 ? p.timestamp : Date.now(),
});

/** expo-location behind the framework-free lookup (locate.ts). */
const expoDriver: LocationDriver = {
  async permission(ask) {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted || !ask || !current.canAskAgain) {
      return { granted: current.granted, canAskAgain: current.canAskAgain };
    }
    const asked = await Location.requestForegroundPermissionsAsync();
    return { granted: asked.granted, canAskAgain: asked.canAskAgain };
  },
  servicesEnabled: () => Location.hasServicesEnabledAsync(),
  async lastKnown() {
    const p = await Location.getLastKnownPositionAsync();
    return p ? toFix(p) : null;
  },
  async watch(highAccuracy, onFix) {
    const sub = await Location.watchPositionAsync(
      {
        // GPS only while the rider sets a pickup; the balanced (network) provider otherwise
        accuracy: highAccuracy ? Location.Accuracy.High : Location.Accuracy.Balanced,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      (p) => onFix(toFix(p)),
    );
    return () => sub.remove();
  },
};

/**
 * - `precise`: a pickup ("my location", the map's start): GPS, a fix at most 30 s old and
 *   within 50 m, up to 12 s; then the best seen (the last known included).
 * - `rough`: where to start the map: the cached fix if under 2 minutes, else the network
 *   provider for up to 6 s.
 */
export type LocateMode = 'precise' | 'rough';

const MODES = {
  precise: { rules: PRECISE, highAccuracy: true, timeoutMs: 12_000 },
  rough: { rules: ROUGH, highAccuracy: false, timeoutMs: 6_000 },
} as const;

const inflight = new Map<LocateMode, Promise<LocateOutcome>>();
/** Lookups run one after another: never two position watches at once. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Finds the phone. Callers asking while a lookup of the same kind (or a precise one) runs
 * share it; a lookup stops as soon as the app goes to the background (with the best fix
 * it had), so no GPS runs behind the rider's back.
 */
export function findMe(mode: LocateMode, ask = true): Promise<LocateOutcome> {
  const joined = inflight.get('precise') ?? inflight.get(mode);
  if (joined) return joined;
  const run = queue
    .then(() => runLocate(mode, ask))
    .finally(() => {
      inflight.delete(mode);
    });
  queue = run.catch(() => undefined);
  inflight.set(mode, run);
  return run;
}

async function runLocate(mode: LocateMode, ask: boolean): Promise<LocateOutcome> {
  const controller = new AbortController();
  if (AppState.currentState === 'background') controller.abort();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background') controller.abort();
  });
  try {
    return await locate(expoDriver, { ...MODES[mode], ask, signal: controller.signal });
  } catch {
    return { ok: false, problem: 'unavailable' };
  } finally {
    sub.remove();
  }
}

/** Opens this app's page in the phone's settings (a permission denied for good). */
export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/**
 * Asks to switch location on: Android shows its own "turn on location" dialog; elsewhere
 * (or if that fails) the settings open. Resolves true when it is on afterwards.
 */
export async function enableLocationServices(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
      return await Location.hasServicesEnabledAsync();
    } catch {
      // the rider said no, or no Google Play services: the settings are the way
    }
  }
  openAppSettings();
  return false;
}

/** What is at a map pin: an address line and whether rides start there. */
export interface PointInfo {
  address: string | null;
  /** null when the API could not be asked (offline). */
  serviceable: boolean | null;
  city: GeoCity | null;
}

/**
 * Addresses by rounded coordinate (~10 m): moving the pin back, or the same point on the
 * map, the search and the order screen, asks the API once. Only complete answers (the API
 * replied) are kept, so an offline miss is asked again.
 */
const addresses = new LruCache<PointInfo>(200, 30 * 60_000);

/**
 * The API's geocoder first (it also knows the service areas); the phone's own geocoder
 * fills in the address when the API has none (GEOCODER=none, rate limit, offline).
 */
export function describePoint(lat: number, lng: number): Promise<PointInfo> {
  return addresses.getOrLoad(
    coordKey(lat, lng),
    () => lookUpPoint(lat, lng),
    (info) => info.serviceable !== null && info.address !== null,
  );
}

/** The address already known for a point, without asking (null when not cached). */
export function knownPoint(lat: number, lng: number): PointInfo | null {
  return addresses.get(coordKey(lat, lng)) ?? null;
}

async function lookUpPoint(lat: number, lng: number): Promise<PointInfo> {
  let info: PointInfo = { address: null, serviceable: null, city: null };
  let api: GeoReverse['address'] = null;
  try {
    const res = await endpoints.geoReverse({ lat, lng });
    api = res.address;
    info = { address: null, serviceable: res.serviceable, city: res.city };
  } catch {
    // offline or failing: the device geocoder may still name the place
  }
  // the API's Uzbek address; the phone's own (its language, plus codes) only without it
  info.address = await chooseAddress(api, async () => {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return place;
  });
  return info;
}

/** Fallback label when no address text is known. */
export function coordinatesLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
