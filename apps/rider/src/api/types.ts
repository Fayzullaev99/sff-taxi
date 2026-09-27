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
export type CardProvider = 'payme' | 'click';

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
  cardProviders?: CardProvider[];
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
  /** A ride for later (priced for its own time), else null. */
  scheduledFor: string | null;
  /** The nearest free car per class by road; null for a ride for later. */
  availability: Record<RideClass, ClassAvailability> | null;
}

export interface ClassAvailability {
  /** Road seconds of the nearest free car to the pickup; null: none free nearby. */
  etaS: number | null;
  cars: number;
}

// Rides -------------------------------------------------------------------------------

export type RideStatus =
  | 'scheduled'
  | 'awaiting_payment'
  | 'searching'
  | 'driver_assigned'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type RidePaymentStatus =
  'pending' | 'paid' | 'not_charged' | 'failed' | 'refund_pending' | 'refunded';

export type PaymentIntentStatus =
  'pending' | 'paid' | 'cancelled' | 'expired' | 'refund_pending' | 'refunded';

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
  /** Short-lived read URLs (private bucket); null until the driver uploaded them. */
  photoUrl?: string | null;
  vehiclePhotoUrl?: string | null;
  location: { lat: number; lng: number; heading: number | null; at: string | null } | null;
}

/** The car's road ETA to the pickup while the driver is on the way. */
export interface DriverEta {
  etaS: number;
  distanceM: number;
  source: string;
  at: string;
}

export interface TrailFix {
  lat: number;
  lng: number;
  at: string;
  heading: number | null;
  speed?: number | null;
}

/** The ride's own waiting and cancellation rules (the tariff it was ordered under). */
export interface RideRulesView {
  freeWaitingMinutes: number;
  waitingPerMinute: number;
  cancellationFee: number;
}

/** A card ride's prepayment. `checkout` is there only while it can still be paid. */
export interface RidePayment {
  id: string;
  amount: number;
  status: PaymentIntentStatus;
  provider: CardProvider | null;
  expiresAt: string;
  paidAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
  checkout: Partial<Record<CardProvider, string>> | null;
}

/** The electronic fiscal receipt of a completed ride. */
export interface FiscalReceipt {
  status: 'pending' | 'sent' | 'skipped';
  url: string | null;
  sentAt: string | null;
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
  paymentStatus: RidePaymentStatus;
  vehicle: RideVehicle | null;
  cancelledBy: RideActor | null;
  cancelReason: string | null;
  requestedAt: string;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Ordered for later: when the car should come (dispatch starts 15 min before). */
  scheduledFor: string | null;
}

/** The rider's full view of one ride (GET /rides/:id). */
export interface Ride extends RideSummary {
  driver: RideDriver | null;
  receipt: FiscalReceipt | null;
  canCancel: boolean;
  cancelFeeNow: number;
  payment: RidePayment | null;
  rules: RideRulesView;
  rated: boolean;
  driverEta: DriverEta | null;
  trail: TrailFix[];
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
      /** Road ETA to the pickup while the driver is on the way (refreshed every ~15 s). */
      etaS: number | null;
    }
  | { type: 'intercity.updated'; tripId: string; bookingId: string | null; status: string }
  | { type: 'complaint.updated'; complaintId: string; rideId: string; status: string };

// App configuration (GET /config) --------------------------------------------------------

export interface AppConfig {
  support: { phone: string | null; telegram: string | null; officeAddress: string | null };
  minAppVersion: { rider: string; driver: string };
  features: {
    cardPayments: boolean;
    uploads: boolean;
    intercity: boolean;
    maskedCalls: boolean;
    scheduledRides: boolean;
  };
  cardProviders: CardProvider[];
  shareBaseUrl: string;
}

// Saved places ---------------------------------------------------------------------------

export type PlaceKind = 'home' | 'work' | 'other';

export interface SavedPlace {
  id: string;
  kind: PlaceKind;
  label: string | null;
  address: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  updatedAt: string;
}

export interface PlaceInput {
  kind: PlaceKind;
  label?: string | null;
  address?: string | null;
  landmark?: string | null;
  lat: number;
  lng: number;
}

export interface RecentPlace {
  address: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  lastUsedAt: string;
}

// Complaints (support tickets) -----------------------------------------------------------

export type ComplaintType =
  'lost_item' | 'driver_behaviour' | 'route' | 'price' | 'car_condition' | 'safety' | 'other';

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved';

export type ComplaintResolution =
  'item_returned' | 'refund' | 'driver_warned' | 'driver_blocked' | 'rejected' | 'no_action';

export interface ComplaintListItem {
  id: string;
  rideId: string;
  rideNumber: number;
  type: ComplaintType;
  typeLabel: string;
  status: ComplaintStatus;
  resolution: ComplaintResolution | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintMessage {
  id: string;
  authorRole: 'rider' | 'admin';
  text: string;
  at: string;
}

export interface Complaint {
  id: string;
  rideId: string;
  rideNumber: number;
  riderId: string;
  type: ComplaintType;
  typeLabel: string;
  status: ComplaintStatus;
  text: string;
  resolution: ComplaintResolution | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  messages: ComplaintMessage[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// Intercity trip board -------------------------------------------------------------------

export interface IntercityPoint {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  lat: number;
  lng: number;
  meetingPoint: string;
}

export type TripStatus = 'scheduled' | 'boarding' | 'departed' | 'arrived' | 'cancelled';
export type BookingStatus = 'booked' | 'boarded' | 'completed' | 'cancelled' | 'no_show';

export interface IntercityTrip {
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
  price: { rear: number; front: number };
  driver: { name: string; rating: number; ridesCompleted: number; photoUrl: string | null };
  vehicle: {
    make: string;
    model: string;
    colour: string;
    class: RideClass;
    photoUrl: string | null;
  };
  /** GET /intercity/trips/:id only: the rider's latest booking on it. */
  myBookingId?: string | null;
}

export interface IntercityBooking {
  id: string;
  number: number;
  tripId: string;
  status: BookingStatus;
  channel: 'app' | 'phone';
  seats: number;
  front: boolean;
  price: number;
  pickupNote: string | null;
  cancelledBy: 'rider' | 'driver' | 'operator' | 'system' | null;
  cancelReason: string | null;
  cancellationFee: number;
  createdAt: string;
  boardedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  trip: IntercityTrip;
  /** Once booked: whom to call and which car to look for. */
  contact: {
    driverName: string;
    driverPhone: string;
    plate: string;
    plateFormatted: string;
  } | null;
  canCancel: boolean;
}

export interface BookInput {
  seats: number;
  front: boolean;
  pickupNote: string | null;
  clientRequestId: string;
}
