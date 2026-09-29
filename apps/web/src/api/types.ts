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
/** Cargo classes: cargo_s Damas/Labo (up to 800 kg payload), cargo_m Gazel/Porter (1.5 t). */
export const CARGO_CLASSES = ['cargo_s', 'cargo_m'] as const;
export type CargoClass = (typeof CARGO_CLASSES)[number];
/** Any ride's class: the taxi classes (taxi, delivery) and the cargo ones. */
export type AnyRideClass = RideClass | CargoClass;
export const RIDE_SERVICES = ['taxi', 'cargo', 'delivery'] as const;
export type RideService = (typeof RIDE_SERVICES)[number];
export const VEHICLE_BODIES = ['sedan', 'hatchback', 'minivan', 'van', 'pickup', 'truck'] as const;
export type VehicleBody = (typeof VEHICLE_BODIES)[number];
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

/** GET/PUT /admin/settings/pool: shared-ride rules (apps/api/src/lib/pool.ts PoolRules). */
export interface PoolRules {
  enabled: boolean;
  discount_percent: number;
  full_discount_share_percent: number;
  max_detour_seconds_city: number;
  max_detour_seconds_intercity: number;
  max_detour_percent: number;
  max_pickup_eta_seconds: number;
  search_radius_m: number;
  pool_preference_seconds: number;
  max_riders: number;
}

/** GET/PUT /admin/settings/booking: the card deposit of rides booked in advance. */
export interface BookingRules {
  deposit_percent: number;
  deposit_min: number;
  payment_minutes: number;
}

export interface CargoClassTariff {
  /** The order's price including the first included_km and included_minutes. */
  base: number;
  included_km: number;
  /** Free loading minutes after arrival (at most 30), then per_minute. */
  included_minutes: number;
  per_km: number;
  intercity_per_km: number;
  per_minute: number;
  max_payload_kg: number;
}

/** GET/PUT /admin/settings/cargo (apps/api/src/lib/cargo.ts CargoRules). */
export interface CargoRules {
  enabled: boolean;
  classes: Record<CargoClass, CargoClassTariff>;
  loader_price: number;
  max_loaders: number;
  night: { percent: number; from: string; to: string };
  intercity_from_km: number;
  delivery: { enabled: boolean; percent: number; max_weight_kg: number };
}

/** GET /admin/routes items: fixed route prices of rides between towns. */
export interface RouteFare {
  id: string;
  class: RideClass;
  /** One person in a shared car. */
  seatPrice: number | null;
  /** The whole car. */
  carPrice: number | null;
  isActive: boolean;
  updatedAt: string;
  from: { slug: string; name: string; lat: number; lng: number };
  to: { slug: string; name: string; lat: number; lng: number };
}

/** PUT /admin/routes */
export interface RouteFareBody {
  from: string;
  to: string;
  class: RideClass;
  seatPrice: number | null;
  carPrice: number | null;
  isActive: boolean;
  bothWays: boolean;
}

// Rides ------------------------------------------------------------------------------------

export const RIDE_STATUSES = [
  /** Ordered for later: dispatch starts 15 minutes before scheduledFor. */
  'scheduled',
  /** A card ride waiting for its prepayment before dispatch. */
  'awaiting_payment',
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
  /** Card providers a card payment can go through (Payme, Click). */
  cardProviders?: string[];
  waiting: Tariff['waiting'];
  cancellationFee: number;
  /** A quote for later: the phone order made with it is a ride for later (status scheduled). */
  scheduledFor?: string | null;
  /** Riders' quotes only (operators' quotes send null): see CustomerLookup.owedFee. */
  owedFee?: OwedFeeLine | null;
}

/**
 * Cancellation fees a rider still owes from cancelled cash rides that no ride collects yet:
 * the next cash ride collects them in cash on top of its fare (a separate line).
 */
export interface OwedFeeLine {
  amount: number;
  collectedWith: 'cash';
  label: string;
  rides: { rideId: string; number: number; amount: number; cancelledAt: string | null }[];
}

/** A cash ride's own cancellation fee: owed until a later cash ride collects it, or waived. */
export type FeeStatus = 'owed' | 'collected' | 'waived';

