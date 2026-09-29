/**
 * How often the driver's position is measured and sent, by what the driver is doing
 * (docs/market-research-v2.md §6.7). Dispatch ranks free drivers by the last fix, so an
 * idle driver needs a fresh position but not a stream of them; a driver on the way to a
 * rider or with a rider in the car is watched live by the rider. No React Native imports:
 * unit-tested under Node.
 */

/** What the tracker is working for. `off`: offline and no ride — no GPS at all. */
export type TrackingPhase = 'off' | 'idle' | 'to_pickup' | 'waiting' | 'on_trip';

export interface SendRules {
  /** Never send more often than this, however fast the car moves. */
  minGapMs: number;
  /** Moving this far since the last sent fix justifies a send (after `minGapMs`). */
  moveM: number;
  /** Send at least this often while the car moves at least `stillM`. */
  intervalMs: number;
  /** Below this movement the car is standing: only the keep-alive is sent. */
  stillM: number;
  /**
   * A standing car still reports this often, so dispatch (which ignores positions older
   * than `location_max_age_seconds`, 120 s by default) keeps the driver on the map.
   */
  keepAliveMs: number;
}

export interface LocationPolicy {
  phase: Exclude<TrackingPhase, 'off'>;
  /** What the phone's location provider is asked for. */
  request: { accuracy: 'high' | 'balanced'; timeIntervalMs: number; distanceIntervalM: number };
  send: SendRules;
  /** Low-battery mode is on (intervals doubled). */
  saving: boolean;
}

/** The API's freshness window for dispatch is 120 s; keep-alives stay well inside it. */
export const MAX_KEEP_ALIVE_MS = 60_000;

/** Below this charge (0–1) and not charging, the intervals are doubled. */
export const LOW_BATTERY_LEVEL = 0.15;

const BASE: Record<LocationPolicy['phase'], Omit<LocationPolicy, 'phase' | 'saving'>> = {
  // online, waiting for an offer: ~every 15 s while driving, 50 m moves go out at once
  // (after 10 s), a parked car only keeps its place fresh every 30 s
  idle: {
    request: { accuracy: 'high', timeIntervalMs: 10_000, distanceIntervalM: 0 },
    send: { minGapMs: 10_000, moveM: 50, intervalMs: 15_000, stillM: 15, keepAliveMs: 30_000 },
  },
  // accepted, driving to the rider: the rider watches the car come, every ~4 s
  to_pickup: {
    request: { accuracy: 'high', timeIntervalMs: 3_000, distanceIntervalM: 0 },
    send: { minGapMs: 3_000, moveM: 30, intervalMs: 4_000, stillM: 0, keepAliveMs: 4_000 },
  },
  // standing at the pickup: the car barely moves
  waiting: {
    request: { accuracy: 'high', timeIntervalMs: 5_000, distanceIntervalM: 0 },
    send: { minGapMs: 5_000, moveM: 20, intervalMs: 10_000, stillM: 10, keepAliveMs: 20_000 },
  },
  // the rider is in the car: every ~3 s (the rider's and the office's live map)
  on_trip: {
    request: { accuracy: 'high', timeIntervalMs: 2_500, distanceIntervalM: 0 },
    send: { minGapMs: 2_500, moveM: 25, intervalMs: 3_000, stillM: 0, keepAliveMs: 3_000 },
  },
};

/** The phase for the driver's state: the ride's status wins over the shift. */
export function trackingPhase(
  online: boolean,
  rideStatus: string | null | undefined,
): TrackingPhase {
  switch (rideStatus) {
    case 'driver_assigned':
      return 'to_pickup';
    case 'driver_arrived':
      return 'waiting';
    case 'in_progress':
      return 'on_trip';
    default:
      return online ? 'idle' : 'off';
  }
}

export interface BatteryState {
  /** 0–1, or null when unknown (emulator, web). */
  level: number | null;
  charging: boolean;
}

export function isLowBattery(battery: BatteryState | null | undefined): boolean {
  return (
    !!battery &&
    !battery.charging &&
    typeof battery.level === 'number' &&
    battery.level >= 0 &&
    battery.level < LOW_BATTERY_LEVEL
  );
}

/**
 * The policy for a phase, or null for `off` (the tracker stops completely). Below 15 %
 * battery (not charging) every interval is doubled; the keep-alive never goes over
 * {@link MAX_KEEP_ALIVE_MS} so the driver does not drop out of dispatch. Accuracy stays
 * high: a "balanced" fix is often cell-tower rough (hundreds of metres), which the API
 * refuses and which would put the driver on the wrong street.
 */
export function locationPolicy(
  phase: TrackingPhase,
  battery?: BatteryState | null,
): LocationPolicy | null {
  if (phase === 'off') return null;
  const base = BASE[phase];
  const saving = isLowBattery(battery);
  if (!saving) {
    return { phase, saving, request: { ...base.request }, send: { ...base.send } };
  }
  const s = base.send;
  return {
    phase,
    saving,
    request: { ...base.request, timeIntervalMs: base.request.timeIntervalMs * 2 },
    send: {
      ...s,
      minGapMs: s.minGapMs * 2,
      intervalMs: s.intervalMs * 2,
      keepAliveMs: Math.min(MAX_KEEP_ALIVE_MS, s.keepAliveMs * 2),
    },
  };
}

/** Whether moving from `a` to `b` needs the location provider restarted (new rate). */
export function requestChanged(a: LocationPolicy | null, b: LocationPolicy | null): boolean {
  if (!a || !b) return a !== b;
  return (
    a.request.accuracy !== b.request.accuracy ||
    a.request.timeIntervalMs !== b.request.timeIntervalMs ||
    a.request.distanceIntervalM !== b.request.distanceIntervalM ||
    (a.phase === 'idle') !== (b.phase === 'idle')
  );
}
