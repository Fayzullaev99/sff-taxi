import { keepPreviousData, QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from './client';
import { endpoints } from './endpoints';
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
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: { retry: false },
  },
});

/** ~1 m precision is plenty and keeps cache keys stable. */
const round = (n: number) => Math.round(n * 1e5) / 1e5;
/** ~100 m: tariffs and service areas do not change within a street. */
const coarse = (n: number) => Math.round(n * 1e3) / 1e3;

export const keys = {
  me: ['me'] as const,
  geoConfig: ['geo-config'] as const,
  tariff: (p: LatLng) => ['tariff', coarse(p.lat), coarse(p.lng)] as const,
  resolve: (p: LatLng) => ['geo-resolve', coarse(p.lat), coarse(p.lng)] as const,
  reverse: (p: LatLng) => ['geo-reverse', round(p.lat), round(p.lng)] as const,
  quote: (pickup: LatLng, dropoff: LatLng, options: RideOption[]) =>
    [
      'quote',
      round(pickup.lat),
      round(pickup.lng),
      round(dropoff.lat),
      round(dropoff.lng),
      [...options].sort(),
    ] as const,
  currentRide: ['ride-current'] as const,
  ride: (id: string) => ['ride', id] as const,
  history: ['rides'] as const,
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

export function useQuote(pickup: LatLng | null, dropoff: LatLng | null, options: RideOption[]) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: keys.quote(pickup ?? { lat: 0, lng: 0 }, dropoff ?? { lat: 0, lng: 0 }, options),
    queryFn: () => endpoints.quote(pickup!, dropoff!, options),
    enabled: signedIn && pickup !== null && dropoff !== null,
    staleTime: QUOTE_REFRESH_MS,
    refetchInterval: QUOTE_REFRESH_MS,
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
 * for when the stream is down, slower once the ride is over.
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

/** After sign-out: nothing of the previous account may stay on screen. */
export function clearAccountData(): void {
  queryClient.removeQueries({ queryKey: keys.me });
  queryClient.removeQueries({ queryKey: keys.currentRide });
  queryClient.removeQueries({ queryKey: ['ride'] });
  queryClient.removeQueries({ queryKey: keys.history });
  queryClient.removeQueries({ queryKey: ['quote'] });
}