export interface Place extends LatLng {
  address: string | null;
  landmark: string | null;
}

export type FareMode = 'car' | 'seat';

export interface CargoDetails {
  loaders: number;
  riderRides: boolean;
  description: string | null;
  weightKg: number | null;
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
  class: AnyRideClass;
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
    /** A cash ride's cancellation fee: owed, collected (by a later ride) or waived. */
    cancellationFeeStatus?: FeeStatus | null;
    /** Earlier rides' owed fees this ride collects in cash, on top of the fare. */
    owedFee?: number;
    /** The shared-ride discount (the part of the trip shared with other riders). */
    poolDiscount?: number;
    /** Paid by card in advance (a ride booked for later). */
    deposit?: number;
    /** What the rider pays for the trip now: the fare after the discount, before waiting. */
    pays?: number;
    breakdown: Fare;
  };
  /** Wave 4 (docs/shared-rides.md): optional so older API builds still render. */
  service?: RideService;
  /** Cargo rides: loaders, the customer in the cab, the load (null otherwise). */
  cargo?: CargoDetails | null;
  /** Deliveries: the parcel and who receives it (null otherwise). */
  delivery?: {
    parcel: { description: string | null; weightKg: number | null } | null;
    recipientName: string | null;
    recipientPhone: string | null;
  } | null;
  /** People riding: 1-3 (one in front, at most two in the back). */
  passengers?: number;
  /** The rider agreed to share the car ("Hamroh bilan"). */
  shareable?: boolean;
  /** A woman driver only. */
  womenOnly?: boolean;
  /** car: the whole car; seat: a fixed route's per-person price in a shared car. */
  fareMode?: FareMode;
  /** The shared car the ride is in, with the metres shared with other riders so far. */
  pool?: { id: string; sharedM: number } | null;
  /** The ride has a start code (the code itself is the rider's only). */
  hasStartPin?: boolean;
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
  /** Rides ordered for later: when the rider wants to leave. */
  scheduledFor: string | null;
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
  declineReason?: string | null;
  /** The decline reason code's Uzbek label (free text as sent). */
  declineReasonLabel?: string | null;
}

export interface RideEvent {
  id: string;
  type: string;
  actor: RideActor;
  data: Record<string, unknown> | null;
  at: string;
  /** Declines and releases: the reason code's Uzbek label. */
  reasonLabel?: string;
}

/** GET /admin/reasons: reason codes drivers send, with Uzbek labels. */
export interface ReasonLabels {
  decline: Record<string, string>;
  driverCancel: Record<string, string>;
  release: Record<string, string>;
}

/** GET /admin/rides/:id owedFees */
export interface OwedFees {
  /** This ride's own cancellation fee (cash rides cancelled with a fee). */
  own: {
    amount: number;
    status: FeeStatus;
    collectingRideId: string | null;
    waivedBy: string | null;
    waiveNote: string | null;
  } | null;
  /** Earlier rides' fees this ride collects in cash. */
  collects: { rideId: string; number: number; amount: number; status: FeeStatus | null }[];
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
  owedFees?: OwedFees;
  offers: RideOffer[];
  events: RideEvent[];
  reasonLabels?: ReasonLabels;
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
  /** A cargo car's class (null or absent: a taxi car). */
  cargoClass?: CargoClass | null;
  rideId: string | null;
  rideStatus: RideStatus | null;
  offeredRideId: string | null;
  state: LiveDriverState;
  /**
   * Every open ride the car carries (a shared car carries up to 3). The API lists such a
   * driver once per ride; the panel merges the rows (lib/pool.ts mergeLiveDrivers).
   */
  rideIds?: string[];
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

/** Licence card check with the Ministry of Transport's registry (manual today). */
export const LICENCE_STATUSES = ['unverified', 'valid', 'invalid'] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

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
  lat: number | null;
  lng: number | null;
  locatedAt: string | null;
  ridesCompleted: number;
  licenceStatus: LicenceStatus;
  balance: number;
  /** Card fares credited minus payouts: what the platform still owes the driver. */
  cardOwed?: number;
  /** Average stars with the prior (priority's rating part). */
  rating: number;
  /** Priority score 0..100. */
  priority: number;
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
  cngInTrunk?: boolean;
  /** taxi: passenger rides and deliveries; cargo: cargo rides of its class only. */
  service?: 'taxi' | 'cargo';
  body?: VehicleBody;
  payloadKg?: number | null;
  grossKg?: number | null;
  cargoClass?: CargoClass | null;
  /** The car as riders see it (a 15-minute read URL). */
  photoUrl?: string | null;
}

