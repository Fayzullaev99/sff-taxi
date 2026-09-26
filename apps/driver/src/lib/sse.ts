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
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.5 + random / 2));
}

/** Events the API sends a driver (apps/api realtime.publisher.ts); all are nudges to refetch. */
export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'offer.new'; offerId: string; rideId: string; expiresAt: string }
  | { type: 'offer.closed'; offerId: string; rideId: string; status: string }
  | { type: 'ride.updated'; rideId: string; status: string }
  | { type: 'driver.updated'; status: string };

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
        ? { type: 'offer.new', offerId: v.offerId, rideId: v.rideId, expiresAt: v.expiresAt }
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
    default:
      return null;
  }
}
