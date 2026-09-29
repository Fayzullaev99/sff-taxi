import { isApiError } from './api-client';

/** Why the API refused a fix (`422 {reason}` from `POST /v1/driver/location`). */
export type FixRejection = 'inaccurate' | 'outside' | 'too_fast';

const REJECTIONS: readonly FixRejection[] = ['inaccurate', 'outside', 'too_fast'];

/** The refusal reason of a location send, or null when the error is something else. */
export function fixRejection(error: unknown): FixRejection | null {
  if (!isApiError(error, 422)) return null;
  const reason = (error.body as { reason?: unknown } | null)?.reason;
  return REJECTIONS.includes(reason as FixRejection) ? (reason as FixRejection) : null;
}

/** What the tracker knows about the GPS and the last sends; times are ms since epoch. */
export interface GpsState {
  tracking: boolean;
  /** The last fix the phone produced (sent or not). */
  lastFix: { accuracy: number | null; at: number } | null;
  /** When the API last accepted a fix. */
  lastSentAt: number | null;
  /** The API's last refusal. */
  lastRejection: { reason: FixRejection; at: number } | null;
  /** The last send that never got an answer (no internet). */
  lastNetworkErrorAt: number | null;
  /** Low-battery mode: positions are sent half as often. */
  saving?: boolean;
}

export const INITIAL_GPS_STATE: GpsState = {
  tracking: false,
  lastFix: null,
  lastSentAt: null,
  lastRejection: null,
  lastNetworkErrorAt: null,
  saving: false,
};

export type GpsLevel = 'off' | 'none' | 'poor' | 'fair' | 'good';

export interface GpsQuality {
  level: GpsLevel;
  /** Short text for the indicator, e.g. "GPS yaxshi · ±8 m". */
  label: string;
  /** What to do about it; null when all is well. */
  hint: string | null;
}

/** A fix older than this means the GPS went quiet. */
export const GPS_STALE_MS = 60_000;
/** Accuracy (m) at or under which the fix is good enough for turn-by-turn tracking. */
export const GOOD_ACCURACY_M = 25;
/** The API refuses anything over this. */
export const FAIR_ACCURACY_M = 100;

function newerThan(at: number | null | undefined, other: number | null | undefined): boolean {
  return typeof at === 'number' && (other === null || other === undefined || at > other);
}

/**
 * The GPS quality indicator: how good the phone's fixes are and whether the API is
 * taking them. Refusals are shown here, quietly, instead of interrupting the driver.
 */
/** Two readings of the indicator show the same thing (no re-render needed). */
export function sameQuality(a: GpsQuality, b: GpsQuality): boolean {
  return a.level === b.level && a.label === b.label && a.hint === b.hint;
}

export function gpsQuality(state: GpsState, now: number): GpsQuality {
  if (!state.tracking) return { level: 'off', label: 'GPS yuborilmayapti', hint: null };
  const fix = state.lastFix;
  if (!fix || now - fix.at > GPS_STALE_MS) {
    return {
      level: 'none',
      label: 'GPS signali yo‘q',
      hint: 'Telefon joylashuvni aniqlay olmayapti. Ochiq joyga chiqing.',
    };
  }
  const accuracy = fix.accuracy === null ? null : Math.round(fix.accuracy);
  const radius = accuracy === null ? '' : ` · ±${accuracy} m`;

  const rejection = state.lastRejection;
  if (
    rejection &&
    now - rejection.at <= GPS_STALE_MS &&
    newerThan(rejection.at, state.lastSentAt)
  ) {
    if (rejection.reason === 'outside') {
      return {
        level: 'poor',
        label: 'Joylashuv hududdan tashqarida',
        hint: 'GPS xizmat hududidan uzoq nuqtani ko‘rsatmoqda. Joylashuv qayta aniqlanmoqda.',
      };
    }
    if (rejection.reason === 'too_fast') {
      return {
        level: 'fair',
        label: `GPS qayta aniqlanmoqda${radius}`,
        hint: 'Joylashuv keskin o‘zgardi, bir necha soniyada to‘g‘rilanadi.',
      };
    }
    return {
      level: 'poor',
      label: `GPS zaif${radius}`,
      hint: 'Joylashuv aniqligi past. Ochiq joyga chiqing yoki telefonni binodan tashqariga olib chiqing.',
    };
  }

  if (
    state.lastNetworkErrorAt !== null &&
    now - state.lastNetworkErrorAt <= GPS_STALE_MS &&
    newerThan(state.lastNetworkErrorAt, state.lastSentAt)
  ) {
    return {
      level: 'fair',
      label: `Joylashuv yuborilmayapti${radius}`,
      hint: 'Internet aloqasi tiklangach joylashuv yana yuboriladi.',
    };
  }

  if (accuracy === null || accuracy <= GOOD_ACCURACY_M) {
    return { level: 'good', label: `GPS yaxshi${radius}`, hint: null };
  }
  if (accuracy <= FAIR_ACCURACY_M) {
    return { level: 'fair', label: `GPS o‘rtacha${radius}`, hint: null };
  }
  return {
    level: 'poor',
    label: `GPS zaif${radius}`,
    hint: 'Joylashuv aniqligi past. Ochiq joyga chiqing.',
  };
}