export interface DriverDocument {
  kind: DocumentKind;
  /** Uploaded files: a 15-minute read URL (refresh through GET /uploads/:id); legacy: as sent. */
  url: string | null;
  uploadId?: string | null;
  expiresOn: string | null;
  uploadedAt: string;
}

export interface LicenceCheck {
  source: 'manual' | 'mintrans';
  licenceCardNumber: string;
  result: 'valid' | 'invalid';
  expiresOn: string | null;
  note: string | null;
  checkedBy: string | null;
  at: string;
}

/** GET /admin/drivers/:id */
export interface AdminDriver {
  id: string;
  fullName: string;
  phone: string | null;
  birthDate: string;
  pinfl: string;
  licence: { number: string; categories: string[]; issuedOn: string };
  licenceCard: {
    number: string;
    expiresOn: string;
    verification: LicenceStatus;
    checkedAt: string | null;
  };
  status: DriverStatus;
  statusReason: string | null;
  approvedAt: string | null;
  isOnline: boolean;
  onlineSince: string | null;
  location: { lat: number; lng: number; heading: number | null; at: string | null } | null;
  photoUrl?: string | null;
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
  licenceChecks: LicenceCheck[];
  balance: number;
  cardMoney?: CardMoney;
  /** Declared in the application; verified by an operator against the passport. */
  gender?: Gender | null;
  genderVerified?: boolean;
  /** A verified woman driver takes women riders only. */
  womenRidersOnly?: boolean;
  /** Shared rides: the mode, people in the car without the app, where the driver heads. */
  pool?: DriverPool;
}

export type Gender = 'female' | 'male';

export interface SeatLayout {
  occupied: number;
  capacity: number;
  front: number;
  rear: number;
  free: number;
}

export interface DriverPool {
  enabled: boolean;
  extraPassengers: number;
  destination: {
    lat: number;
    lng: number;
    address: string | null;
    landmark?: string | null;
  } | null;
  destinationSetAt: string | null;
  seats: SeatLayout;
}

/** Card money: fares riders prepaid by card, credited to the driver, minus payouts. */
export interface CardMoney {
  credited: number;
  paidOut: number;
  owed: number;
  /** What can be paid out now: a payout above the balance is refused (fees and debts first). */
  payableNow: number;
  lastPayoutAt: string | null;
}

/** GET /admin/drivers/payouts items, most owed first. */
export interface DriverPayout extends CardMoney {
  driverId: string;
  fullName: string;
  phone: string;
  status: DriverStatus;
  balance: number;
}

