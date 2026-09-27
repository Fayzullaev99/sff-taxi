import {
  QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { appConfig, auth, driver, intercity, uploads } from '../api/driver';
import type { DriverMe } from '../api/types';
import { OFFICE_ADDRESS, SUPPORT_PHONE } from '../config';
import { isApiError } from '../lib/api-client';
import {
  DEFAULT_DRIVER_CONFIG,
  DEFAULT_PUBLIC_CONFIG,
  type DriverConfig,
  mapDriverConfig,
  mapPublicConfig,
  type PublicConfig,
  type Support,
} from '../lib/driver-config';
import { offersPollMs, POLL, pollInterval } from '../lib/refresh';
import { DEFAULT_UPLOADS_CONFIG, mapUploadsConfig, type UploadsConfig } from '../lib/upload-flow';
import { rulesFromConfig, rulesFromTariff, type WaitingRules } from '../lib/waiting';

export const keys = {
  account: ['account'] as const,
  me: ['driver', 'me'] as const,
  offers: ['driver', 'offers'] as const,
  current: ['driver', 'current'] as const,
  ride: (id: string) => ['driver', 'ride', id] as const,
  rides: ['driver', 'rides'] as const,
  balance: ['driver', 'balance'] as const,
  ledger: ['driver', 'ledger'] as const,
  earnings: (period: 'day' | 'week') => ['driver', 'earnings', period] as const,
  passes: ['driver', 'passes'] as const,
  tariff: ['tariff'] as const,
  driverConfig: ['driver', 'config'] as const,
  appConfig: ['config'] as const,
  uploadsConfig: ['uploads', 'config'] as const,
  appeals: ['driver', 'appeals'] as const,
  topups: ['driver', 'topups'] as const,
  topup: (id: string) => ['driver', 'topups', id] as const,
  /** Prefix of both trip lists (invalidating it refreshes both). */
  trips: ['driver', 'intercity', 'trips'] as const,
  upcomingTrips: ['driver', 'intercity', 'trips', 'upcoming'] as const,
  allTrips: ['driver', 'intercity', 'trips', 'all'] as const,
  trip: (id: string) => ['driver', 'intercity', 'trip', id] as const,
  points: ['intercity', 'points'] as const,
  fare: (from: string, to: string, rideClass: string) =>
    ['driver', 'intercity', 'fare', from, to, rideClass] as const,
};

/** Build-time contacts (EXPO_PUBLIC_*): used where the API publishes none. */
const BUILD_SUPPORT: Support = { phone: SUPPORT_PHONE, telegram: null, officeAddress: null };

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 10 * 60_000,
        // client errors will not fix themselves; network and 5xx get two more tries
        retry: (count, error) =>
          count < 2 && (!isApiError(error) || error.status === 0 || error.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}

// Realtime connection state, so polling can back off while the stream is up.
let streamOpen = false;
const streamListeners = new Set<() => void>();

export function setStreamOpen(open: boolean): void {
  if (streamOpen === open) return;
  streamOpen = open;
  streamListeners.forEach((l) => l());
}

export function useStreamOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      streamListeners.add(l);
      return () => streamListeners.delete(l);
    },
    () => streamOpen,
  );
}

/** The driver profile, or null when this account has not applied yet (404). */
export function useDriverMe(enabled = true) {
  const open = useStreamOpen();
  return useQuery({
    queryKey: keys.me,
    enabled,
    queryFn: async (): Promise<DriverMe | null> => {
      try {
        return await driver.me();
      } catch (error) {
        if (isApiError(error, 404)) return null;
        throw error;
      }
    },
    refetchInterval: pollInterval(open, POLL.profileWithoutStream),
  });
}

export function useAccount() {
  return useQuery({ queryKey: keys.account, queryFn: auth.account, staleTime: 5 * 60_000 });
}

export function useOffers(online: boolean, busy: boolean) {
  const open = useStreamOpen();
  const every = offersPollMs(online, busy, open);
  return useQuery({
    queryKey: keys.offers,
    queryFn: driver.offers,
    enabled: online && !busy,
    staleTime: 0,
    refetchInterval: every,
    refetchIntervalInBackground: false,
  });
}

export function useCurrentRide(enabled = true) {
  const open = useStreamOpen();
  return useQuery({
    queryKey: keys.current,
    queryFn: async () => (await driver.currentRide()).ride,
    enabled,
    refetchInterval: pollInterval(open, POLL.rideWithoutStream),
  });
}

export function useRide(id: string) {
  return useQuery({ queryKey: keys.ride(id), queryFn: () => driver.ride(id) });
}

