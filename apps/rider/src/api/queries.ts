import {
  keepPreviousData,
  onlineManager,
  QueryClient,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { ApiError } from './client';
import { endpoints } from './endpoints';
import { isOnline, subscribeOnline } from './reachability';
import { useIsSignedIn } from './session';
import type { LatLng, Ride, RideOption } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // client errors will not get better by asking again; network trouble might
      retry: (count, error) =>
        error instanceof ApiError ? error.status >= 500 && count < 2 : count < 3,
      // exponential with jitter: phones that lost the network together do not come back
      // in lockstep
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000) * (0.75 + Math.random() * 0.5),
    },
    mutations: { retry: false },
  },
});

/**
 * React Native has no "online" event: the API client's reachability is the signal. While
 * no request gets an answer, queries and their retries pause instead of piling up; when
 * the connection is back (the offline banner's probe or any request answers), the stale
 * queries on screen refetch once (`refetchOnReconnect`).
 */
onlineManager.setEventListener((setOnline) => subscribeOnline(() => setOnline(isOnline())));

/** ~1 m precision is plenty and keeps cache keys stable. */
const round = (n: number) => Math.round(n * 1e5) / 1e5;
/** ~100 m: tariffs and service areas do not change within a street. */
const coarse = (n: number) => Math.round(n * 1e3) / 1e3;

export const keys = {
  me: ['me'] as const,
  config: ['app-config'] as const,
  geoConfig: ['geo-config'] as const,
  tariff: (p: LatLng) => ['tariff', coarse(p.lat), coarse(p.lng)] as const,
  resolve: (p: LatLng) => ['geo-resolve', coarse(p.lat), coarse(p.lng)] as const,
  reverse: (p: LatLng) => ['geo-reverse', round(p.lat), round(p.lng)] as const,
  quote: (pickup: LatLng, dropoff: LatLng, options: RideOption[], scheduledFor: string | null) =>
    [
      'quote',
      round(pickup.lat),
      round(pickup.lng),
      round(dropoff.lat),
      round(dropoff.lng),
      [...options].sort(),
      scheduledFor,
    ] as const,
  currentRide: ['ride-current'] as const,
  ride: (id: string) => ['ride', id] as const,
  history: ['rides'] as const,
  scheduled: ['rides-scheduled'] as const,
  places: ['places'] as const,
  recentPlaces: ['places-recent'] as const,
  complaints: ['complaints'] as const,
  complaint: (id: string) => ['complaint', id] as const,
  intercityPoints: ['intercity-points'] as const,
  intercityTrips: (q: { from: string; to: string; date: string; seats: number }) =>
    ['intercity-trips', q.from, q.to, q.date, q.seats] as const,
  intercityTrip: (id: string) => ['intercity-trip', id] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
};

