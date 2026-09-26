import { distanceM, type Point } from './geo';

/** A position fix with the time it was taken (ms since epoch) and what the phone knows about it. */
export interface Fix extends Point {
  at: number;
  /** Horizontal accuracy radius in metres (null/undefined when the phone does not say). */
  accuracy?: number | null;
  /** Direction of travel in degrees from north (iOS reports -1 when unknown). */
  heading?: number | null;
  /** Metres per second (iOS reports -1 when unknown). */
  speed?: number | null;
}

/** Body of `POST /v1/driver/location`: only the optional fields the phone really measured. */
export interface LocationPayload extends Point {
  accuracy?: number;
  heading?: number;
  speed?: number;
}

export interface ThrottleRules {
  /** Never send more often than this, however fast the driver moves. */
  minGapMs: number;
  /** Send at least this often while positions keep coming in. */
  intervalMs: number;
  /** Movement since the last sent fix that justifies sending early. */
  moveM: number;
  /**
   * Fixes less accurate than this are not sent at all: the API refuses them (422
   * `inaccurate`), so sending would only cost battery and data.
   */
  maxAccuracyM?: number;
}

/** The API refuses fixes whose accuracy radius is over 100 m. */
export const MAX_ACCURACY_M = 100;

/**
 * Online drivers report every 3-5 s (architecture §11): dispatch ranks drivers by road ETA
 * from their last fix, and the rider watches the car come. At most every 3 s, at least
 * every 5 s while fixes come in, or after moving 25 m (about 3 s at city speed).
 */
export const LOCATION_RULES: ThrottleRules = {
  minGapMs: 3_000,
  intervalMs: 5_000,
  moveM: 25,
  maxAccuracyM: MAX_ACCURACY_M,
};

function inRange(value: number | null | undefined, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** The API body for a fix, dropping "unknown" (-1, null, NaN) and out-of-range readings. */
export function toLocationPayload(fix: Fix): LocationPayload {
  const payload: LocationPayload = { lat: fix.lat, lng: fix.lng };
  if (inRange(fix.accuracy, 0, 100_000)) payload.accuracy = Math.round(fix.accuracy * 10) / 10;
  // 360 is the same direction as 0
  if (inRange(fix.heading, 0, 360)) payload.heading = Math.round(fix.heading) % 360;
  if (inRange(fix.speed, 0, 1000)) payload.speed = Math.round(fix.speed * 10) / 10;
  return payload;
}

/** Whether the phone itself says the fix is too rough to be worth sending. */
export function isTooInaccurate(fix: Fix, rules: ThrottleRules = LOCATION_RULES): boolean {
  return (
    rules.maxAccuracyM !== undefined &&
    typeof fix.accuracy === 'number' &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy > rules.maxAccuracyM
  );
}

/** Whether `next` should be sent, given the last fix the server accepted. */
export function shouldSendLocation(
  lastSent: Fix | null,
  next: Fix,
  rules: ThrottleRules = LOCATION_RULES,
): boolean {
  if (isTooInaccurate(next, rules)) return false;
  if (!lastSent) return true;
  const elapsed = next.at - lastSent.at;
  if (elapsed < rules.minGapMs) return false;
  if (elapsed >= rules.intervalMs) return true;
  return distanceM(lastSent, next) > rules.moveM;
}

/**
 * Feeds position fixes to `send`, throttled. One request at a time; a failed
 * send is not remembered, so the next fix is tried again.
 */
export class LocationReporter {
  private lastSent: Fix | null = null;
  private inFlight = false;

  constructor(
    private readonly send: (payload: LocationPayload) => Promise<void>,
    private readonly rules: ThrottleRules = LOCATION_RULES,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  /** Resolves true when the fix was sent. */
  async report(fix: Fix): Promise<boolean> {
    if (this.inFlight || !shouldSendLocation(this.lastSent, fix, this.rules)) return false;
    this.inFlight = true;
    try {
      await this.send(toLocationPayload(fix));
      this.lastSent = fix;
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    } finally {
      this.inFlight = false;
    }
  }

  /** Forget the last fix, e.g. when a new shift starts. */
  reset(): void {
    this.lastSent = null;
  }
}
