import { backoffMs } from './backoff';
import { distanceM, type Point } from './geo';
import { locationPolicy, type SendRules } from './location-policy';

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

/**
 * Body of `POST /v1/driver/location`: only the optional fields the phone really measured.
 * The API stamps the fix with its own clock and takes one fix per request (no trail).
 */
export interface LocationPayload extends Point {
  accuracy?: number;
  heading?: number;
  speed?: number;
}

/** The API refuses fixes whose accuracy radius is over 100 m (`422 inaccurate`). */
export const MAX_ACCURACY_M = 100;
/** A fix this accurate is "good"; while good ones come, rougher ones are skipped. */
export const GOOD_FIX_M = 50;
/** How long a good fix makes rough ones (50–100 m) not worth sending. */
export const EXPECT_GOOD_MS = 30_000;
/**
 * The API stamps a fix with the time it arrives, so an old fix would put the car where it
 * was, "now". Older fixes (a batch delivered late, a queued one after an outage) are dropped.
 */
export const MAX_FIX_AGE_MS = 30_000;
/** GPS deliveries are a little irregular: a fix 400 ms early still counts as due. */
export const JITTER_MS = 400;

/** The rules used when none are given: online and waiting for an offer. */
export const LOCATION_RULES: SendRules = locationPolicy('idle')!.send;

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

function accuracyOf(fix: Fix): number | null {
  return inRange(fix.accuracy, 0, 100_000) ? fix.accuracy : null;
}

/** Whether the phone itself says the fix is too rough for the API. */
export function isTooInaccurate(fix: Fix): boolean {
  const a = accuracyOf(fix);
  return a !== null && a > MAX_ACCURACY_M;
}

export type FixVerdict =
  | 'ok'
  /** Over 100 m: the API would refuse it. */
  | 'inaccurate'
  /** 50–100 m while good fixes are coming: a better one follows in seconds. */
  | 'rough'
  /** Not newer than the last fix seen (the same fix delivered twice, or out of order). */
  | 'duplicate'
  /** Taken too long ago to be sent as the position "now". */
  | 'stale'
  | 'invalid';

/** Whether a fix is worth considering at all, before any throttling. */
export function fixVerdict(
  fix: Fix,
  ctx: { lastSeenAt: number | null; lastGoodAt: number | null; now: number },
): FixVerdict {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180 ||
    (fix.lat === 0 && fix.lng === 0)
  ) {
    return 'invalid';
  }
  if (ctx.lastSeenAt !== null && fix.at <= ctx.lastSeenAt) return 'duplicate';
  if (ctx.now - fix.at > MAX_FIX_AGE_MS) return 'stale';
  const accuracy = accuracyOf(fix);
  if (accuracy !== null && accuracy > MAX_ACCURACY_M) return 'inaccurate';
  if (
    accuracy !== null &&
    accuracy > GOOD_FIX_M &&
    ctx.lastGoodAt !== null &&
    fix.at - ctx.lastGoodAt <= EXPECT_GOOD_MS
  ) {
    return 'rough';
  }
  return 'ok';
}

/** Whether `next` should be sent, given the last fix the server accepted. */
export function shouldSendLocation(
  lastSent: Fix | null,
  next: Fix,
  rules: SendRules = LOCATION_RULES,
): boolean {
  if (isTooInaccurate(next)) return false;
  if (!lastSent) return true;
  const elapsed = next.at - lastSent.at + JITTER_MS;
  if (elapsed < rules.minGapMs) return false;
  if (elapsed >= rules.keepAliveMs) return true;
  const moved = distanceM(lastSent, next);
  if (moved >= rules.moveM) return true;
  return elapsed >= rules.intervalMs && moved >= rules.stillM;
}

/** What the reporter did with a fix (for logs and tests). */
export type ReportResult = 'sent' | 'queued' | 'skipped' | Exclude<FixVerdict, 'ok'>;

export interface ReporterOptions {
  /** Every failed send (refusals, network, 403 …): for the GPS indicator and logs. */
  onError?: (error: unknown) => void;
  /** No connection or the server is down: the fix waits and is retried with backoff. */
  isRetryable?: (error: unknown) => boolean;
  now?: () => number;
  /** Schedules a retry; returns a cancel function. Timers may not run in the background. */
  schedule?: (fn: () => void, ms: number) => () => void;
  random?: () => number;
}

/** Retry after a failed send: 1 s, 2 s, 4 s … at most 30 s (with jitter). */
export const RETRY = { baseMs: 1_000, maxMs: 30_000 } as const;

