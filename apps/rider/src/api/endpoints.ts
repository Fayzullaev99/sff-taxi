import { api, setSession } from './session';
import type {
  CodeRequested,
  GeoConfig,
  GeoResolve,
  GeoReverse,
  GeoSuggestion,
  LatLng,
  Me,
  OrderInput,
  PushDeviceInput,
  Quote,
  RatingInput,
  Ride,
  RideHistoryPage,
  RideOption,
  ShareLink,
  SosResult,
  TariffInfo,
  TokenPair,
} from './types';

const id = (value: string) => encodeURIComponent(value);

export const endpoints = {
  // Sign-in
  requestCode: (phone: string) =>
    api.request<CodeRequested>('/v1/auth/code', { method: 'POST', auth: 'none', body: { phone } }),
  async verifyCode(phone: string, code: string): Promise<{ isNewUser: boolean }> {
    const res = await api.request<TokenPair & { isNewUser: boolean }>('/v1/auth/verify', {
      method: 'POST',
      auth: 'none',
      body: { phone, code, client: 'rider' },
    });
    setSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    return { isNewUser: res.isNewUser };
  },
  me: () => api.request<Me>('/v1/me'),
  updateMe: (fullName: string) =>
    api.request<Me>('/v1/me', { method: 'PATCH', body: { fullName } }),

  // Map (public)
  geoConfig: () => api.request<GeoConfig>('/v1/geo/config', { auth: 'none' }),
  geoResolve: (p: LatLng) =>
    api.request<GeoResolve>('/v1/geo/resolve', { auth: 'none', query: { lat: p.lat, lng: p.lng } }),
  geoReverse: (p: LatLng) =>
    api.request<GeoReverse>('/v1/geo/reverse', {
      auth: 'none',
      query: { lat: p.lat, lng: p.lng, lang: 'uz' },
    }),
  geoSearch: (q: string, near: LatLng | null, signal?: AbortSignal) =>
    api.request<GeoSuggestion[]>('/v1/geo/search', {
      auth: 'none',
      query: { q, lat: near?.lat, lng: near?.lng, lang: 'uz' },
      signal,
    }),
  tariff: (p: LatLng) =>
    api.request<TariffInfo>('/v1/tariffs', { auth: 'none', query: { lat: p.lat, lng: p.lng } }),

  // Rides
  quote: (pickup: LatLng, dropoff: LatLng, options: RideOption[]) =>
    api.request<Quote>('/v1/rides/quote', {
      method: 'POST',
      body: {
        pickup: { lat: pickup.lat, lng: pickup.lng },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        options,
      },
    }),
  order: (input: OrderInput) =>
    api.requestWithStatus<Ride>('/v1/rides', { method: 'POST', body: input }),
  currentRide: () => api.request<{ ride: Ride | null }>('/v1/rides/current'),
  ride: (rideId: string) => api.request<Ride>(`/v1/rides/${id(rideId)}`),
  history: (cursor?: string) => api.request<RideHistoryPage>('/v1/rides', { query: { cursor } }),
  cancel: (rideId: string, reason: string | null) =>
    api.request<Ride>(`/v1/rides/${id(rideId)}/cancel`, { method: 'POST', body: { reason } }),
  share: (rideId: string) =>
    api.request<ShareLink>(`/v1/rides/${id(rideId)}/share`, { method: 'POST', body: {} }),
  rate: (rideId: string, input: RatingInput) =>
    api.request<{ rideId: string; stars: number }>(`/v1/rides/${id(rideId)}/rating`, {
      method: 'POST',
      body: input,
    }),
  sos: (rideId: string, body: { lat: number | null; lng: number | null; note: string | null }) =>
    api.request<SosResult>(`/v1/rides/${id(rideId)}/sos`, { method: 'POST', body }),

  // Realtime and push
  streamTicket: () =>
    api.request<{ ticket: string; expiresInSeconds: number }>('/v1/stream/ticket', {
      method: 'POST',
      body: {},
    }),
  registerPush: (input: PushDeviceInput) =>
    api.request<void>('/v1/devices', { method: 'PUT', body: input }),
  unregisterPush: (token: string) =>
    api.request<void>(`/v1/devices/${id(token)}`, { method: 'DELETE' }),

  /** Root health check (no /v1): used to notice the connection is back. */
  health: () => api.request<unknown>('/health', { auth: 'none' }),
};
