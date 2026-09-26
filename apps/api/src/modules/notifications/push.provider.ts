import { Logger } from '@nestjs/common';

export interface PushMessage {
  /** Expo push token: ExponentPushToken[...] */
  to: string;
  title: string;
  body: string;
  /** Read by the app when the notification is tapped (e.g. which order to open). */
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  /** Android notification channel the app created (sound, importance). */
  channelId?: string;
  /** Seconds the push service keeps trying to deliver; after that it is dropped. */
  ttl?: number;
}

/** The push service's answer for one message, in the order the messages were sent. */
export interface PushTicket {
  status: 'ok' | 'error';
  /** Receipt id, to look up later whether Apple/Google accepted the message. */
  id?: string;
  /** e.g. DeviceNotRegistered, MessageTooBig, MessageRateExceeded, InvalidCredentials */
  error?: string;
  message?: string;
}

export interface PushReceipt {
  status: 'ok' | 'error';
  error?: string;
  message?: string;
}

export interface PushProvider {
  readonly name: string;
  /** Most messages per send() call. */
  readonly batchSize: number;
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Receipts known so far; ids not in the map are not ready yet (or unknown). */
  receipts(ids: string[]): Promise<Map<string, PushReceipt>>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/**
 * The whole push service is unavailable (network, 5xx, 429): nothing in the request was
 * delivered and trying again later may work. Anything else is a per-message failure.
 */
export class PushUnavailableError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
  }
}

/** The service refused the request itself (4xx): retrying the same request will not help. */
export class PushRejectedError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
  }
}

const TIMEOUT_MS = 10_000;
/** Expo accepts up to 100 messages per send request and 1000 ids per receipts request. */
const SEND_BATCH = 100;
const RECEIPTS_BATCH = 1000;

export interface ExpoConfig {
  /** https://exp.host/--/api/v2/push */
  baseUrl: string;
  accessToken?: string;
}

/** Expo push service: https://docs.expo.dev/push-notifications/sending-notifications/ */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  readonly batchSize = SEND_BATCH;

  constructor(private readonly config: ExpoConfig) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += SEND_BATCH) {
      const batch = messages.slice(i, i + SEND_BATCH);
      const body = await this.post<{ data?: PushTicketWire[] }>('send', batch);
      const data = body.data ?? [];
      if (data.length !== batch.length) {
        throw new PushRejectedError(
          this.name,
          `expected ${batch.length} tickets, got ${data.length}`,
        );
      }
      tickets.push(...data.map(toTicket));
    }
    return tickets;
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    const result = new Map<string, PushReceipt>();
    for (let i = 0; i < ids.length; i += RECEIPTS_BATCH) {
      const body = await this.post<{ data?: Record<string, PushTicketWire> }>('getReceipts', {
        ids: ids.slice(i, i + RECEIPTS_BATCH),
      });
      for (const [id, r] of Object.entries(body.data ?? {})) result.set(id, toTicket(r));
    }
    return result;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.config.accessToken
            ? { Authorization: `Bearer ${this.config.accessToken}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new PushUnavailableError(this.name, `${path} failed: ${(error as Error).message}`);
    }
    const text = await res.text().catch(() => '');
    if (res.status === 429 || res.status >= 500) {
      throw new PushUnavailableError(
        this.name,
        `${path} HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    if (!res.ok) {
      throw new PushRejectedError(this.name, `${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PushUnavailableError(this.name, `${path} returned invalid JSON`);
    }
  }
}

interface PushTicketWire {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

function toTicket(t: PushTicketWire): PushTicket {
  return t.status === 'ok'
    ? { status: 'ok', ...(t.id ? { id: t.id } : {}) }
    : {
        status: 'error',
        error: t.details?.error ?? 'Unknown',
        ...(t.message ? { message: t.message } : {}),
      };
}

/** Development and tests: logs instead of sending, keeps recent messages in memory. */
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  readonly batchSize = SEND_BATCH;
  readonly sent: PushMessage[] = [];
  private readonly logger = new Logger('ConsolePush');

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    for (const m of messages) {
      this.sent.push(m);
      this.logger.log(`Push not sent (console provider) to ${m.to}: ${m.title} — ${m.body}`);
    }
    if (this.sent.length > 500) this.sent.splice(0, this.sent.length - 500);
    return messages.map(() => ({ status: 'ok' }));
  }

  async receipts(): Promise<Map<string, PushReceipt>> {
    return new Map();
  }
}

/** Expo's own token format; anything else is not an Expo push token. */
export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[\w-]{10,100}\]$/;
