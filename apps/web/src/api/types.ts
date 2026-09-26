/** Shapes returned by the SFF Taxi API (apps/api/src/modules/**: the source of truth). */

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON order: [lng, lat]. The first ring is the outline, further ones are holes. */
export type PolygonRings = [number, number][][];

export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Accounts ------------------------------------------------------------------------------

export interface Me {
  id: string;
  phone: string;
  fullName: string | null;
  isAdmin: boolean;
  driver: { status: DriverStatus; statusReason: string | null; isOnline: boolean } | null;
}

export interface CodeSent {
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface VerifyResult {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  isNewUser?: boolean;
}

// Geography ------------------------------------------------------------------------------

export interface PublicCity {
  id: string;
  slug: string;
  name: string;
  nameUz: string;
  nameRu: string;
  center: LatLng;
  bbox: BBox;
  isActive: boolean;
  upcoming: boolean;
}

export interface GeoConfig {
  provider: 'yandex' | 'osm';
  yandex: { apiKey: string; lang: string } | null;
  osm: { tileUrl: string; attribution: string; maxZoom: number };
  geocoder: string;
  defaultCenter: LatLng | null;
  defaultZoom: number;
  cities: (PublicCity & { boundary: PolygonRings })[];
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
  cityId?: string | null;
  serviceable?: boolean;
}

export interface ReverseResult {
  address: GeoAddress | null;
  city: PublicCity | null;
  serviceable: boolean;
}

/** GET /admin/geo/cities */
export interface AdminCity {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  center: LatLng;
  boundary: PolygonRings;
  bbox: BBox;
  timezone: string;
  isActive: boolean;
  sort: number;
  /** The city's own tariff; null = the global one. */
  tariff: Tariff | null;
}

// Tariffs and settings ---------------------------------------------------------------------

export const RIDE_CLASSES = ['economy', 'comfort'] as const;
export type RideClass = (typeof RIDE_CLASSES)[number];
export const RIDE_OPTIONS = ['child_seat', 'luggage', 'pets', 'ac'] as const;
export type RideOption = (typeof RIDE_OPTIONS)[number];
export type RideKind = 'city' | 'intercity';

export interface Band {
  up_to_m: number;
  price: number;
}

export interface ClassTariff {
  bands: Band[];
  beyond_per_km: number;
  outside_per_km: number;
  intercity_per_km: number;
  intercity_min: number;
}

export interface Tariff {
  classes: Record<RideClass, ClassTariff>;
  night: { percent: number; from: string; to: string };
  waiting: { free_minutes: number; per_minute: number };
  options: Record<RideOption, number>;
  seats: { share_percent: number; front_extra_percent: number };
  intercity_from_km: number;
  service_radius_km: number;
  cancellation_fee: number;
}

export interface DispatchRules {
  offer_timeout_seconds: number;
  direct_offers: number;
  search_radius_m: number;
  candidates: number;
  broadcast_radius_m: number;
  broadcast_timeout_seconds: number;
  search_timeout_seconds: number;
  location_max_age_seconds: number;
  tie_window_seconds: number;
  no_show_after_minutes: number;
}

export interface BillingRules {
  promo_until: string | null;
  commission_percent: number;
  daily_cap: number;
  weekly_cap: number;
  intercity_commission_percent: number;
  intercity_trip_cap: number;
  tax_percent: number;
  pass_day_price: number;
  pass_week_price: number;
  min_balance: number;
}

// Rides ------------------------------------------------------------------------------------

export const RIDE_STATUSES = [
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];
export type RideActor = 'rider' | 'driver' | 'operator' | 'system';
export type DispatchStage = 'direct' | 'broadcast' | 'operator';

export interface Fare {
  kind: RideKind;
  rideClass: RideClass;
  distanceM: number;
  insideM: number;
  outsideM: number;
  base: number;
  outside: number;
  night: number;
  options: Partial<Record<RideOption, number>>;
  total: number;
  seat: { rear: number; front: number } | null;
}

export interface Quote {
  quoteId: string;
  expiresAt: string;
  city: PublicCity;
  kind: RideKind;
  distanceM: number;
  durationS: number | null;
  routeSource: string;
  options: RideOption[];
  fares: Record<RideClass, Fare>;
  paymentMethods: string[];
  waiting: Tariff['waiting'];
  cancellationFee: number;
}

export interface Place extends LatLng {
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

/** RidesService.baseView */
export interface RideBase {
  id: string;
  number: number;
  status: RideStatus;
  channel: 'app' | 'phone';
  kind: RideKind;
  class: RideClass;
  cityId: string;
  pickup: Place;
  dropoff: Place;
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
  paymentMethod: 'cash' | 'card';
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

/** GET /admin/rides items (also the rides of /admin/dispatch/live). */
export interface AdminRideItem extends RideBase {
  riderPhone: string;
  riderName: string | null;
  driverId: string | null;
  dispatchStage: DispatchStage;
  attentionAt: string | null;
}

export interface RideOffer {
  id: string;
  driverId: string;
  driverName: string;
  kind: 'direct' | 'broadcast';
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  etaS: number | null;
  distanceM: number | null;
  score: number | null;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface RideEvent {
  id: string;
  type: string;
  actor: RideActor;
  data: Record<string, unknown> | null;
  at: string;
}

export interface DriverCard {
  id: string;
  name: string;
  phone: string;
  rating: number;
  ridesCompleted: number;
  location: { lat: number; lng: number; heading: number | null; at: string | null } | null;
}

export interface RideEarnings {
  fare: number | null;
  commission: number;
  commissionNote: string | null;
  tax: number;
  net: number;
}

/** GET /admin/rides/:id */
export interface AdminRide extends RideBase {
  rider: { id: string; name: string | null; phone: string; rating: number; noShows: number };
  driver: DriverCard | null;
  createdBy: string | null;
  dispatch: {
    stage: DispatchStage;
    directOffers: number;
    broadcastAt: string | null;
    attentionAt: string | null;
  };
  earnings: RideEarnings | null;
  offers: RideOffer[];
  events: RideEvent[];
}

/** GET /admin/dispatch/rides/:id/candidates */
export interface Candidate {
  driverId: string;
  name: string;
  position: LatLng;
  straightM: number;
  etaS: number;
  distanceM: number;
  score: number;
}

export type LiveDriverState = 'free' | 'offered' | 'busy';

export interface LiveDriver {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  locatedAt: string | null;
  onlineSince: string | null;
  plate: string;
  class: RideClass;
  rideId: string | null;
  rideStatus: RideStatus | null;
  offeredRideId: string | null;
  state: LiveDriverState;
}

/** GET /admin/dispatch/live */
export interface LiveBoard {
  drivers: LiveDriver[];
  rides: AdminRideItem[];
}

// Drivers ----------------------------------------------------------------------------------

export const DRIVER_STATUSES = ['pending', 'active', 'rejected', 'blocked'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];
export const VEHICLE_FEATURES = ['ac', 'child_seat', 'pets', 'big_trunk'] as const;
export type VehicleFeature = (typeof VEHICLE_FEATURES)[number];
export const DOCUMENT_KINDS = [
  'licence_card',
  'driver_licence',
  'passport',
  'vehicle_registration',
  'insurance',
  'vehicle_photo',
  'selfie',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DriverDecision = 'approve' | 'reject' | 'block' | 'unblock';

/** GET /admin/drivers items */
export interface DriverListItem {
  id: string;
  fullName: string;
  phone: string;
  status: DriverStatus;
  statusReason: string | null;
  isOnline: boolean;
  createdAt: string;
  plate: string | null;
  plateFormatted: string | null;
  make: string | null;
  model: string | null;
  class: RideClass | null;
}

export interface Priority {
  score: number;
  acceptance: number;
  reliability: number;
  rating: number;
  stars: number;
}

export interface Vehicle {
  make: string;
  model: string;
  colour: string;
  plate: string;
  plateFormatted: string;
  year: number;
  seats: number;
  class: RideClass;
  features: VehicleFeature[];
}

export interface DriverDocument {
  kind: DocumentKind;
  url: string;
  expiresOn: string | null;
  uploadedAt: string;
}

/** GET /admin/drivers/:id */
export interface AdminDriver {
  id: string;
  fullName: string;
  phone: string | null;
  birthDate: string;
  pinfl: string;
  licence: { number: string; categories: string[]; issuedOn: string };
  licenceCard: { number: string; expiresOn: string };
  status: DriverStatus;
  statusReason: string | null;
  approvedAt: string | null;
  isOnline: boolean;
  onlineSince: string | null;
  location: { lat: number; lng: number; heading: number | null; at: string | null } | null;
  vehicle: Vehicle | null;
  documents: DriverDocument[];
  missingDocuments: DocumentKind[];
  priority: Priority;
  stats: {
    offersReceived: number;
    offersAccepted: number;
    ridesCompleted: number;
    ridesCancelled: number;
    ratingCount: number;
  };
  createdAt: string;
  history: {
    from: string;
    to: string;
    reason: string | null;
    actorId: string | null;
    at: string;
  }[];
  balance: number;
}

// Money ------------------------------------------------------------------------------------

export type LedgerKind = 'topup' | 'commission' | 'tax' | 'pass' | 'adjustment';

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount: number;
  rideId: string | null;
  note: string | null;
  createdAt: string;
}

export interface LedgerPage {
  items: LedgerEntry[];
  nextCursor: string | null;
}

export interface Standing {
  balance: number;
  minBalance: number;
  canWork: boolean;
}

export interface TaxReport {
  period: string;
  drivers: {
    driverId: string;
    fullName: string;
    pinfl: string;
    rides: number;
    base: number;
    amount: number;
    remitted: boolean;
  }[];
  totals: { rides: number; base: number; amount: number };
}

// Safety -----------------------------------------------------------------------------------

export interface SosEvent {
  id: string;
  rideId: string;
  rideNumber: number;
  rideStatus: RideStatus;
  driverId: string | null;
  role: 'rider' | 'driver';
  phone: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}
