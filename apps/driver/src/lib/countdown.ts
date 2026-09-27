/**
 * The offer countdown. Offers expire on the server's clock (`expiresAt`), but a driver's
 * phone clock is often minutes off (manual time, no network time on cheap phones). The
 * API client therefore reports the server's `Date` header and the countdown runs on the
 * estimated server time, capped by how long an offer can possibly last.
 */

/** How long the API holds an offer (dispatch settings: 15 s direct, 30 s broadcast). */
export const OFFER_SECONDS = { direct: 15, broadcast: 30 } as const;
export type OfferKind = keyof typeof OFFER_SECONDS;

/** The last seconds are shown in red with a stronger pulse. */
export const URGENT_SECONDS = 5;

/**
 * Estimates `server time - phone time` from HTTP `Date` headers. The header has 1 s
 * resolution and is truncated, and network delay makes each sample too small, so the
 * largest of the recent samples (+ half a second) is the best estimate.
 */
export class ServerClock {
  private samples: number[] = [];

  constructor(private readonly keep = 8) {}

  observe(serverMs: number, localMs: number): void {
    if (!Number.isFinite(serverMs) || !Number.isFinite(localMs)) return;
    this.samples.push(serverMs - localMs);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  /** ms to add to the phone's clock to get the server's; 0 until an answer arrived. */
  get offsetMs(): number {
    return this.samples.length ? Math.max(...this.samples) + 500 : 0;
  }

  now(localMs: number = Date.now()): number {
    return localMs + this.offsetMs;
  }
}

export interface Countdown {
  /** Whole seconds left, rounded up (shown in the ring). */
  seconds: number;
  /** 1 when the offer just arrived, 0 when it is over (the ring's filled share). */
  fraction: number;
  expired: boolean;
  urgent: boolean;
}

export function offerCountdown(args: {
  expiresAt: string;
  kind: string;
  /** Estimated server time now (ms). */
  serverNow: number;
  /** The offer lengths the API publishes (`GET /v1/driver/config`), seconds. */
  lengths?: { direct: number; broadcast: number };
}): Countdown {
  const lengths = args.lengths ?? OFFER_SECONDS;
  const seconds0 = args.kind === 'broadcast' ? lengths.broadcast : lengths.direct;
  const total = (seconds0 > 0 ? seconds0 : OFFER_SECONDS.direct) * 1000;
  const expires = Date.parse(args.expiresAt);
  const raw = Number.isNaN(expires) ? 0 : expires - args.serverNow;
  const left = Math.max(0, Math.min(total, raw));
  const seconds = Math.ceil(left / 1000);
  return {
    seconds,
    fraction: left / total,
    expired: left <= 0,
    urgent: seconds <= URGENT_SECONDS,
  };
}

/** How many of `segments` ring segments stay lit for a fraction (never lit when expired). */
export function litSegments(fraction: number, segments: number): number {
  if (!(fraction > 0)) return 0;
  return Math.min(segments, Math.ceil(fraction * segments));
}
