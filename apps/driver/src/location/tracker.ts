import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { driver } from '../api/driver';
import { BRAND } from '../config';
import { isApiError } from '../lib/api-client';
import { fixRejection, type GpsState, INITIAL_GPS_STATE } from '../lib/gps-quality';
import {
  type Fix,
  LOCATION_RULES,
  type LocationPayload,
  LocationReporter,
  toLocationPayload,
} from '../lib/location-throttle';

/**
 * Sends the driver's position to the API while online or on a ride (from the SFF Eats
 * courier app).
 *
 * - With "Allow all the time" permission (and outside Expo Go) positions come from a
 *   background location task, which on Android runs as a foreground service with a
 *   notification, so reporting continues with the screen off or the navigator in front.
 * - Otherwise a foreground watcher reports while the app is open.
 *
 * Both paths feed one throttled reporter (every 3-5 s, see lib/location-throttle) that
 * sends accuracy, heading and speed too; fixes over 100 m accuracy are not sent at all.
 * Fixes the API refuses (422: inaccurate, outside the service area, impossible jump) are
 * logged and shown on the GPS indicator only: the driver is not interrupted.
 * Low-end phones: one request in flight, nothing queued, no re-render per fix (the
 * indicator reads a tiny external store).
 */

export const LOCATION_TASK = 'sff-taxi-driver-location';
export type TrackingMode = 'off' | 'foreground' | 'background';

let mode: TrackingMode = 'off';
let watcher: Location.LocationSubscription | null = null;
let errorHandler: ((error: unknown) => void) | null = null;
const listeners = new Set<() => void>();

let gps: GpsState = INITIAL_GPS_STATE;
const gpsListeners = new Set<() => void>();

function updateGps(patch: Partial<GpsState>): void {
  gps = { ...gps, ...patch };
  gpsListeners.forEach((l) => l());
}

export function getGpsState(): GpsState {
  return gps;
}

export function subscribeGps(listener: () => void): () => void {
  gpsListeners.add(listener);
  return () => gpsListeners.delete(listener);
}

async function sendFix(payload: LocationPayload): Promise<void> {
  await driver.location(payload);
  updateGps({ lastSentAt: Date.now() });
}

/** Refusals and network failures are expected on the move: noted, never shown as errors. */
function handleSendError(error: unknown): void {
  const rejection = fixRejection(error);
  if (rejection) {
    console.warn(`[location] fix refused: ${rejection}`);
    updateGps({ lastRejection: { reason: rejection, at: Date.now() } });
    return;
  }
  if (isApiError(error, 0)) {
    updateGps({ lastNetworkErrorAt: Date.now() });
    return;
  }
  errorHandler?.(error);
}

const reporter = new LocationReporter(sendFix, LOCATION_RULES, handleSendError);

function toFix(l: Location.LocationObject): Fix {
  return {
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    at: l.timestamp,
    accuracy: l.coords.accuracy,
    heading: l.coords.heading,
    speed: l.coords.speed,
  };
}

function onLocation(l: Location.LocationObject): Promise<boolean> {
  const fix = toFix(l);
  updateGps({ lastFix: { accuracy: fix.accuracy ?? null, at: Date.now() } });
  return reporter.report(fix);
}

// Must be defined when the bundle loads: Android may start the JS runtime just to run it.
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await onLocation(data.locations[data.locations.length - 1]!);
  },
);

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.LocationAccuracy.High,
  timeInterval: 3_000,
  distanceInterval: 0,
};

const TASK_OPTIONS: Location.LocationTaskOptions = {
  ...WATCH_OPTIONS,
  activityType: Location.LocationActivityType.OtherNavigation,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'SFF Taxi Haydovchi',
    notificationBody: 'Liniyadasiz: joylashuvingiz yuborilmoqda',
    notificationColor: BRAND,
    killServiceOnDestroy: true,
  },
};

function setMode(next: TrackingMode): void {
  mode = next;
  updateGps({ tracking: next !== 'off' });
  listeners.forEach((l) => l());
}

export function getTrackingMode(): TrackingMode {
  return mode;
}

export function subscribeTracking(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where other failed sends go (e.g. 403 when the account was blocked mid-shift). */
export function setTrackingErrorHandler(handler: ((error: unknown) => void) | null): void {
  errorHandler = handler;
}

// start/stop calls are serialised so quick toggles cannot leave a watcher behind
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export type PermissionResult = 'granted' | 'denied' | 'services_off';

/** Asks for "while using the app" access; call before going on shift. */
export async function ensureLocationPermission(): Promise<PermissionResult> {
  if (!(await Location.hasServicesEnabledAsync())) return 'services_off';
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return 'granted';
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted ? 'granted' : 'denied';
}

export async function hasBackgroundPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks for "all the time" access; on Android 11+ this opens the system settings page. */
export async function requestBackgroundPermission(): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;
    return (await Location.requestBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Sends the current position right away (used when going on shift). A refused fix is
 * not an error here: the tracker keeps trying with better ones.
 */
export async function sendCurrentPosition(): Promise<void> {
  const position =
    (await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 100 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.LocationAccuracy.High }));
  const fix = toFix(position);
  updateGps({ lastFix: { accuracy: fix.accuracy ?? null, at: Date.now() } });
  try {
    await sendFix(toLocationPayload(fix));
  } catch (error) {
    const rejection = fixRejection(error);
    if (!rejection) throw error;
    console.warn(`[location] first fix refused: ${rejection}`);
    updateGps({ lastRejection: { reason: rejection, at: Date.now() } });
  }
  reporter.reset();
}

async function stopNow(): Promise<void> {
  watcher?.remove();
  watcher = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // the task was never registered (e.g. Expo Go)
  }
  reporter.reset();
  setMode('off');
}

export function startTracking(): Promise<TrackingMode> {
  return serial(async () => {
    if (mode !== 'off') return mode;
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return mode;
    if (await hasBackgroundPermission()) {
      try {
        if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, TASK_OPTIONS);
        }
        setMode('background');
        return mode;
      } catch {
        // not available here (Expo Go, restricted device): use the foreground watcher
      }
    }
    watcher = await Location.watchPositionAsync(WATCH_OPTIONS, (l) => {
      void onLocation(l);
    });
    setMode('foreground');
    return mode;
  });
}

export function stopTracking(): Promise<void> {
  return serial(stopNow);
}

/** Re-evaluates the mode, e.g. after background permission was granted. */
export function restartTracking(): Promise<TrackingMode> {
  return serial(stopNow).then(() => startTracking());
}
