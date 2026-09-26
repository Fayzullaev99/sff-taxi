import type { TokenPair } from '../lib/api-client';
import type { ApplicationBody } from '../lib/application';
import type { LocationPayload } from '../lib/location-throttle';
import type { CancelReason } from '../lib/ride-flow';
import { api } from './client';
import type {
  Account,
  Balance,
  CodeSent,
  DriverMe,
  DriverRide,
  Earnings,
  LedgerEntry,
  Offer,
  Page,
  Pass,
  PublishedTariff,
} from './types';

export const auth = {
  requestCode: (phone: string) => api.post<CodeSent>('/v1/auth/code', { phone }, { auth: false }),
  verify: (phone: string, code: string) =>
    api.post<TokenPair & { isNewUser: boolean }>(
      '/v1/auth/verify',
      { phone, code, client: 'driver' },
      { auth: false },
    ),
  account: () => api.get<Account>('/v1/me'),
};

export const driver = {
  /** 404 until the account has applied. */
  me: () => api.get<DriverMe>('/v1/driver/me'),
  apply: (body: ApplicationBody) => api.post<DriverMe>('/v1/driver/application', body),
  setDocument: (kind: string, url: string, expiresOn: string | null) =>
    api.request<DriverMe>('PUT', `/v1/driver/documents/${kind}`, { body: { url, expiresOn } }),
  /** 403 with `{balance, minBalance}` when the balance is below the minimum. */
  shift: (online: boolean) => api.post<DriverMe>('/v1/driver/shift', { online }),
  /** 422 `{reason}` when the API refuses the fix (see lib/gps-quality). */
  location: (payload: LocationPayload) => api.post<void>('/v1/driver/location', payload),

  offers: () => api.get<Offer[]>('/v1/driver/offers'),
  accept: (offerId: string) => api.post<DriverRide>(`/v1/driver/offers/${offerId}/accept`),
  /**
   * The API ignores the body today; the optional reason is sent so it is kept once the
   * API stores it (see README "API gaps").
   */
  decline: (offerId: string, reason: string | null) =>
    api.post<void>(`/v1/driver/offers/${offerId}/decline`, reason ? { reason } : undefined),

  currentRide: () => api.get<{ ride: DriverRide | null }>('/v1/driver/rides/current'),
  ride: (id: string) => api.get<DriverRide>(`/v1/driver/rides/${id}`),
  rides: (cursor?: string) =>
    api.get<Page<DriverRide>>(`/v1/driver/rides${cursor ? `?cursor=${cursor}` : ''}`),
  step: (id: string, action: 'arrive' | 'start' | 'complete') =>
    api.post<DriverRide>(`/v1/driver/rides/${id}/${action}`),
  cancel: (id: string, reasonCode: CancelReason, note: string | null) =>
    api.post<void>(`/v1/driver/rides/${id}/cancel`, { reasonCode, note }),
  rateRider: (id: string, stars: number, tags: string[], comment: string | null) =>
    api.post<unknown>(`/v1/driver/rides/${id}/rating`, { stars, tags, comment }),
  sos: (id: string, lat: number | null, lng: number | null) =>
    api.post<{ id: string; emergency: Record<string, string> }>(`/v1/driver/rides/${id}/sos`, {
      lat,
      lng,
      note: null,
    }),

  balance: () => api.get<Balance>('/v1/driver/balance'),
  ledger: (cursor?: string) =>
    api.get<Page<LedgerEntry>>(`/v1/driver/ledger${cursor ? `?cursor=${cursor}` : ''}`),
  earnings: (period: 'day' | 'week') => api.get<Earnings>(`/v1/driver/earnings?period=${period}`),
  passes: () => api.get<Pass[]>('/v1/driver/passes'),
  buyPass: (kind: 'day' | 'week') =>
    api.post<Pass & { balance: number }>('/v1/driver/passes', { kind }),

  tariff: (lat: number, lng: number) =>
    api.get<PublishedTariff>(`/v1/tariffs?lat=${lat}&lng=${lng}`, { auth: false }),
};

export const devices = {
  register: (body: { token: string; app: 'driver'; platform: 'ios' | 'android'; locale: 'uz' }) =>
    api.request<unknown>('PUT', '/v1/devices', { body }),
  unregister: (token: string) => api.delete<void>(`/v1/devices/${encodeURIComponent(token)}`),
};

export const stream = {
  ticket: () => api.post<{ ticket: string; expiresInSeconds: number }>('/v1/stream/ticket'),
};
