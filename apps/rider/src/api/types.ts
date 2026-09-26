/**
 * Shapes of the SFF Taxi API as the rider app uses them. The source of truth is
 * apps/api/src/modules/** (rides.service.ts riderView/baseView, geo, safety, realtime).
 * Money is whole so'm; times are ISO 8601 UTC strings.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

// Accounts ----------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface CodeRequested {
  resendAfterSeconds: number;
}

export interface Me {
  id: string;
  phone: string;
  fullName: string | null;
  isAdmin: boolean;
  driver: { status: string; statusReason: string | null; isOnline: boolean } | null;
}

export interface PushDeviceInput {
  token: string;
  app: 'rider';
  platform: 'ios' | 'android';
  locale: 'uz' | 'ru';
}

// Geo ---------------------------------------------------------------------------------

export interface GeoCity {
  id: string;
  slug: string;
  name: string;
  nameUz: string;
  nameRu: string;
  center: LatLng;
  isActive: boolean;
  upcoming: boolean;
}

export interface GeoConfig {
  provider: 'yandex' | 'osm';
  osm: { tileUrl: string; attribution: string; maxZoom: number };
  geocoder: string;
  defaultCenter: LatLng | null;
  defaultZoom: number;
  /** Rings of [lng, lat]; the first is the outline, the rest holes. */
  cities: (GeoCity & { boundary: [number, number][][] })[];
}

export interface GeoAddress {
  title: string;
  subtitle: string | null;
  street: string | null;
  house: string | null;
  district: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  kind: string | null;
}

export interface GeoSuggestion extends GeoAddress {
  cityId: string | null;
  serviceable: boolean;
}

export interface GeoReverse {
  address: GeoAddress | null;
  city: GeoCity | null;
  serviceable: boolean;
}

export type GeoResolve =
  | { status: 'inside' | 'upcoming'; city: GeoCity; nearest: null }
  | {
      status: 'outside';
      city: null;
      nearest: { city: GeoCity; distanceM: number } | null;
      nearestActive: { city: GeoCity; distanceM: number } | null;
    };

// Tariffs and quotes -------------------------------------------------------------------

export type RideClass = 'economy' | 'comfort';
export type RideOption = 'child_seat' | 'luggage' | 'pets' | 'ac';
export type RideKind = 'city' | 'intercity';
export type PaymentMethod = 'cash' | 'card';

export interface WaitingRule {
  free_minutes: number;
  per_minute: number;
}

export interface TariffInfo {
  serviceable: boolean;
  cityId: string | null;
  city: string | null;
  tariff: {
    waiting: WaitingRule;
    options: Record<RideOption, number>;
    cancellation_fee: number;
    night: { percent: number; from: string; to: string };
    seats: { share_percent: number; front_extra_percent: number };
    intercity_from_km: number;
  } | null;
  paymentMethods: PaymentMethod[];
}

export interface Fare {
  kind: RideKind;
  rideClass: RideClass;
  distanceM: number;
  insideM: number;
  outsideM: number;
  base: number;
  /** Of `base`: the suburb (outside the city polygon) part. */
  outside: number;
  night: number;
  options: Partial<Record<RideOption, number>>;
  total: number;
  seat: { rear: number; front: number } | null;
}

export interface Quote {
  quoteId: string;
  expiresAt: string;
  city: GeoCity;
  kind: RideKind;
  distanceM: number;
  durationS: number | null;
  routeSource: string;
  options: RideOption[];
  fares: Record<RideClass, Fare>;
  paymentMethods: PaymentMethod[];
  waiting: WaitingRule;
  cancellationFee: number;
}

// Rides -------------------------------------------------------------------------------

export type RideStatus =
  'searching' | 'driver_assigned' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled';

export type RideActor = 'rider' | 'driver' | 'operator' | 'system';

export interface RidePlace extends LatLng {
  address: string | null;
  landmark: string | null;
}

export interface RideVehicle {
  make: string;
  model: string;
  colour: string;
  plate: string;
  plateFormatted: string;
  class: RideClass;
}

export interface RideDriver {
  id: string;
  name: string;
  phone: string;
  rating: number;
  ridesCompleted: number;
  location: { lat: number; lng: number; heading: number | null; at: string | null } | null;
}

export interface RideEvent {
  id: string;
  type: string;
  actor: RideActor;
  data: Record<string, unknown>;
  at: string;
}

/** A ride in lists (history): no driver card, no events. */
export interface RideSummary {
  id: string;
  number: number;
  status: RideStatus;
  channel: 'app' | 'phone';
  kind: RideKind;
  class: RideClass;
  cityId: string;
  pickup: RidePlace;
  dropoff: RidePlace;
  options: RideOption[];
  comment: string | null;
  distanceM: number;
  durationS: number | null;
  fare: {
    quoted: number;
    waiting: number;
    total: number | null;
    cancellationFee: number;
    breakdown: Fare;
  };
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  vehicle: RideVehicle | null;
  cancelledBy: RideActor | null;
  cancelReason: string | null;
  requestedAt: string;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** The rider's full view of one ride (GET /rides/:id). */
export interface Ride extends RideSummary {
  driver: RideDriver | null;
  canCancel: boolean;
  cancelFeeNow: number;
  events: RideEvent[];
}

export interface RideHistoryPage {
  items: RideSummary[];
  nextCursor: string | null;
}

export interface OrderInput {
  quoteId: string;
  class: RideClass;
  paymentMethod: PaymentMethod;
  pickup: { address: string | null; landmark: string | null };
  dropoff: { address: string | null; landmark: string | null };
  comment: string | null;
  clientRequestId: string;
}

export interface ShareLink {
  token: string;
  url: string;
}

export interface SosResult {
  id: string;
  emergency: { unified: string; police: string; ambulance: string; fire: string };
}

export interface RatingInput {
  stars: number;
  tags: string[];
  comment: string | null;
}

// Realtime ----------------------------------------------------------------------------

export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'ping' }
  | { type: 'ride.updated'; rideId: string; status: string }
  | {
      type: 'driver.location';
      rideId: string;
      lat: number;
      lng: number;
      heading: number | null;
      at: string;
    };
