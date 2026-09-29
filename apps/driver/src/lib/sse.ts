import { backoffMs } from './backoff';

/** One server-sent event. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental text/event-stream parser: feed it chunks as they arrive and it
 * returns the complete events. Handles CRLF/LF, comments, multi-line data and
 * lines split across chunks.
 */
export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  /** Reconnect delay the server asked for, if any. */
  retryMs: number | null = null;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // a lone CR at the very end may be the first half of CRLF
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const message = this.line(line);
      if (message) out.push(message);
    }
    return out;
  }

  reset(): void {
    this.buffer = '';
    this.data = [];
    this.event = '';
  }

  private line(line: string): SseMessage | null {
    if (line === '') {
      if (!this.data.length) {
        this.event = '';
        return null;
      }
      const message = { event: this.event || 'message', data: this.data.join('\n') };
      this.data = [];
      this.event = '';
      return message;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retryMs = Number(value);
    return null;
  }
}

/** Exponential backoff with jitter: ~1 s, 2 s, 4 s … capped at 30 s. */
export function reconnectDelayMs(attempt: number, random: number = Math.random()): number {
  return backoffMs(attempt, 1_000, 30_000, random);
}

/**
 * The API writes a ping every 25 s (apps/api realtime.module.ts `HEARTBEAT_MS`). Silence
 * longer than one heartbeat plus a grace period means the link is dead (a mobile network
 * often drops a connection without closing it): reconnect instead of waiting for TCP.
 */
export const SERVER_HEARTBEAT_MS = 25_000;
export const STREAM_DEAD_AFTER_MS = SERVER_HEARTBEAT_MS + 10_000;

/** Whether the stream has been silent for too long to be trusted. */
export function streamIsStale(
  lastMessageAt: number | null,
  now: number,
  deadAfterMs: number = STREAM_DEAD_AFTER_MS,
): boolean {
  return lastMessageAt === null || now - lastMessageAt > deadAfterMs;
}

/** Events the API sends a driver (apps/api realtime.publisher.ts); all are nudges to refetch. */
export type RealtimeEvent =
  | { type: 'ready' }
  | {
      type: 'offer.new';
      offerId: string;
      rideId: string;
      expiresAt: string;
      /** A ride ordered for later (null = now). */
      scheduledFor: string | null;
    }
  | { type: 'offer.closed'; offerId: string; rideId: string; status: string }
  | { type: 'ride.updated'; rideId: string; status: string }
  | { type: 'driver.updated'; status: string }
  | { type: 'intercity.updated'; tripId: string; bookingId: string | null; status: string }
  /** A card top-up was paid: the balance grew. */
  | { type: 'topup.updated'; intentId: string; status: string; amount: number }
  /** An operator answered an appeal. */
  | { type: 'appeal.updated'; appealId: string; status: string };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function parseRealtimeEvent(data: string): RealtimeEvent | null {
  let v: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (v.type) {
    case 'ready':
      return { type: 'ready' };
    case 'offer.new':
      return str(v.offerId) && str(v.rideId) && str(v.expiresAt)
        ? {
            type: 'offer.new',
            offerId: v.offerId,
            rideId: v.rideId,
            expiresAt: v.expiresAt,
            scheduledFor: str(v.scheduledFor) ? v.scheduledFor : null,
          }
        : null;
    case 'offer.closed':
      return str(v.offerId) && str(v.rideId) && str(v.status)
        ? { type: 'offer.closed', offerId: v.offerId, rideId: v.rideId, status: v.status }
        : null;
    case 'ride.updated':
      return str(v.rideId) && str(v.status)
        ? { type: 'ride.updated', rideId: v.rideId, status: v.status }
        : null;
    case 'driver.updated':
      return str(v.status) ? { type: 'driver.updated', status: v.status } : null;
    case 'intercity.updated':
      return str(v.tripId) && str(v.status)
        ? {
            type: 'intercity.updated',
            tripId: v.tripId,
            bookingId: str(v.bookingId) ? v.bookingId : null,
            status: v.status,
          }
        : null;
    case 'topup.updated':
      return str(v.intentId) && str(v.status)
        ? {
            type: 'topup.updated',
            intentId: v.intentId,
            status: v.status,
            amount: typeof v.amount === 'number' && Number.isFinite(v.amount) ? v.amount : 0,
          }
        : null;
    case 'appeal.updated':
      return str(v.appealId) && str(v.status)
        ? { type: 'appeal.updated', appealId: v.appealId, status: v.status }
        : null;
    default:
      return null;
  }
}
