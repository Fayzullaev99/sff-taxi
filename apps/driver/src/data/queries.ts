import {
  QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { auth, driver } from '../api/driver';
import type { DriverMe } from '../api/types';
import { isApiError } from '../lib/api-client';
import { offersPollMs, POLL, pollInterval } from '../lib/refresh';
import { DEFAULT_WAITING, rulesFromTariff, type WaitingRules } from '../lib/waiting';

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
};

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
 * Waiting rules where the ride starts (the public tariff); the launch defaults until it
 * loads or when offline. Rarely changes, so kept for an hour.
 */
export function useWaitingRules(at: { lat: number; lng: number } | null): WaitingRules {
  const q = useQuery({
    queryKey: [...keys.tariff, at ? `${at.lat.toFixed(2)},${at.lng.toFixed(2)}` : null],
    queryFn: () => driver.tariff(at!.lat, at!.lng),
    enabled: at !== null,
    staleTime: 60 * 60_000,
  });
  return q.data?.tariff ? rulesFromTariff(q.data.tariff) : DEFAULT_WAITING;
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
