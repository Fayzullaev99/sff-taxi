import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  AdminCity,
  AdminDriver,
  AdminRide,
  AdminRideItem,
  BillingRules,
  Candidate,
  DispatchRules,
  DriverListItem,
  DriverStatus,
  LedgerPage,
  LiveBoard,
  RideStatus,
  SosEvent,
  Tariff,
  TaxReport,
} from './types';

/**
 * Server state shared by the screens. Realtime events invalidate these keys
 * (api/realtime.ts); intervals are the fallback when the stream is down.
 */

/** Online drivers and open rides. Positions are not pushed, so this polls every few seconds. */
export function useLive(intervalMs = 5000) {
  return useQuery({
    queryKey: ['live'],
    queryFn: () => api<LiveBoard>('/v1/admin/dispatch/live'),
    refetchInterval: intervalMs,
    refetchIntervalInBackground: true,
  });
}

export function useSos(open = true, intervalMs = 20_000) {
  return useQuery({
    queryKey: ['sos', open ? 'open' : 'all'],
    queryFn: () => api<SosEvent[]>(`/v1/admin/sos?open=${open}`),
    refetchInterval: intervalMs,
    refetchIntervalInBackground: true,
  });
}

export function useRide(id: string | null) {
  return useQuery({
    queryKey: ['ride', id],
    queryFn: () => api<AdminRide>(`/v1/admin/rides/${id}`),
    enabled: Boolean(id),
  });
}

export function useCandidates(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['candidates', id],
    queryFn: () => api<Candidate[]>(`/v1/admin/dispatch/rides/${id}/candidates`),
    enabled: Boolean(id) && enabled,
    // free drivers move and come and go
    refetchInterval: 15_000,
  });
}

export function useRides(status: RideStatus | 'open', q: string) {
  return useQuery({
    queryKey: ['rides', status, q],
    queryFn: () => {
      const p = new URLSearchParams({ status });
      if (q) p.set('q', q);
      return api<AdminRideItem[]>(`/v1/admin/rides?${p}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useDrivers(status: DriverStatus | 'all', q = '', intervalMs?: number) {
  return useQuery({
    queryKey: ['drivers', status, q],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status !== 'all') p.set('status', status);
      if (q) p.set('q', q);
      const qs = p.toString();
      return api<DriverListItem[]>(`/v1/admin/drivers${qs ? `?${qs}` : ''}`);
    },
    placeholderData: (prev) => prev,
    refetchInterval: intervalMs,
  });
}

export function useDriver(id: string | undefined) {
  return useQuery({
    queryKey: ['driver', id],
    queryFn: () => api<AdminDriver>(`/v1/admin/drivers/${id}`),
    enabled: Boolean(id),
  });
}

export function useLedger(id: string | undefined, cursor: string | null) {
  return useQuery({
    queryKey: ['driver', id, 'ledger', cursor],
    queryFn: () =>
      api<LedgerPage>(`/v1/admin/billing/drivers/${id}/ledger${cursor ? `?cursor=${cursor}` : ''}`),
    enabled: Boolean(id),
  });
}

export function useTariff() {
  return useQuery({
    queryKey: ['settings', 'tariff'],
    queryFn: () => api<Tariff>('/v1/admin/settings/tariff'),
  });
}

export function useDispatchRules() {
  return useQuery({
    queryKey: ['settings', 'dispatch'],
    queryFn: () => api<DispatchRules>('/v1/admin/settings/dispatch'),
  });
}

export function useBillingRules() {
  return useQuery({
    queryKey: ['settings', 'billing'],
    queryFn: () => api<BillingRules>('/v1/admin/settings/billing'),
  });
}

export function useCities() {
  return useQuery({
    queryKey: ['admin-cities'],
    queryFn: () => api<AdminCity[]>('/v1/admin/geo/cities'),
  });
}

export function useTaxReport(period: string) {
  return useQuery({
    queryKey: ['taxes', period],
    queryFn: () => api<TaxReport>(`/v1/admin/billing/taxes?period=${period}`),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
  });
}
