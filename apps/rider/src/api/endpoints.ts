import { api, setSession } from './session';
import type {
  AppConfig,
  BookInput,
  CodeRequested,
  Complaint,
  ComplaintListItem,
  ComplaintType,
  Gender,
  GeoConfig,
  GeoResolve,
  GeoReverse,
  GeoSuggestion,
  IntercityBooking,
  IntercityPoint,
  IntercityTrip,
  LatLng,
  Me,
  OrderInput,
  Page,
  PlaceInput,
  PushDeviceInput,
  Quote,
  RatingInput,
  RecentPlace,
  Ride,
  RideHistoryPage,
  RideOption,
  RideSummary,
  RouteFare,
  SavedPlace,
  ShareLink,
  SosResult,
  TariffInfo,
  TokenPair,
  CreatedUpload,
  UploadsConfig,
  UploadView,
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
  /** 409 when it was changed within the last 30 days (`genderLockedUntil`). */
  updateGender: (gender: Gender) =>
    api.request<Me>('/v1/me', { method: 'PATCH', body: { gender } }),

  // Map (public)
  geoConfig: () => api.request<GeoConfig>('/v1/geo/config', { auth: 'none' }),
  geoResolve: (p: LatLng) =>
    api.request<GeoResolve>('/v1/geo/resolve', { auth: 'none', query: { lat: p.lat, lng: p.lng } }),
  geoReverse: (p: LatLng) =>
    api.request<GeoReverse>('/v1/geo/reverse', {
      auth: 'none',
      query: { lat: p.lat, lng: p.lng, lang: 'uz' },
      // the rider looks at "Manzil aniqlanmoqda…": short, once more on a flaky link
      timeoutMs: 8_000,
      retries: 1,
    }),
  geoSearch: (q: string, near: LatLng | null, signal?: AbortSignal) =>
    api.request<GeoSuggestion[]>('/v1/geo/search', {
      auth: 'none',
      query: { q, lat: near?.lat, lng: near?.lng, lang: 'uz' },
      signal,
      timeoutMs: 8_000,
    }),
  /** Fixed prices between towns (public): the map's route chips. */
  routes: () => api.request<RouteFare[]>('/v1/routes', { auth: 'none' }),
  tariff: (p: LatLng) =>
    api.request<TariffInfo>('/v1/tariffs', { auth: 'none', query: { lat: p.lat, lng: p.lng } }),

  // Rides
  quote: (
    pickup: LatLng,
    dropoff: LatLng,
    options: RideOption[],
    scheduledFor: string | null = null,
  ) =>
    api.request<Quote>('/v1/rides/quote', {
      method: 'POST',
      body: {
        pickup: { lat: pickup.lat, lng: pickup.lng },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        options,
        scheduledFor,
      },
    }),
  scheduledRides: () => api.request<RideSummary[]>('/v1/rides/scheduled'),
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

  // Configuration (public): support contacts, minimum app version, features
  config: () => api.request<AppConfig>('/v1/config', { auth: 'none' }),

  // Saved places and recent destinations
  places: () => api.request<SavedPlace[]>('/v1/places'),
  recentPlaces: () => api.request<RecentPlace[]>('/v1/places/recent'),
  createPlace: (input: PlaceInput) =>
    api.request<SavedPlace>('/v1/places', { method: 'POST', body: input }),
  deletePlace: (placeId: string) =>
    api.request<void>(`/v1/places/${id(placeId)}`, { method: 'DELETE' }),
  /** Hides a recent destination (the ride history stays; a new ride there brings it back). */
  hideRecentPlace: (key: string) =>
    api.request<void>('/v1/places/recent/hide', { method: 'POST', body: { key } }),
  /** Shows every hidden recent destination again. */
  unhideRecentPlaces: () => api.request<void>('/v1/places/recent/hidden', { method: 'DELETE' }),

  // Complaints (support tickets), lost items included
  // with photos: uploads (purpose complaint_photo) made ready first, up to 3 per complaint
  complain: (rideId: string, type: ComplaintType, text: string, photoUploadIds: string[] = []) =>
    api.request<Complaint>(`/v1/rides/${id(rideId)}/complaints`, {
      method: 'POST',
      body: photoUploadIds.length ? { type, text, photoUploadIds } : { type, text },
    }),
  complaints: (cursor?: string) =>
    api.request<Page<ComplaintListItem>>('/v1/complaints', { query: { cursor } }),
  complaint: (complaintId: string) => api.request<Complaint>(`/v1/complaints/${id(complaintId)}`),
  replyComplaint: (complaintId: string, text: string, photoUploadIds: string[] = []) =>
    api.request<Complaint>(`/v1/complaints/${id(complaintId)}/messages`, {
      method: 'POST',
      body: photoUploadIds.length ? { text, photoUploadIds } : { text },
    }),

  // Uploads (private bucket): register, PUT the bytes to the presigned URL, complete
  uploadsConfig: () => api.request<UploadsConfig>('/v1/uploads/config'),
  createUpload: (input: { purpose: 'complaint_photo'; contentType: string; sizeBytes: number }) =>
    api.request<CreatedUpload>('/v1/uploads', { method: 'POST', body: input }),
  completeUpload: (uploadId: string) =>
    api.request<UploadView>(`/v1/uploads/${id(uploadId)}/complete`, { method: 'POST', body: {} }),

  // Intercity trip board
  intercityPoints: () => api.request<IntercityPoint[]>('/v1/intercity/points'),
  intercityTrips: (q: { from: string; to: string; date: string; seats: number }) =>
    api.request<IntercityTrip[]>('/v1/intercity/trips', { query: q }),
  intercityTrip: (tripId: string) =>
    api.request<IntercityTrip>(`/v1/intercity/trips/${id(tripId)}`),
  book: (tripId: string, input: BookInput) =>
    api.requestWithStatus<IntercityBooking>(`/v1/intercity/trips/${id(tripId)}/bookings`, {
      method: 'POST',
      body: input,
    }),
  bookings: (cursor?: string) =>
    api.request<Page<IntercityBooking>>('/v1/intercity/bookings', { query: { cursor } }),
  booking: (bookingId: string) =>
    api.request<IntercityBooking>(`/v1/intercity/bookings/${id(bookingId)}`),
  cancelBooking: (bookingId: string, reason: string | null) =>
    api.request<IntercityBooking>(`/v1/intercity/bookings/${id(bookingId)}/cancel`, {
      method: 'POST',
      body: { reason },
    }),

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
  health: () => api.request<unknown>('/health', { auth: 'none', timeoutMs: 5_000 }),
};
