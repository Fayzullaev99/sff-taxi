import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, API_URL, ApiError, retryAfter } from './client';

/**
 * What the stream sends to operators (apps/api/src/modules/realtime/realtime.publisher.ts).
 * Events are nudges: the screens refetch the resource for details.
 */
export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'ping' }
  | { type: 'ride.updated'; rideId: string; status: string }
  /** No driver took the ride (reason no_driver), or an SOS on it (reason sos). */
  | { type: 'ride.attention'; rideId: string; reason: string }
  | { type: 'sos'; sosId: string; rideId: string }
  /** A driver's account status changed (the event does not say which driver). */
  | { type: 'driver.updated'; status: string };

type Listener = (event: RealtimeEvent) => void;
const listeners = new Set<Listener>();

/** Lets any screen react to stream events while the one stream stays open in the shell. */
export function useRealtimeEvents(onEvent: Listener) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const listener: Listener = (e) => handler.current(e);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

/** Query keys that go stale with an event; the screens showing them refetch. */
export function staleKeys(event: RealtimeEvent): unknown[][] {
  switch (event.type) {
    case 'ready':
      // anything may have changed while we were disconnected
      return [['live'], ['rides'], ['ride'], ['candidates'], ['sos'], ['drivers'], ['driver']];
    case 'ride.updated':
      return [['live'], ['rides'], ['ride', event.rideId], ['candidates', event.rideId]];
    case 'ride.attention':
      return [['live'], ['rides'], ['ride', event.rideId], ['candidates', event.rideId]];
    case 'sos':
      return [['sos'], ['ride', event.rideId]];
    case 'driver.updated':
      return [['drivers'], ['driver'], ['live']];
    default:
      return [];
  }
}

/** How long to wait before asking for a new ticket: the API's Retry-After on 429, else 3 s. */
export function reconnectDelay(error: unknown): number {
  if (error instanceof ApiError && error.status === 429) return (retryAfter(error) ?? 30) * 1000;
  return 3000;
}

export type StreamState = 'connecting' | 'open' | 'down';

/**
 * Keeps one server-sent event stream open while signed in, reconnecting with a fresh
 * single-use ticket when it drops (the API's Retry-After is honoured on 429). Each event
 * refreshes the queries it affects; screens subscribe with `useRealtimeEvents`.
 */
export function useRealtime(enabled: boolean): StreamState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>('/v1/stream/ticket', { method: 'POST' });
        if (stopped) return;
        source = new EventSource(`${API_URL}/v1/stream?ticket=${encodeURIComponent(ticket)}`);
        source.onmessage = (message) => {
          let event: RealtimeEvent;
          try {
            event = JSON.parse(message.data as string) as RealtimeEvent;
          } catch {
            return;
          }
          if (event.type === 'ready') setState('open');
          for (const queryKey of staleKeys(event)) {
            void queryClient.invalidateQueries({ queryKey });
          }
          for (const listener of listeners) listener(event);
        };
        source.onerror = () => {
          // a ticket is single use: reconnect ourselves instead of EventSource's retry
          source?.close();
          setState('down');
          schedule();
        };
      } catch (error) {
        setState('down');
        schedule(reconnectDelay(error));
      }
    };
    const schedule = (ms = 3000) => {
      if (stopped || retry) return;
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, ms);
    };

    void connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [enabled, queryClient]);

  return state;
}
