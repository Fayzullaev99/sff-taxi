import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { ApiError } from './client';
import { endpoints } from './endpoints';
import { pushFix } from './live-track';
import { keys } from './queries';
import { backoffMs, parseRealtimeEvent } from './realtime-logic';
import { API_URL, useIsSignedIn } from './session';
import { openStream } from './stream';

/** Long-lived XHR streams keep their whole body in memory: start a fresh one now and then. */
const RECYCLE_AFTER_MS = 15 * 60_000;

interface RealtimeContextValue {
  connected: boolean;
  acquire: () => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  acquire: () => () => undefined,
});

/**
 * Keeps one server-sent event stream open while a screen needs live ride updates, the
 * rider is signed in and the app is in the foreground (push covers the background).
 * Tickets are single-use, so every (re)connect asks for a new one; reconnects back off
 * exponentially. `ride.updated` is a nudge: the ride is refetched through the API;
 * `driver.location` carries the car's position and goes straight to the map.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const signedIn = useIsSignedIn();
  const [users, setUsers] = useState(0);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);

  const wanted = signedIn && users > 0 && active;

  useEffect(() => {
    if (!wanted) return;
    let stopped = false;
    let closeStream: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let recycleTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const refreshRides = (rideId?: string) => {
      void queryClient.invalidateQueries({ queryKey: keys.currentRide });
      void queryClient.invalidateQueries({ queryKey: rideId ? keys.ride(rideId) : ['ride'] });
      void queryClient.invalidateQueries({ queryKey: keys.history });
      void queryClient.invalidateQueries({ queryKey: keys.scheduled });
    };
    const refreshBookings = (bookingId?: string | null, tripId?: string) => {
      void queryClient.invalidateQueries({ queryKey: keys.bookings });
      void queryClient.invalidateQueries({
        queryKey: bookingId ? keys.booking(bookingId) : ['booking'],
      });
      void queryClient.invalidateQueries({
        queryKey: tripId ? keys.intercityTrip(tripId) : ['intercity-trip'],
      });
    };
    const refreshComplaints = (complaintId?: string) => {
      void queryClient.invalidateQueries({ queryKey: keys.complaints });
      void queryClient.invalidateQueries({
        queryKey: complaintId ? keys.complaint(complaintId) : ['complaint'],
      });
    };

    const drop = () => {
      if (recycleTimer) clearTimeout(recycleTimer);
      recycleTimer = null;
      closeStream?.();
      closeStream = null;
    };

    const reconnect = (immediately = false) => {
      drop();
      setConnected(false);
      if (stopped) return;
      const delay = immediately ? 0 : backoffMs(attempt);
      attempt++;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      let ticket: string;
      try {
        ticket = (await endpoints.streamTicket()).ticket;
      } catch (error) {
        // signed out while connecting: the effect is torn down by the session change
        if (error instanceof ApiError && error.status === 401) return;
        reconnect();
        return;
      }
      if (stopped) return;
      closeStream = openStream(`${API_URL}/v1/stream?ticket=${encodeURIComponent(ticket)}`, {
        onOpen: () => {
          attempt = 0;
          setConnected(true);
          // events sent while disconnected are lost: catch up once
          refreshRides();
          refreshBookings();
          refreshComplaints();
          recycleTimer = setTimeout(() => reconnect(true), RECYCLE_AFTER_MS);
        },
        onMessage: (raw) => {
          const event = parseRealtimeEvent(raw);
          if (!event) return;
          // a refund queued or made: the ride's payment state changed
          if (event.type === 'ride.updated' || event.type === 'ride.refund') {
            refreshRides(event.rideId);
          }
          if (event.type === 'driver.location') {
            pushFix(
              event.rideId,
              { lat: event.lat, lng: event.lng, heading: event.heading, at: event.at },
              event.etaS,
              event.destinationEtaS,
            );
          }
          if (event.type === 'intercity.updated') refreshBookings(event.bookingId, event.tripId);
          if (event.type === 'complaint.updated') refreshComplaints(event.complaintId);
        },
        onDown: () => {
          closeStream = null;
          reconnect();
        },
      });
    };

    void connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      drop();
      setConnected(false);
    };
  }, [wanted, queryClient]);

  const acquire = useCallback(() => {
    setUsers((n) => n + 1);
    return () => setUsers((n) => n - 1);
  }, []);

  const value = useMemo(() => ({ connected, acquire }), [connected, acquire]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Asks for live ride updates while the calling screen is mounted; true when connected. */
export function useLiveRides(enabled = true): boolean {
  const { connected, acquire } = useContext(RealtimeContext);
  useEffect(() => (enabled ? acquire() : undefined), [enabled, acquire]);
  return enabled && connected;
}
