import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { driver } from '../api/driver';
import { BRAND } from '../config';
import { isApiError } from '../lib/api-client';
import { fixRejection, type GpsState, INITIAL_GPS_STATE } from '../lib/gps-quality';
import {
  type BatteryState,
  type LocationPolicy,
  locationPolicy,
  requestChanged,
  type TrackingPhase,
} from '../lib/location-policy';
import {
  type Fix,
  LOCATION_RULES,
  type LocationPayload,
  LocationReporter,
  toLocationPayload,
} from '../lib/location-throttle';

/**
 * Sends the driver's position to the API while online or on a ride (from the SFF Eats
 * courier app, made adaptive).
 *
 * - The pace follows the driver's state (lib/location-policy): idle online ~15 s (a 50 m
 *   move at once, a parked car every 30 s), to the pickup ~4 s, on a trip ~3 s; doubled
 *   below 15 % battery. Offline and without a ride the GPS is off completely.
 * - With "Allow all the time" permission (and outside Expo Go) positions come from a
 *   background location task, which on Android runs as a foreground service with a
 *   notification, so reporting continues with the screen off or the navigator in front.
 *   Otherwise a foreground watcher reports while the app is open.
 * - Both feed one reporter (lib/location-throttle): rough, duplicate and stale fixes are
 *   dropped, one request at a time, and while the network is down the newest fix waits
 *   and is retried with backoff (at once when the connection returns).
 * - Fixes the API refuses (422: inaccurate, outside the service area, impossible jump) only
 *   change the GPS indicator: the driver is not interrupted. No re-render per fix (the
 *   indicator reads a tiny external store).
 */

export const LOCATION_TASK = 'sff-taxi-driver-location';
export type TrackingMode = 'off' | 'foreground' | 'background';

const PHASE_KEY = 'sff.taxi.driver.trackingPhase';
/** A location request (send) gives up after this: the next fix is only seconds away. */
const SEND_TIMEOUT_MS = 10_000;

let mode: TrackingMode = 'off';
let phase: TrackingPhase = 'off';
/** The policy the location provider was started with. */
let active: LocationPolicy | null = null;
let battery: BatteryState | null = null;
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
  await driver.location(payload, SEND_TIMEOUT_MS);
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
  if (isApiError(error, 0) || (isApiError(error) && error.status >= 500)) {
    updateGps({ lastNetworkErrorAt: Date.now() });
    return;
  }
  errorHandler?.(error);
}

const reporter = new LocationReporter(sendFix, LOCATION_RULES, {
  onError: handleSendError,
  isRetryable: (e) => isApiError(e) && (e.status === 0 || e.status === 429 || e.status >= 500),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
});

// the connection came back: the fix that waited goes out now, not after the backoff
NetInfo.addEventListener((state) => {
  if (state.isConnected && reporter.hasPending) void reporter.flush();
});

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

function onLocation(l: Location.LocationObject): Promise<unknown> {
  const fix = toFix(l);
  const accuracy = fix.accuracy ?? null;
  // the indicator shows whole metres: skip the store update when nothing it shows changed
  const last = gps.lastFix;
  if (
    !last ||
    Date.now() - last.at > 4_000 ||
    Math.round(last.accuracy ?? -1) !== Math.round(accuracy ?? -1)
  ) {
    updateGps({ lastFix: { accuracy, at: Date.now() } });
  }
  return reporter.report(fix);
}

/**
 * A JS runtime started by Android only for the background task knows nothing of the
 * driver's state: the phase is read back from storage once.
 */
let phaseRestored = false;
async function restorePhase(): Promise<void> {
  if (phaseRestored) return;
  phaseRestored = true;
  if (phase !== 'off') return;
  try {
    const saved = (await AsyncStorage.getItem(PHASE_KEY)) as TrackingPhase | null;
    const policy = saved ? locationPolicy(saved) : null;
    if (policy) reporter.setRules(policy.send);
  } catch {
    // idle rules stay
  }
}

// Must be defined when the bundle loads: Android may start the JS runtime just to run it.
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await restorePhase();
    // a batch can hold several fixes: only the newest is worth anything to the API
    await onLocation(data.locations[data.locations.length - 1]!);
  },
);

const NOTIFICATION_BODY: Record<LocationPolicy['phase'], string> = {
  idle: 'Liniyadasiz: buyurtma kutilmoqda',
  to_pickup: 'Yo‘lovchiga ketyapsiz: joylashuv yuborilmoqda',
  waiting: 'Yo‘lovchini kutyapsiz',
  on_trip: 'Safar davom etmoqda: joylashuv yuborilmoqda',
};

function watchOptions(policy: LocationPolicy): Location.LocationOptions {
  return {
    accuracy:
      policy.request.accuracy === 'high'
        ? Location.LocationAccuracy.High
        : Location.LocationAccuracy.Balanced,
    timeInterval: policy.request.timeIntervalMs,
    distanceInterval: policy.request.distanceIntervalM,
  };
}

function taskOptions(policy: LocationPolicy): Location.LocationTaskOptions {
  return {
    ...watchOptions(policy),
    activityType: Location.LocationActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'SFF Taxi Haydovchi',
      notificationBody: NOTIFICATION_BODY[policy.phase],
      notificationColor: BRAND,
      killServiceOnDestroy: true,
    },
  };
}

