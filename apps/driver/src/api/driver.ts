import type { TokenPair } from '../lib/api-client';
import type { ApplicationBody } from '../lib/application';
import type { TripEditBody } from '../lib/intercity';
import type { LocationPayload } from '../lib/location-throttle';
import type { CancelReason } from '../lib/ride-flow';
import type { CreatedUpload, UploadContentType, UploadPurpose } from '../lib/upload-flow';
import { api } from './client';
import type {
  Account,
  Appeal,
  Balance,
  CodeSent,
  DriverMe,
  DriverRide,
  DriverTrip,
  Earnings,
  IntercityFare,
  IntercityPoint,
  LedgerEntry,
  Offer,
  Page,
  Pass,
  PublishedTariff,
  PublishTripBody,
  Topup,
  UploadView,
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
  /** A ready upload (purpose document) as one of the required documents. */
  setDocument: (kind: string, uploadId: string, expiresOn: string | null) =>
    api.request<DriverMe>('PUT', `/v1/driver/documents/${kind}`, {
      body: { uploadId, expiresOn },
    }),
  /** The face riders see (an upload with purpose profile_photo). */
  setPhoto: (uploadId: string) =>
    api.request<DriverMe>('PUT', '/v1/driver/photo', { body: { uploadId } }),
  /** The car riders see (an upload with purpose vehicle_photo). */
  setVehiclePhoto: (uploadId: string) =>
    api.request<DriverMe>('PUT', '/v1/driver/vehicle/photo', { body: { uploadId } }),
  /** Commission, caps, passes, minimum balance, waiting/no-show rules, reasons, support. */
  config: () => api.get<unknown>('/v1/driver/config'),
  appeals: () => api.get<Appeal[]>('/v1/driver/appeals'),
  /** 409 while another appeal is open or when the account is not rejected/blocked. */
  appeal: (text: string) => api.post<Appeal>('/v1/driver/appeals', { text }),
  /** 403 with `{balance, minBalance}` when the balance is below the minimum. */
  shift: (online: boolean) => api.post<DriverMe>('/v1/driver/shift', { online }),
  /** 422 `{reason}` when the API refuses the fix (see lib/gps-quality). */
  location: (payload: LocationPayload) => api.post<void>('/v1/driver/location', payload),

  offers: () => api.get<Offer[]>('/v1/driver/offers'),
  accept: (offerId: string) => api.post<DriverRide>(`/v1/driver/offers/${offerId}/accept`),
  /** The optional reason (a code of `declineReasons`) is kept with the offer for operators. */
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
  /** A card top-up: open one of `checkout`; the balance grows once the provider confirms. */
  topup: (amount: number) => api.post<Topup>('/v1/driver/topups', { amount }),
  topups: () => api.get<Topup[]>('/v1/driver/topups'),
  topupStatus: (id: string) => api.get<Topup>(`/v1/driver/topups/${id}`),

  tariff: (lat: number, lng: number) =>
    api.get<PublishedTariff>(`/v1/tariffs?lat=${lat}&lng=${lng}`, { auth: false }),
};

/** Support, minimum app versions, feature flags (public: read before sign-in too). */
export const appConfig = {
  get: () => api.get<unknown>('/v1/config', { auth: false }),
};

export const uploads = {
  config: () => api.get<unknown>('/v1/uploads/config'),
  create: (body: { purpose: UploadPurpose; contentType: UploadContentType; sizeBytes: number }) =>
    api.post<CreatedUpload>('/v1/uploads', body),
  complete: (id: string) => api.post<UploadView>(`/v1/uploads/${id}/complete`),
};

export const intercity = {
  points: () => api.get<IntercityPoint[]>('/v1/intercity/points'),
  fare: (from: string, to: string, rideClass: 'economy' | 'comfort') =>
    api.get<IntercityFare>(
      `/v1/driver/intercity/fares?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&class=${rideClass}`,
    ),
  publish: (body: PublishTripBody) => api.post<DriverTrip>('/v1/driver/intercity/trips', body),
  /**
   * `upcoming`: not arrived or cancelled, soonest first, all at once (nextCursor null);
   * `all`: every trip, latest departure first, paged by cursor.
   */
  trips: (scope: 'upcoming' | 'all', cursor?: string) =>
    api.get<Page<DriverTrip>>(
      `/v1/driver/intercity/trips?scope=${scope}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  /** Time, seats, price, front seat, meeting point, comment: only before the first booking (409). */
  edit: (id: string, body: TripEditBody) =>
    api.patch<DriverTrip>(`/v1/driver/intercity/trips/${id}`, body),
  trip: (id: string) => api.get<DriverTrip>(`/v1/driver/intercity/trips/${id}`),
  step: (id: string, step: 'boarding' | 'depart' | 'arrive') =>
    api.post<DriverTrip>(`/v1/driver/intercity/trips/${id}/${step}`),
  board: (id: string, bookingId: string) =>
    api.post<DriverTrip>(`/v1/driver/intercity/trips/${id}/bookings/${bookingId}/board`),
  cancel: (id: string, reason: string) =>
    api.post<DriverTrip>(`/v1/driver/intercity/trips/${id}/cancel`, { reason }),
};

export const devices = {
  register: (body: { token: string; app: 'driver'; platform: 'ios' | 'android'; locale: 'uz' }) =>
    api.request<unknown>('PUT', '/v1/devices', { body }),
  unregister: (token: string) => api.delete<void>(`/v1/devices/${encodeURIComponent(token)}`),
};

export const stream = {
  ticket: () => api.post<{ ticket: string; expiresInSeconds: number }>('/v1/stream/ticket'),
};
