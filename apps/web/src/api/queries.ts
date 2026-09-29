import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { mergeLiveDrivers } from '../lib/pool';
import { api, ApiError } from './client';
import { hideDropped, pollInterval, useStreamState } from './realtime';
import type {
  AdminCity,
  AdminDriver,
  AdminRide,
  AdminRideItem,
  AdminTrip,
  AnyRideClass,
  AppConfig,
  BillingRules,
  BookingRules,
  CargoRules,
  Candidate,
  Complaint,
  ComplaintItem,
  DispatchRules,
  DriverAppeal,
  DriverListItem,
  DriverPayout,
  DriverStatus,
  FiscalReceipt,
  FiscalRules,
  IntercityPoint,
  IntercityRules,
  IntentPurpose,
  IntentStatus,
  IntentSummaryRow,
  LedgerPage,
  LiveBoard,
  OutboxEvent,
  Paged,
  PoolRules,
  PaymentIntent,
  PaymentProvider,
  Rating,
  ReasonLabels,
  Refund,
  RideService,
  RideStatus,
  RouteFare,
  RoutePrice,
  SosEvent,
  Tariff,
  TaxReport,
  TripStatus,
  Upload,
} from './types';

/**
 * Server state shared by the screens. Realtime events invalidate these keys
 * (api/realtime.ts); intervals are the fallback when the stream is down.
 */

/**
 * Online drivers and open rides. Positions come in the stream's `drivers.positions` batch and
 * offers in `offer.*` events (applied to this cache); the poll is a slow safety net while the
 * stream is up and the old fast poll while it is down.
 */