export function useRides() {
  return useInfiniteQuery({
    queryKey: keys.rides,
    queryFn: ({ pageParam }) => driver.rides(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useBalance(enabled = true) {
  return useQuery({ queryKey: keys.balance, queryFn: driver.balance, enabled });
}

export function useLedger() {
  return useInfiniteQuery({
    queryKey: keys.ledger,
    queryFn: ({ pageParam }) => driver.ledger(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEarnings(period: 'day' | 'week') {
  return useQuery({ queryKey: keys.earnings(period), queryFn: () => driver.earnings(period) });
}

export function usePasses() {
  return useQuery({ queryKey: keys.passes, queryFn: driver.passes });
}

/**
 * The rules a driver works under (`GET /v1/driver/config`): the launch defaults until it
 * loads. Kept 10 minutes; refetched when the app comes back to the foreground.
 */
export function useDriverConfig(enabled = true): DriverConfig {
  const q = useQuery({
    queryKey: keys.driverConfig,
    queryFn: driver.config,
    enabled,
    staleTime: 10 * 60_000,
    select: (raw) => mapDriverConfig(raw, BUILD_SUPPORT),
  });
  return q.data ?? DEFAULT_DRIVER_CONFIG;
}

/** `GET /v1/config` (public): minimum app version, feature flags, support contacts. */
export function usePublicConfig() {
  return useQuery({
    queryKey: keys.appConfig,
    queryFn: appConfig.get,
    staleTime: 10 * 60_000,
    select: (raw): PublicConfig => mapPublicConfig(raw, BUILD_SUPPORT),
  });
}

/** The public config, or the defaults while it loads (never blocks a screen). */
export function useFeatures(): PublicConfig {
  return usePublicConfig().data ?? DEFAULT_PUBLIC_CONFIG;
}

/** Office phone, Telegram and address: the API's, else the build's, else the defaults. */
export function useSupport(): Support & { officeAddress: string } {
  const pub = usePublicConfig().data?.support;
  const drv = useQuery({
    queryKey: keys.driverConfig,
    queryFn: driver.config,
    enabled: false,
    select: (raw) => mapDriverConfig(raw, BUILD_SUPPORT).support,
  }).data;
  const s = drv ?? pub ?? BUILD_SUPPORT;
  return {
    phone: s.phone ?? pub?.phone ?? SUPPORT_PHONE,
    telegram: s.telegram ?? pub?.telegram ?? null,
    officeAddress: s.officeAddress ?? pub?.officeAddress ?? OFFICE_ADDRESS,
  };
}

/** What uploads accept (types, sizes per purpose) and whether they work at all. */
export function useUploadsConfig(): UploadsConfig {
  const q = useQuery({
    queryKey: keys.uploadsConfig,
    queryFn: uploads.config,
    staleTime: 60 * 60_000,
    select: mapUploadsConfig,
  });
  return q.data ?? DEFAULT_UPLOADS_CONFIG;
}

export function useAppeals(enabled = true) {
  // an answer comes as `appeal.updated` (and the `appeal_resolved` push); re-reading is the
  // fallback: every minute without the stream, every 5 minutes with it
  const open = useStreamOpen();
  return useQuery({
    queryKey: keys.appeals,
    queryFn: driver.appeals,
    enabled,
    refetchInterval: open ? 5 * 60_000 : 60_000,
  });
}

export function useTopups() {
  return useQuery({ queryKey: keys.topups, queryFn: driver.topups });
}

/** The trips still to run (and the one on the road), soonest first: `scope=upcoming`. */
export function useUpcomingTrips() {
  return useQuery({
    queryKey: keys.upcomingTrips,
    queryFn: async () => (await intercity.trips('upcoming')).items,
  });
}

/** Every trip, latest departure first, paged (the history below the upcoming ones). */
export function useTripHistory() {
  return useInfiniteQuery({
    queryKey: keys.allTrips,
    queryFn: ({ pageParam }) => intercity.trips('all', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useTrip(id: string, enabled = true) {
  const open = useStreamOpen();
  return useQuery({
    queryKey: keys.trip(id),
    queryFn: () => intercity.trip(id),
    enabled,
    refetchInterval: pollInterval(open, 15_000),
  });
}

export function useIntercityPoints() {
  return useQuery({ queryKey: keys.points, queryFn: intercity.points, staleTime: 60 * 60_000 });
}

export function useIntercityFare(
  from: string | null,
  to: string | null,
  rideClass: 'economy' | 'comfort',
) {
  return useQuery({
    queryKey: keys.fare(from ?? '', to ?? '', rideClass),
    queryFn: () => intercity.fare(from!, to!, rideClass),
    enabled: Boolean(from && to && from !== to),
    staleTime: 10 * 60_000,
  });
}

/**
 * Waiting rules where the ride starts: the published rules (`GET /v1/driver/config`),
 * refined by the city's own tariff (`GET /v1/tariffs`). Rarely changes, so kept for an hour.
 */
export function useWaitingRules(at: { lat: number; lng: number } | null): WaitingRules {
  const base = rulesFromConfig(useDriverConfig().rides);
  const q = useQuery({
    queryKey: [...keys.tariff, at ? `${at.lat.toFixed(2)},${at.lng.toFixed(2)}` : null],
    queryFn: () => driver.tariff(at!.lat, at!.lng),
    enabled: at !== null,
    staleTime: 60 * 60_000,
  });
  return q.data?.tariff ? rulesFromTariff(q.data.tariff, base) : base;
}

/** Refetch everything that depends on the driver's rides and money. */
export function useInvalidateDriver() {
  const qc = useQueryClient();
  return (extra: QueryKey[] = []) =>
    Promise.all(
      [keys.me, keys.offers, keys.current, keys.balance, ...extra].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}
