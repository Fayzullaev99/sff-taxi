import { stream } from '../api/driver';
import { API_URL } from '../config';
import { isApiError } from '../lib/api-client';
import { parseRealtimeEvent, reconnectDelayMs, type RealtimeEvent, SseParser } from '../lib/sse';

/** The server pings every 25 s; silence for this long means the connection is dead. */
const SILENCE_TIMEOUT_MS = 70_000;

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'retrying';

/**
 * Server-sent events over XMLHttpRequest (React Native has no EventSource).
 * Every connection needs a fresh single-use ticket from `POST /v1/stream/ticket`,
 * so reconnecting is done here rather than by the browser-style `retry:` logic.
 */
export class RealtimeConnection {
  private xhr: XMLHttpRequest | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private running = false;
  /** Bumped on every (re)connect so callbacks of a dropped connection are ignored. */
  private generation = 0;
  status: ConnectionStatus = 'idle';

  constructor(
    private readonly onEvent: (event: RealtimeEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.teardown();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setStatus('idle');
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  private teardown(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    const xhr = this.xhr;
    this.xhr = null;
    if (xhr) {
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      xhr.abort();
    }
  }

  private scheduleReconnect(generation: number): void {
    if (!this.running || generation !== this.generation) return;
    this.generation++;
    this.teardown();
    this.setStatus('retrying');
    const delay = reconnectDelayMs(this.attempt++);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private armSilenceTimer(generation: number): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.scheduleReconnect(generation), SILENCE_TIMEOUT_MS);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const generation = ++this.generation;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'retrying');
    let ticket: string;
    try {
      ticket = (await stream.ticket()).ticket;
    } catch (error) {
      // signed out: the session listener stops us; anything else is retried
      if (isApiError(error, 401)) return this.stop();
      return this.scheduleReconnect(generation);
    }
    if (!this.running || generation !== this.generation) return;

    const parser = new SseParser();
    const xhr = new XMLHttpRequest();
    this.xhr = xhr;
    let seen = 0;
    xhr.open('GET', `${API_URL}/v1/stream?ticket=${encodeURIComponent(ticket)}`);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    // handlers must be set before send() for React Native to deliver the body incrementally
    xhr.onreadystatechange = () => {
      if (generation !== this.generation) return;
      if (xhr.readyState < XMLHttpRequest.LOADING) return;
      if (xhr.status !== 200) return this.scheduleReconnect(generation);
      const text = xhr.responseText ?? '';
      if (text.length > seen) {
        const chunk = text.slice(seen);
        seen = text.length;
        this.armSilenceTimer(generation);
        for (const message of parser.push(chunk)) {
          const event = parseRealtimeEvent(message.data);
          if (!event) continue;
          if (event.type === 'ready') {
            this.attempt = 0;
            this.setStatus('open');
          }
          this.onEvent(event);
        }
      }
      if (xhr.readyState === XMLHttpRequest.DONE) this.scheduleReconnect(generation);
    };
    xhr.onerror = () => this.scheduleReconnect(generation);
    this.armSilenceTimer(generation);
    xhr.send();
  }
}
