import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api, API_URL, ApiError, retryAfter } from './client';
import type { LiveBoard } from './types';

/** One driver in the operators' positions batch (every online driver, every 5 s). */
export interface DriverPosition {
  id: string;
  lat: number;
  lng: number;
  heading: number | null;
  at: string;
  busy: boolean;
}

/**
 * What the stream sends to operators (apps/api/src/modules/realtime/realtime.publisher.ts).
 * Events are nudges: the screens refetch the resource for details. Positions and offers are
 * applied to the live board directly, so the map moves without polling.
 */
export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'ping' }
  | { type: 'ride.updated'; rideId: string; status: string }
  /** No driver took the ride (reason no_driver), or an SOS on it (reason sos). */
  | { type: 'ride.attention'; rideId: string; reason: string }
  | { type: 'sos'; sosId: string; rideId: string }
  | { type: 'driver.updated'; driverId?: string; status: string }
  | { type: 'driver.appeal'; appealId: string; driverId: string }
  | { type: 'offer.new'; offerId: string; rideId: string; driverId: string; expiresAt: string }
  | { type: 'offer.closed'; offerId: string; rideId: string; driverId: string; status: string }
  | { type: 'drivers.positions'; drivers: DriverPosition[] }
  | { type: 'intercity.updated'; tripId: string; bookingId: string | null; status: string }
  | { type: 'complaint.updated'; complaintId: string; rideId: string; status: string };

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
      return [
        ['live'],
        ['rides'],
        ['ride'],
        ['candidates'],
        ['sos'],
        ['drivers'],
        ['driver'],
        ['appeals'],
        ['complaints'],
        ['complaint'],
        ['intercity'],
      ];
    case 'ride.updated':
    case 'ride.attention':
      return [['live'], ['rides'], ['ride', event.rideId], ['candidates', event.rideId]];
    case 'sos':
      return [['sos'], ['ride', event.rideId]];
    case 'driver.updated':
      return event.driverId
        ? [['drivers'], ['driver', event.driverId], ['live']]
        : [['drivers'], ['driver'], ['live']];
    case 'driver.appeal':
      return [['appeals'], ['driver', event.driverId]];
    case 'offer.new':
    case 'offer.closed':
      // the board itself is patched (applyOffer); the ride's offers and candidates refetch
      return [
        ['ride', event.rideId],
        ['candidates', event.rideId],
      ];
    case 'intercity.updated':
      return [['intercity']];
    case 'complaint.updated':
      return [['complaints'], ['complaint', event.complaintId]];
    default:
      return [];
  }
}

/**
 * Moves the cars on the live board to the batch's positions. Drivers in the batch but not on
 * the board (just came online) need a refetch: `missing` says so.
 */
export function applyPositions(
  board: LiveBoard,
  positions: readonly DriverPosition[],
): { board: LiveBoard; missing: boolean } {
  const byId = new Map(positions.map((p) => [p.id, p]));
  let changed = false;
  const drivers = board.drivers.map((d) => {
    const p = byId.get(d.id);
    if (!p || (p.lat === d.lat && p.lng === d.lng && p.at === d.locatedAt)) return d;
    changed = true;
    return { ...d, lat: p.lat, lng: p.lng, heading: p.heading, locatedAt: p.at };
  });
  const known = new Set(board.drivers.map((d) => d.id));
  const missing = positions.some((p) => !known.has(p.id));
  return { board: changed ? { ...board, drivers } : board, missing };
}

/** A new offer shows the driver as "offered"; a closed one frees them (unless accepted). */
export function applyOffer(
  board: LiveBoard,
  event: Extract<RealtimeEvent, { type: 'offer.new' | 'offer.closed' }>,
): LiveBoard {
  let changed = false;
  const drivers = board.drivers.map((d) => {
    if (d.id !== event.driverId) return d;
    if (event.type === 'offer.new') {
      if (d.state === 'busy' || d.offeredRideId === event.rideId) return d;
      changed = true;
      return { ...d, offeredRideId: event.rideId, state: 'offered' as const };
    }
    if (d.offeredRideId !== event.rideId) return d;
    changed = true;
    const accepted = event.status === 'accepted';
    // an accepted offer makes the driver busy; the ride.updated that follows refetches
    return {
      ...d,
      offeredRideId: null,
      rideId: accepted ? event.rideId : d.rideId,
      state: accepted || d.rideId ? ('busy' as const) : ('free' as const),
    };
  });
  return changed ? { ...board, drivers } : board;
}

/** Applies what an event carries to the cached live board. */
function patchLive(queryClient: QueryClient, event: RealtimeEvent): void {
  const board = queryClient.getQueryData<LiveBoard>(['live']);
  if (!board) return;
  if (event.type === 'drivers.positions') {
    const next = applyPositions(board, event.drivers);
    if (next.board !== board) queryClient.setQueryData(['live'], next.board);
    if (next.missing) void queryClient.invalidateQueries({ queryKey: ['live'] });
  } else if (event.type === 'offer.new' || event.type === 'offer.closed') {
    const next = applyOffer(board, event);
    if (next !== board) queryClient.setQueryData(['live'], next);
  }
}

/** How long to wait before asking for a new ticket: the API's Retry-After on 429, else 3 s. */
export function reconnectDelay(error: unknown): number {
  if (error instanceof ApiError && error.status === 429) return (retryAfter(error) ?? 30) * 1000;
  return 3000;
}

export type StreamState = 'connecting' | 'open' | 'down';

// The stream's state for every screen: polls fall back to fast intervals while it is down.
let streamState: StreamState = 'connecting';
const stateListeners = new Set<() => void>();
function setStreamState(next: StreamState) {
  if (next === streamState) return;
  streamState = next;
  for (const l of stateListeners) l();
}

export function useStreamState(): StreamState {
  return useSyncExternalStore(
    (onChange) => {
      stateListeners.add(onChange);
      return () => stateListeners.delete(onChange);
    },
    () => streamState,
  );
}

/** A slow safety poll while the stream is up; the fast one while it is not. */
export function pollInterval(state: StreamState, liveMs: number, fallbackMs: number): number {
  return state === 'open' ? liveMs : fallbackMs;
}

/**
 * Keeps one server-sent event stream open while signed in, reconnecting with a fresh
 * single-use ticket when it drops (the API's Retry-After is honoured on 429). Each event
 * refreshes the queries it affects; screens subscribe with `useRealtimeEvents`.
 */
export function useRealtime(enabled: boolean): StreamState {
  const queryClient = useQueryClient();
  const state = useStreamState();

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
          if (event.type === 'ready') setStreamState('open');
          patchLive(queryClient, event);
          for (const queryKey of staleKeys(event)) {
            void queryClient.invalidateQueries({ queryKey });
          }
          for (const listener of listeners) listener(event);
        };
        source.onerror = () => {
          // a ticket is single use: reconnect ourselves instead of EventSource's retry
          source?.close();
          setStreamState('down');
          schedule();
        };
      } catch (error) {
        setStreamState('down');
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

    setStreamState('connecting');
    void connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [enabled, queryClient]);

  return state;
}