export function useLive(liveMs = 30_000, fallbackMs = 5000) {
  const stream = useStreamState();
  return useQuery({
    queryKey: ['live'],
    // a shared car comes once per ride it carries: one row per car
    queryFn: async () => mergeLiveDrivers(await api<LiveBoard>('/v1/admin/dispatch/live')),
    // drivers a positions batch listed offline stay off the map after a refetch
    select: hideDropped,
    refetchInterval: pollInterval(stream, liveMs, fallbackMs),
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

/** Server-side ride filters (GET /admin/rides); days are Tashkent dates, inclusive. */
export interface RideFilters {
  status: RideStatus | 'open' | 'all';
  q?: string;
  driverId?: string;
  riderId?: string;
  class?: AnyRideClass | '';
  service?: RideService | '';
  from?: string;
  to?: string;
}

/** The API sends up to this many rides per page; the next page starts after the last id. */
export const RIDES_PAGE = 200;

export function ridesQuery(f: Omit<RideFilters, 'driverId'> & { driverId?: string }): string {
  const p = new URLSearchParams();
  p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  if (f.driverId) p.set('driverId', f.driverId);
  if (f.riderId) p.set('riderId', f.riderId);
  if (f.class) p.set('class', f.class);
  if (f.service) p.set('service', f.service);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return p.toString();
}

/** The cursor of the page after `page`: the last id when the page was full. */
export function nextCursorOf<T extends { id: string }>(page: readonly T[], size: number) {
  return page.length >= size ? page.at(-1)!.id : undefined;
}

/** Rides with server-side filters and cursor paging ("Ko‘proq"). */
export function useRides(filters: RideFilters) {
  return useInfiniteQuery({
    queryKey: ['rides', filters],
    queryFn: ({ pageParam }) =>
      api<AdminRideItem[]>(
        `/v1/admin/rides?${ridesQuery(filters)}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => nextCursorOf(last, RIDES_PAGE),
    placeholderData: (prev) => prev,
  });
}

/** One driver's rides (GET /admin/drivers/:id/rides), same filters and paging. */
export function useDriverRides(
  driverId: string | undefined,
  filters: Omit<RideFilters, 'driverId'>,
) {
  return useInfiniteQuery({
    queryKey: ['driver', driverId, 'rides', filters],
    queryFn: ({ pageParam }) =>
      api<AdminRideItem[]>(
        `/v1/admin/drivers/${driverId}/rides?${ridesQuery(filters)}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => nextCursorOf(last, RIDES_PAGE),
    enabled: Boolean(driverId),
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

export function useAppeals(status: 'open' | 'resolved', intervalMs?: number) {
  return useQuery({
    queryKey: ['appeals', status],
    queryFn: () => api<DriverAppeal[]>(`/v1/admin/drivers/appeals?status=${status}`),
    refetchInterval: intervalMs,
  });
}

/** A fresh read URL for an uploaded file (the ones in views expire after 15 minutes). */
export function useUpload(id: string | null | undefined) {
  return useQuery({
    queryKey: ['upload', id],
    queryFn: () => api<Upload>(`/v1/uploads/${id}`),
    enabled: Boolean(id),
    // read URLs live 15 minutes: take a new one well before
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function useAppConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<AppConfig>('/v1/config', { auth: false }),
    staleTime: 5 * 60_000,
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

export function useIntercityRules() {
  return useQuery({
    queryKey: ['settings', 'intercity'],
    queryFn: () => api<IntercityRules>('/v1/admin/settings/intercity'),
  });
}

export function useFiscalRules() {
  return useQuery({
    queryKey: ['settings', 'fiscal'],
    queryFn: () => api<FiscalRules>('/v1/admin/settings/fiscal'),
  });
}

export function usePoolRules() {
  return useQuery({
    queryKey: ['settings', 'pool'],
    queryFn: () => api<PoolRules>('/v1/admin/settings/pool'),
  });
}

/**
 * Deposits of rides booked in advance. An API without the endpoint (404) gives null: the
 * panel hides the section instead of failing.
 */
export function useBookingRules() {
  return useQuery({
    queryKey: ['settings', 'booking'],
    queryFn: () => orNullOn404(api<BookingRules>('/v1/admin/settings/booking')),
  });
}

/** Cargo prices and deliveries; null on an API without them (the section stays hidden). */
export function useCargoRules() {
  return useQuery({
    queryKey: ['settings', 'cargo'],
    queryFn: () => orNullOn404(api<CargoRules>('/v1/admin/settings/cargo')),
  });
}

/** An endpoint an older API build does not have yet: null instead of an error. */
async function orNullOn404<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Fixed route prices of rides between towns (GET /admin/routes), active or not. */
export function useRouteFares() {
  return useQuery({
    queryKey: ['routes'],
    queryFn: () => api<RouteFare[]>('/v1/admin/routes'),
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

/** Card payments (GET /admin/payments/intents): server filters, Tashkent days, cursor paging. */
export interface IntentFilters {
  purpose?: IntentPurpose | '';
  /** An intent status, or "failed": expired or cancelled without a payment. */
  status?: IntentStatus | 'failed' | '';
  provider?: PaymentProvider | '';
  phone?: string;
  driverId?: string;
  rideId?: string;
  from?: string;
  to?: string;
}

export function intentsQuery(f: IntentFilters): string {
  const p = new URLSearchParams();
  for (const key of [
    'purpose',
    'status',
    'provider',
    'phone',
    'driverId',
    'rideId',
    'from',
    'to',
  ] as const) {
    const v = f[key];
    if (v) p.set(key, v);
  }
  return p.toString();
}

export function useIntents(f: IntentFilters) {
  return useInfiniteQuery({
    queryKey: ['payments', 'intents', f],
    queryFn: ({ pageParam }) => {
      const qs = intentsQuery(f);
      const cursor = pageParam ? `cursor=${pageParam}` : '';
      const all = [qs, cursor].filter(Boolean).join('&');
      return api<Paged<PaymentIntent>>(`/v1/admin/payments/intents${all ? `?${all}` : ''}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
}

/** Totals per purpose and status over the same Tashkent days. */
export function useIntentSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: ['payments', 'summary', from ?? '', to ?? ''],
    queryFn: () => {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const qs = p.toString();
      return api<IntentSummaryRow[]>(`/v1/admin/payments/intents/summary${qs ? `?${qs}` : ''}`);
    },
    placeholderData: (prev) => prev,
  });
}

/** Card money owed per driver (card fares minus payouts), most owed first. */
export function usePayouts() {
  return useQuery({
    queryKey: ['payouts'],
    queryFn: () => api<DriverPayout[]>('/v1/admin/drivers/payouts'),
  });
}

/** Reason codes drivers send (declines, cancels, releases) with their Uzbek labels. */
export function useReasons() {
  return useQuery({
    queryKey: ['reasons'],
    queryFn: () => api<ReasonLabels>('/v1/admin/reasons'),
    staleTime: 60 * 60_000,
  });
}

export function useRefunds() {
  return useQuery({
    queryKey: ['refunds'],
    queryFn: () => api<Refund[]>('/v1/admin/payments/refunds'),
    refetchInterval: 60_000,
  });
}

// Intercity ---------------------------------------------------------------------------------

export function useIntercityPoints() {
  return useQuery({
    queryKey: ['intercity', 'points'],
    queryFn: () => api<IntercityPoint[]>('/v1/intercity/points'),
    staleTime: 10 * 60_000,
  });
}

export interface TripFilters {
  status?: TripStatus | '';
  date?: string;
  from?: string;
  to?: string;
}

export function useTrips(f: TripFilters) {
  return useQuery({
    queryKey: ['intercity', 'trips', f],
    queryFn: () => {
      const p = new URLSearchParams();
      if (f.status) p.set('status', f.status);
      if (f.date) p.set('date', f.date);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      const qs = p.toString();
      return api<AdminTrip[]>(`/v1/admin/intercity/trips${qs ? `?${qs}` : ''}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useTrip(id: string | null | undefined) {
  return useQuery({
    queryKey: ['intercity', 'trip', id],
    queryFn: () => api<AdminTrip>(`/v1/admin/intercity/trips/${id}`),
    enabled: Boolean(id),
  });
}

export function useRoutePrices() {
  return useQuery({
    queryKey: ['intercity', 'fares'],
    queryFn: () => api<RoutePrice[]>('/v1/admin/intercity/fares'),
  });
}

// Support -------------------------------------------------------------------------------------

export interface ComplaintFilters {
  status: 'unresolved' | 'open' | 'in_progress' | 'resolved';
  type?: string;
  driverId?: string;
}

export function useComplaints(f: ComplaintFilters, intervalMs?: number) {
  return useInfiniteQuery({
    queryKey: ['complaints', f],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ status: f.status });
      if (f.type) p.set('type', f.type);
      if (f.driverId) p.set('driverId', f.driverId);
      if (pageParam) p.set('cursor', pageParam);
      return api<Paged<ComplaintItem>>(`/v1/admin/complaints?${p}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
    refetchInterval: intervalMs,
  });
}

export function useComplaint(id: string | null) {
  return useQuery({
    queryKey: ['complaint', id],
    queryFn: () => api<Complaint>(`/v1/admin/complaints/${id}`),
    enabled: Boolean(id),
  });
}

export interface RatingFilters {
  of: 'driver' | 'rider' | '';
  maxStars: number | null;
  subjectId?: string;
}

export function useRatings(f: RatingFilters) {
  return useInfiniteQuery({
    queryKey: ['ratings', f],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (f.of) p.set('of', f.of);
      if (f.maxStars) p.set('maxStars', String(f.maxStars));
      if (f.subjectId) p.set('subjectId', f.subjectId);
      if (pageParam) p.set('cursor', pageParam);
      const qs = p.toString();
      return api<Paged<Rating>>(`/v1/admin/ratings${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
}

// Operations ----------------------------------------------------------------------------------

export const RECEIPTS_PAGE = 100;

export function useReceipts(status: FiscalReceipt['status'] | '') {
  return useInfiniteQuery({
    queryKey: ['fiscal', 'receipts', status],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (pageParam) p.set('cursor', pageParam);
      const qs = p.toString();
      return api<FiscalReceipt[]>(`/v1/admin/fiscal/receipts${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => nextCursorOf(last, RECEIPTS_PAGE),
    placeholderData: (prev) => prev,
  });
}

export function useReceipt(id: string | null) {
  return useQuery({
    queryKey: ['fiscal', 'receipt', id],
    queryFn: () => api<FiscalReceipt>(`/v1/admin/fiscal/receipts/${id}`),
    enabled: Boolean(id),
  });
}

export const OUTBOX_PAGE = 100;

export function useOutbox(state: 'dead' | 'failing', intervalMs?: number) {
  return useInfiniteQuery({
    queryKey: ['outbox', state],
    queryFn: ({ pageParam }) =>
      api<OutboxEvent[]>(
        `/v1/admin/outbox?state=${state}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => nextCursorOf(last, OUTBOX_PAGE),
    refetchInterval: intervalMs,
  });
}