/**
 * Feeds position fixes to `send`: filtered (accuracy, duplicates, stale), throttled by the
 * current rules, one request at a time. When a send fails for lack of network the newest
 * fix waits and is retried with exponential backoff; a fix arriving meanwhile replaces it
 * (the API takes no trail, and the newest position is the only useful one). Each new fix
 * also retries once the backoff is over, so nothing depends on timers running while the
 * app is in the background. Any other failure (a 422 refusal, 403) drops that fix.
 */
export class LocationReporter {
  private lastSent: Fix | null = null;
  private lastSeenAt: number | null = null;
  private lastGoodAt: number | null = null;
  private pending: Fix | null = null;
  private inFlight = false;
  private failures = 0;
  private retryAt = 0;
  private cancelTimer: (() => void) | null = null;
  private rules: SendRules;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly send: (payload: LocationPayload) => Promise<void>,
    rules: SendRules = LOCATION_RULES,
    private readonly options: ReporterOptions = {},
  ) {
    this.rules = rules;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  setRules(rules: SendRules): void {
    this.rules = rules;
  }

  get currentRules(): SendRules {
    return this.rules;
  }

  /** A fix is waiting to be sent (the last send failed). */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Consecutive failed sends. */
  get failureCount(): number {
    return this.failures;
  }

  /** Offers a new fix. Resolves with what happened to it. */
  async report(fix: Fix): Promise<ReportResult> {
    const verdict = fixVerdict(fix, {
      lastSeenAt: this.lastSeenAt,
      lastGoodAt: this.lastGoodAt,
      now: this.now(),
    });
    if (verdict === 'duplicate' || verdict === 'invalid') return verdict;
    this.lastSeenAt = fix.at;
    if (verdict !== 'ok') return verdict;
    const accuracy = accuracyOf(fix);
    if (accuracy === null || accuracy <= GOOD_FIX_M) this.lastGoodAt = fix.at;
    // with a fix waiting after a failure, the newer one simply replaces it
    if (!this.pending && !shouldSendLocation(this.lastSent, fix, this.rules)) return 'skipped';
    this.pending = fix;
    return (await this.pump()) ? 'sent' : 'queued';
  }

  /** Sends the waiting fix now, ignoring the backoff (e.g. the connection just came back). */
  flush(): Promise<boolean> {
    this.retryAt = 0;
    return this.pump();
  }

  /** Forget everything, e.g. when a new shift starts or tracking stops. */
  reset(): void {
    this.lastSent = null;
    this.lastSeenAt = null;
    this.lastGoodAt = null;
    this.pending = null;
    this.failures = 0;
    this.retryAt = 0;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  /** The API accepted a fix sent outside the reporter (the first fix of a shift). */
  markSent(fix: Fix): void {
    this.lastSent = fix;
    this.lastSeenAt = Math.max(this.lastSeenAt ?? fix.at, fix.at);
    this.pending = null;
    this.failures = 0;
    this.retryAt = 0;
  }

  private scheduleRetry(): void {
    if (!this.options.schedule) return;
    this.cancelTimer?.();
    this.cancelTimer = this.options.schedule(
      () => {
        this.cancelTimer = null;
        void this.pump();
      },
      Math.max(0, this.retryAt - this.now()),
    );
  }

  private async pump(): Promise<boolean> {
    if (this.inFlight || !this.pending) return false;
    if (this.now() < this.retryAt) {
      this.scheduleRetry();
      return false;
    }
    const fix = this.pending;
    if (this.now() - fix.at > MAX_FIX_AGE_MS) {
      // too old to be "now": wait for a fresh one
      this.pending = null;
      return false;
    }
    this.inFlight = true;
    let sent = false;
    try {
      await this.send(toLocationPayload(fix));
      sent = true;
      this.lastSent = fix;
      this.failures = 0;
      this.retryAt = 0;
    } catch (error) {
      const retry = this.options.isRetryable?.(error) ?? false;
      if (retry) {
        this.failures += 1;
        this.retryAt =
          this.now() + backoffMs(this.failures - 1, RETRY.baseMs, RETRY.maxMs, this.random());
      } else if (this.pending === fix) {
        // refused (422) or not allowed (403): this fix is not tried again
        this.pending = null;
      }
      this.options.onError?.(error);
      if (retry) this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
    if (!sent) return false;
    if (this.pending === fix) this.pending = null;
    // a newer fix arrived while this one was out: send it only if it is due by itself
    if (this.pending) {
      if (shouldSendLocation(this.lastSent, this.pending, this.rules)) await this.pump();
      else this.pending = null;
    }
    return true;
  }
}