/** GET /admin/drivers/appeals items */
export interface DriverAppeal {
  id: string;
  driverId: string;
  fullName: string;
  phone: string;
  driverStatus: DriverStatus;
  statusReason: string | null;
  /** The status the driver appealed against. */
  statusAt: 'rejected' | 'blocked';
  text: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// Uploads ----------------------------------------------------------------------------------

/** GET /uploads/:id */
export interface Upload {
  id: string;
  purpose: 'document' | 'profile_photo' | 'vehicle_photo';
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  sizeBytes: number;
  status: 'pending' | 'ready';
  url: string | null;
  createdAt: string;
}

// Callers ----------------------------------------------------------------------------------

export interface SavedPlace {
  id: string;
  kind: 'home' | 'work' | 'other';
  label: string | null;
  address: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
}

/** POST /admin/customers/lookup */
export type CustomerLookup =
  | { found: false; phone: string }
  | {
      found: true;
      phone: string;
      user: {
        id: string;
        name: string | null;
        status: string;
        rating: number;
        noShows: number;
        since: string;
      };
      openRide: AdminRide | null;
      recentRides: RideBase[];
      recentPlaces: Place[];
      savedPlaces: SavedPlace[];
      /** Fees from cancelled cash rides the next cash ride collects (operators may waive). */
      owedFee?: OwedFeeLine | null;
    };

/** GET /config */
export interface AppConfig {
  support: { phone: string | null; telegram: string | null; officeAddress: string | null };
  features: Record<string, boolean>;
  cardProviders: string[];
}

// Money ------------------------------------------------------------------------------------

export type LedgerKind =
  | 'topup'
  | 'commission'
  | 'tax'
  | 'pass'
  | 'adjustment'
  | 'card_fare'
  | 'payout'
  /** A cash ride's owed cancellation fee, credited to the driver it is owed to. */
  | 'cancel_fee'
  /** Owed fees a driver collected in cash on top of a fare (debited: not theirs). */
  | 'cancel_fee_collected';

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

export type IntentPurpose = 'ride' | 'topup' | 'booking';

/** GET /admin/payments/refunds items: cancelled card rides and trip-board booking deposits. */
export interface Refund {
  id: string;
  amount: number;
  provider: 'payme' | 'click' | null;
  paidAt: string | null;
  refundRequestedAt: string | null;
  purpose?: IntentPurpose;
  rideId: string | null;
  rideNumber: number | null;
  /** A trip-board booking's deposit. */
  bookingId?: string | null;
  bookingNumber?: number | null;
  riderPhone: string;
  cancelReason: string | null;
}

export type PaymentProvider = 'payme' | 'click';
export const INTENT_STATUSES = [
  'pending',
  'paid',
  'expired',
  'cancelled',
  'refund_pending',
  'refunded',
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/** GET /admin/payments/intents items: ride prepayments and driver top-ups by card. */
export interface PaymentIntent {
  id: string;
  purpose: IntentPurpose;
  status: IntentStatus;
  amount: number;
  provider: PaymentProvider | null;
  rideId: string | null;
  rideNumber: number | null;
  bookingId?: string | null;
  bookingNumber?: number | null;
  driverId: string | null;
  driverName: string | null;
  userId: string;
  phone: string;
  expiresAt: string;
  paidAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
  refundReference: string | null;
  createdAt: string;
}

/** GET /admin/payments/intents/summary rows: count and amount per purpose and status. */
export interface IntentSummaryRow {
  purpose: IntentPurpose;
  status: IntentStatus;
  count: number;
  amount: number;
}

// Intercity --------------------------------------------------------------------------------

export const TRIP_STATUSES = ['scheduled', 'boarding', 'departed', 'arrived', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const BOOKING_STATUSES = [
  /** Held while the rider pays the card deposit (payment_minutes), then booked or cancelled. */
  'awaiting_payment',
  'booked',
  'boarded',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface IntercityPoint {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  lat: number;
  lng: number;
  meetingPoint: string;
}

export interface SeatPrices {
  rear: number;
  front: number;
}

/** A departure as the board shows it (GET /admin/intercity/search). */
export interface PublicTrip {
  id: string;
  number: number;
  status: TripStatus;
  from: IntercityPoint;
  to: IntercityPoint;
  departureAt: string;
  meetingPoint: string;
  comment: string | null;
  class: RideClass;
  distanceM: number;
  seats: { total: number; free: number; frontOffered: boolean; frontFree: boolean };
  price: SeatPrices;
  driver: { name: string; rating: number; ridesCompleted: number; photoUrl: string | null };
  vehicle: {
    make: string;
    model: string;
    colour: string;
    class: RideClass;
    photoUrl: string | null;
  };
}

export interface BookingTown {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
}

export interface TripBooking {
  id: string;
  number: number;
  tripId: string;
  status: BookingStatus;
  channel: 'app' | 'phone';
  seats: number;
  front: boolean;
  price: number;
  pickupNote: string | null;
  /** rider, driver, operator, or system (the deposit was not paid in time). */
  cancelledBy: string | null;
  cancelReason: string | null;
  cancellationFee: number;
  /** Paid by card in advance; the rest (payCash) is cash to the driver. */
  depositAmount?: number;
  payCash?: number;
  /** A seat along the way: the rider's towns on the trip's road. */
  alongTheWay?: boolean;
  pickup?: BookingTown | null;
  dropoff?: BookingTown | null;
  createdAt: string;
  boardedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  riderId: string;
  riderName: string | null;
  riderPhone: string;
  commission?: number | null;
  tax?: number | null;
}

/** GET /admin/intercity/trips[/:id]: a departure with its driver and bookings. */
export interface AdminTrip extends Omit<PublicTrip, 'driver' | 'vehicle'> {
  driver: PublicTrip['driver'] & { id: string; phone: string };
  vehicle: PublicTrip['vehicle'] & { plate: string; plateFormatted: string };
  referenceRear: number | null;
  cancelledBy: 'driver' | 'operator' | null;
  cancelReason: string | null;
  boardingAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  cancelledAt: string | null;
  bookings: TripBooking[];
}

/** GET /admin/intercity/fares items: operators' fixed route prices. */
export interface RoutePrice {
  from: string;
  to: string;
  rear: number;
  front: number;
  updatedAt: string;
}

/** GET /intercity/fares: a route's reference prices. */
export interface IntercityFare {
  from: IntercityPoint;
  to: IntercityPoint;
  class: RideClass;
  distanceM: number;
  durationS: number | null;
  source: 'route' | 'tariff';
  reference: SeatPrices;
  band: { min: number; max: number };
}

export interface IntercityRules {
  price_band_percent: number;
  publish_max_days_ahead: number;
  publish_min_minutes_ahead: number;
  free_cancel_minutes: number;
  late_cancel_fee_percent: number;
  boarding_opens_minutes: number;
  /** Seats along the way: a trip passing the rider's towns within this many extra km. */
  along_route_max_km?: number;
}

// Support ----------------------------------------------------------------------------------

export const COMPLAINT_TYPES = [
  'lost_item',
  'driver_behaviour',
  'route',
  'price',
  'car_condition',
  'safety',
  'other',
] as const;
export type ComplaintType = (typeof COMPLAINT_TYPES)[number];
export const COMPLAINT_RESOLUTIONS = [
  'item_returned',
  'refund',
  'driver_warned',
  'driver_blocked',
  'rejected',
  'no_action',
] as const;
export type ComplaintResolution = (typeof COMPLAINT_RESOLUTIONS)[number];
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved';

export interface ComplaintItem {
  id: string;
  rideId: string;
  rideNumber: number;
  riderPhone: string;
  driverId: string | null;
  type: ComplaintType;
  typeLabel: string;
  status: ComplaintStatus;
  text: string;
  resolution: ComplaintResolution | null;
  createdAt: string;
  updatedAt: string;
}

export interface Complaint {
  id: string;
  rideId: string;
  rideNumber: number;
  riderId: string;
  driverId: string | null;
  type: ComplaintType;
  typeLabel: string;
  status: ComplaintStatus;
  text: string;
  resolution: ComplaintResolution | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  messages: { id: string; authorRole: 'rider' | 'admin'; text: string; at: string }[];
}

export interface Rating {
  id: string;
  rideId: string;
  rideNumber: number;
  authorRole: 'rider' | 'driver';
  authorId: string;
  authorName: string | null;
  subjectId: string;
  subjectName: string | null;
  subjectPhone: string;
  stars: number;
  tags: string[];
  comment: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

// Fiscal receipts and the outbox -----------------------------------------------------------

export type ReceiptStatus = 'pending' | 'sent' | 'skipped';

export interface FiscalReceipt {
  id: string;
  rideId: string | null;
  bookingId: string | null;
  provider: string;
  status: ReceiptStatus;
  amount: number;
  receiptId: string | null;
  url: string | null;
  attempts: number;
  lastError: string | null;
  payload: {
    receiptNumber?: string;
    kind?: 'ride' | 'intercity';
    orderNumber?: number;
    items?: { name: string; mxik: string; packageCode: string; price: number }[];
    receivedCash?: number;
    receivedCard?: number;
  } | null;
  createdAt: string;
  sentAt: string | null;
}

export interface FiscalRules {
  city_item_name: string;
  intercity_item_name: string;
  cargo_item_name?: string;
  delivery_item_name?: string;
  mxik_code: string;
  package_code: string;
  vat_percent: number;
}

export interface OutboxEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
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