export function useMe() {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.me,
    queryFn: endpoints.me,
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

/** Support contacts, the minimum app version, what is switched on (public, changes rarely). */
export function useAppConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: endpoints.config,
    staleTime: 30 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

/** Map provider, tiles, default centre and service areas: changes rarely. */
export function useGeoConfig() {
  return useQuery({
    queryKey: keys.geoConfig,
    queryFn: endpoints.geoConfig,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

/** Whether rides start at this point (city or its service radius), and the tariff there. */
export function useTariffAt(point: LatLng | null) {
  return useQuery({
    queryKey: keys.tariff(point ?? { lat: 0, lng: 0 }),
    queryFn: () => endpoints.tariff(point!),
    enabled: point !== null,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Where a point is, for the "we do not work here yet" message. */
export function useResolve(point: LatLng | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.resolve(point ?? { lat: 0, lng: 0 }),
    queryFn: () => endpoints.geoResolve(point!),
    enabled: enabled && point !== null,
    staleTime: 10 * 60_000,
  });
}

/** How long a quote is kept before asking again (the API honours it for 10 minutes). */
const QUOTE_REFRESH_MS = 8 * 60_000;
/** A ride now also shows the nearest free car: that goes stale faster than the price. */
const AVAILABILITY_REFRESH_MS = 60_000;

export function useQuote(
  pickup: LatLng | null,
  dropoff: LatLng | null,
  options: RideOption[],
  scheduledFor: string | null = null,
) {
  const signedIn = useIsSignedIn();
  const every = scheduledFor ? QUOTE_REFRESH_MS : AVAILABILITY_REFRESH_MS;
  return useQuery({
    queryKey: keys.quote(
      pickup ?? { lat: 0, lng: 0 },
      dropoff ?? { lat: 0, lng: 0 },
      options,
      scheduledFor,
    ),
    queryFn: () => endpoints.quote(pickup!, dropoff!, options, scheduledFor),
    enabled: signedIn && pickup !== null && dropoff !== null,
    staleTime: every,
    refetchInterval: every,
    gcTime: QUOTE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useCurrentRide() {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.currentRide,
    queryFn: async () => (await endpoints.currentRide()).ride,
    enabled: signedIn,
    staleTime: 10_000,
  });
}

/**
 * One ride. Live updates come as SSE nudges (see realtime.tsx); the poll is a fallback
 * for when the stream is down, slower once the ride is over. A card ride waiting for its
 * payment is polled fast: the payment is confirmed server to server by Payme/Click.
 */
export function useRide(id: string | undefined, live: boolean) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.ride(id ?? ''),
    queryFn: () => endpoints.ride(id!),
    enabled: signedIn && Boolean(id),
    staleTime: 5_000,
    refetchInterval: (q) => {
      const ride = q.state.data as Ride | undefined;
      if (ride && (ride.status === 'completed' || ride.status === 'cancelled')) return false;
      if (ride?.status === 'awaiting_payment') return 4_000;
      if (ride?.status === 'scheduled') return 60_000;
      return live ? 30_000 : 8_000;
    },
  });
}

export function useHistory() {
  const signedIn = useIsSignedIn();
  return useInfiniteQuery({
    queryKey: keys.history,
    queryFn: ({ pageParam }) => endpoints.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: signedIn,
  });
}

/** Rides ordered for later, soonest first. */
export function useScheduledRides() {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.scheduled,
    queryFn: endpoints.scheduledRides,
    enabled: signedIn,
    staleTime: 30_000,
  });
}

/** Saved places (home, work, others) of the account. */
export function useSavedPlaces() {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.places,
    queryFn: endpoints.places,
    enabled: signedIn,
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

/** Recent destinations from the ride history. */
export function useRecentPlaces() {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.recentPlaces,
    queryFn: endpoints.recentPlaces,
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

export function useComplaints() {
  const signedIn = useIsSignedIn();
  return useInfiniteQuery({
    queryKey: keys.complaints,
    queryFn: ({ pageParam }) => endpoints.complaints(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: signedIn,
  });
}

export function useComplaint(id: string | undefined) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.complaint(id ?? ''),
    queryFn: () => endpoints.complaint(id!),
    enabled: signedIn && Boolean(id),
    staleTime: 10_000,
    // operators answer in the panel: a slow poll next to the stream's nudges
    refetchInterval: 60_000,
  });
}

export function useIntercityPoints() {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.intercityPoints,
    queryFn: endpoints.intercityPoints,
    enabled: signedIn,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function useIntercityTrips(
  q: { from: string; to: string; date: string; seats: number } | null,
) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.intercityTrips(q ?? { from: '', to: '', date: '', seats: 1 }),
    queryFn: () => endpoints.intercityTrips(q!),
    enabled: signedIn && q !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useIntercityTrip(id: string | undefined) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.intercityTrip(id ?? ''),
    queryFn: () => endpoints.intercityTrip(id!),
    enabled: signedIn && Boolean(id),
    staleTime: 15_000,
  });
}

export function useBookings() {
  const signedIn = useIsSignedIn();
  return useInfiniteQuery({
    queryKey: keys.bookings,
    queryFn: ({ pageParam }) => endpoints.bookings(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: signedIn,
  });
}

export function useBooking(id: string | undefined) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.booking(id ?? ''),
    queryFn: () => endpoints.booking(id!),
    enabled: signedIn && Boolean(id),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
}

/** After sign-out: nothing of the previous account may stay on screen. */
export function clearAccountData(): void {
  for (const key of [
    keys.me,
    keys.currentRide,
    ['ride'],
    keys.history,
    ['quote'],
    keys.scheduled,
    keys.places,
    keys.recentPlaces,
    keys.complaints,
    ['complaint'],
    ['intercity-trips'],
    ['intercity-trip'],
    keys.bookings,
    ['booking'],
  ]) {
    queryClient.removeQueries({ queryKey: key });
  }
}