function setActive(policy: LocationPolicy | null): void {
  active = policy;
  const saving = policy?.saving ?? false;
  if (gps.saving !== saving) updateGps({ saving });
}

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

/** Low-battery mode is on (intervals doubled). */
export function isSavingBattery(): boolean {
  return active?.saving ?? false;
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/**
 * Sends the current position right away (used when going on shift): a fresh fix puts the
 * driver into dispatch at once. Resolves false when the phone has no fix within a few
 * seconds (indoors) or the API refused it: the tracker keeps trying with better ones.
 * Other API errors (403 blocked, no network) are thrown.
 */
export async function sendCurrentPosition(): Promise<boolean> {
  let position: Location.LocationObject | null;
  try {
    position =
      (await Location.getLastKnownPositionAsync({ maxAge: 15_000, requiredAccuracy: 50 })) ??
      (await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.LocationAccuracy.High }),
        8_000,
      ));
  } catch {
    position = null;
  }
  if (!position) return false;
  const fix = toFix(position);
  updateGps({ lastFix: { accuracy: fix.accuracy ?? null, at: Date.now() } });
  if (fix.accuracy != null && fix.accuracy > 100) return false;
  try {
    await sendFix(toLocationPayload(fix));
    reporter.markSent(fix);
    return true;
  } catch (error) {
    const rejection = fixRejection(error);
    if (!rejection) throw error;
    console.warn(`[location] first fix refused: ${rejection}`);
    updateGps({ lastRejection: { reason: rejection, at: Date.now() } });
    return false;
  }
}

let batterySubs: { remove(): void }[] = [];

function watchBattery(): void {
  if (batterySubs.length) return;
  const onChange = () => {
    void readBattery().then((changed) => {
      if (changed) void apply();
    });
  };
  try {
    batterySubs = [
      Battery.addBatteryLevelListener(onChange),
      Battery.addBatteryStateListener(onChange),
    ];
  } catch {
    batterySubs = [];
  }
}

function unwatchBattery(): void {
  batterySubs.forEach((s) => s.remove());
  batterySubs = [];
}

/** Reads the battery; true when low-battery mode flips. */
async function readBattery(): Promise<boolean> {
  try {
    const p = await Battery.getPowerStateAsync();
    const next: BatteryState = {
      level: p.batteryLevel,
      charging:
        p.batteryState === Battery.BatteryState.CHARGING ||
        p.batteryState === Battery.BatteryState.FULL,
    };
    const before = locationPolicy('idle', battery)!.saving;
    battery = next;
    return locationPolicy('idle', battery)!.saving !== before;
  } catch {
    return false;
  }
}

async function stopProvider(): Promise<void> {
  watcher?.remove();
  watcher = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // the task was never registered (e.g. Expo Go)
  }
}

async function stopNow(): Promise<void> {
  await stopProvider();
  unwatchBattery();
  reporter.reset();
  setActive(null);
  setMode('off');
}

async function startProvider(policy: LocationPolicy): Promise<void> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return;
  if (await hasBackgroundPermission()) {
    try {
      // starting a running task again replaces its options (pace, notification text)
      await Location.startLocationUpdatesAsync(LOCATION_TASK, taskOptions(policy));
      setActive(policy);
      setMode('background');
      return;
    } catch {
      // not available here (Expo Go, restricted device): use the foreground watcher
    }
  }
  watcher = await Location.watchPositionAsync(watchOptions(policy), (l) => {
    void onLocation(l);
  });
  setActive(policy);
  setMode('foreground');
}

/** Brings the provider in line with the current phase and battery. */
function apply(): Promise<TrackingMode> {
  return serial(async () => {
    const want = locationPolicy(phase, battery);
    if (!want) {
      // also stops a location service left running by an earlier JS runtime
      await stopNow();
      return mode;
    }
    reporter.setRules(want.send);
    if (mode !== 'off' && !requestChanged(active, want)) {
      setActive(want);
      return mode;
    }
    try {
      if (mode === 'off') {
        await readBattery();
        watchBattery();
        const fresh = locationPolicy(phase, battery)!;
        reporter.setRules(fresh.send);
        await startProvider(fresh);
      } else {
        if (mode === 'foreground') {
          watcher?.remove();
          watcher = null;
        }
        await startProvider(want);
      }
    } catch (error) {
      // permission revoked or location off: the next phase change or restart tries again
      console.warn('[location] could not start', error);
      watcher?.remove();
      watcher = null;
      setActive(null);
      setMode('off');
    }
    return mode;
  });
}

/**
 * Sets what the driver is doing; the tracker starts, re-paces or stops to match.
 * `off` (offline, no ride) stops the GPS completely.
 */
export function setTrackingPhase(next: TrackingPhase): Promise<TrackingMode> {
  if (next !== phase) {
    phase = next;
    AsyncStorage.setItem(PHASE_KEY, next).catch(() => undefined);
  }
  return apply();
}

export function stopTracking(): Promise<void> {
  return setTrackingPhase('off').then(() => undefined);
}

/** Re-evaluates the mode, e.g. after background permission was granted. */
export function restartTracking(): Promise<TrackingMode> {
  return serial(async () => {
    await stopProvider();
    setActive(null);
    setMode('off');
  }).then(apply);
}
