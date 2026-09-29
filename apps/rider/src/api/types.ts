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

export type Gender = 'female' | 'male';

export interface Me {
  id: string;
  phone: string;
  fullName: string | null;
  /** Declared by the rider (a woman driver is offered to women); older APIs: absent. */
  gender?: Gender | null;
  /** Until when the declared gender cannot be changed again (once per 30 days); null: now. */
  genderLockedUntil?: string | null;
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
/** Cargo cars by payload: small (Damas/Labo, up to 700 kg) and medium (Gazel/Porter). */
export type CargoClass = 'cargo_s' | 'cargo_m';
/** Any ride's class: a taxi class (taxi, delivery) or a cargo class. */
export type AnyRideClass = RideClass | CargoClass;
/** Taxi, cargo ("Yuk tashish") or a parcel carried by a taxi car ("Yetkazib berish"). */
export type RideService = 'taxi' | 'cargo' | 'delivery';
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
  /** A fixed route price replaced the distance price (whole car, or seats × people). */
  fixed?: FixedFare | null;
}

export type FareMode = 'car' | 'seat';

export interface FixedFare {
  routeFareId: string;
  mode: FareMode;
  price: number;
  passengers: number;
}

/** Seats in a car: people, how many in front (1) and in the back (at most 2). */
export interface SeatLayout {
  occupied: number;
  capacity: number;
  front: number;
  rear: number;
  free: number;
}

/** A car already on its way that could take the rider too (before ordering). */
export interface PoolCar extends SeatLayout {
  /** Road seconds to the pickup. */
  etaS: number;
  /** Extra seconds the others in the car would ride for this pickup. */
  detourS: number;
  /** People in the car now. */
  inCar: number;
}

export interface QuotePool {
  available: boolean;
  /** The discount when the whole trip (its full-discount share) is shared. */
  discountPercent: number;
  fullDiscountSharePercent: number;
  cashOnly: boolean;
  cars: PoolCar[];
}

export interface QuoteRoute {
  from: { slug: string; name: string };
  to: { slug: string; name: string };
  prices: Partial<Record<RideClass, { seat: number | null; car: number | null }>>;
}

export interface QuoteWomenOnly {
  available: boolean;
  reason: 'profile_gender' | null;
  /** Free verified women drivers near the pickup; null for a ride for later. */
  drivers: { cars: number; etaS: number | null } | null;
}

/** A fixed price between towns (GET /routes). */
export interface RouteFare {
  id: string;
  class: RideClass;
  seatPrice: number | null;
  carPrice: number | null;
  isActive?: boolean;
  from: { slug: string; name: string; lat: number; lng: number };
  to: { slug: string; name: string; lat: number; lng: number };
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
  /** Which providers a card payment goes through (Payme, Click); older APIs: absent. */
  cardProviders?: CardProvider[];
  /**
   * Cancellation fees the rider still owes from earlier cash rides: a separate line a cash
   * ride collects on top of its fare (a card ride leaves it owed). Null: nothing owed.
   */
  owedFee?: OwedFeeLine | null;
  /** The seating rule (wave 4): at most 3 people, 1 in front, 2 in the back. */
  seats?: { max: number; front: number; rearMax: number };
  /** A fixed price between these towns applies, else null. */
  route?: QuoteRoute | null;
  /** "Hamroh bilan": the discount and cars already going that way. */
  pool?: QuotePool;
  /** A woman driver: offered to women (profile), with the free ones nearby. */
  womenOnly?: QuoteWomenOnly | null;
  /**
   * A ride booked for later is secured by a card deposit (another branch; shape tolerant):
   * the amount, or a percent of the fare.
   */
  deposit?: QuoteDeposit | null;
  /** Taxi (older APIs: absent) or delivery. */
  service?: 'taxi' | 'delivery';
  /** A delivery quote: the parcel's rules; the order needs the recipient. */
  delivery?: DeliveryRules | null;
}

/** A ride for later is booked once part of its price is paid by card (null: deposits off). */
export interface QuoteDeposit {
  percent: number;
  min: number;
  /** The economy fare's deposit; `amounts` per class. */
  amount: number;
  amounts?: Partial<Record<RideClass, number>>;
  /** Cancelled at least this long before the time, the deposit comes back. */
  freeCancelMinutes: number;
  cardProviders?: CardProvider[];
}

export interface DeliveryRules {
  percent: number;
  maxWeightKg: number;
  parcel?: { description: string | null; weightKg: number | null };
  recipientRequired: boolean;
}

export interface CargoFare extends Omit<Fare, 'rideClass'> {
  rideClass: CargoClass;
  cargo: {
    basePrice: number;
    includedKm: number;
    includedMinutes: number;
    extraKm: number;
    perKm: number;
    distance: number;
    perMinute: number;
    loaders: number;
    loaderPrice: number;
    loadersTotal: number;
    maxPayloadKg: number;
  };
}

export interface CargoClassRules {
  maxPayloadKg: number;
  includedKm: number;
  includedMinutes: number;
  perKm: number;
  intercityPerKm: number;
  perMinute: number;
  /** The load's weight given in the quote fits the class. */
  fits: boolean;
}

/** POST rides/quote with service 'cargo'. */
export interface CargoQuote {
  quoteId: string;
  service: 'cargo';
  expiresAt: string;
  scheduledFor: string | null;
  city: GeoCity;
  kind: RideKind;
  distanceM: number;
  durationS: number | null;
  fares: Record<CargoClass, CargoFare>;
  paymentMethods: PaymentMethod[];
  cardProviders?: CardProvider[];
  owedFee?: OwedFeeLine | null;
  waiting: WaitingRule;
  cancellationFee: number;
  availability: Record<CargoClass, ClassAvailability> | null;
  deposit?: QuoteDeposit | null;
  cargo: {
    loaders: number;
    riderRides: boolean;
    description: string | null;
    weightKg: number | null;
    maxLoaders: number;
    loaderPrice: number;
    maxRiders: number;
    classes: Record<CargoClass, CargoClassRules>;
  };
}

export interface OwedFeeLine {
  amount: number;
  collectedWith: 'cash';
  label: string;
  rides: { rideId: string; number: number; amount: number; cancelledAt: string }[];
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

export type CancellationFeeStatus = 'owed' | 'collected' | 'waived';

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
  /** Cargo cars: the body (van, pickup, truck) and the class by payload. */
  body?: string | null;
  cargoClass?: CargoClass | null;
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
  class: AnyRideClass;
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
    /** This ride's own cancellation fee (cash): owed until the next cash ride, then collected. */
    cancellationFeeStatus?: CancellationFeeStatus | null;
    /** Earlier rides' owed fees this cash ride collects, a separate line from the fare. */
    owedFee?: number;
    /** The shared-ride discount (wave 4). */
    poolDiscount?: number;
    /** Paid by card in advance for a ride booked for later. */
    deposit?: number;
    /** What the rider pays for the trip now: after the discount, before waiting. */
    pays?: number;
    breakdown: Fare;
  };
  /** taxi, cargo or delivery (older APIs: absent = taxi). */
  service?: RideService;
  /** A cargo ride's load. */
  cargo?: {
    loaders: number;
    riderRides: boolean;
    description: string | null;
    weightKg: number | null;
  } | null;
  /** A delivery: the parcel and who receives it. */
  delivery?: {
    parcel: { description: string | null; weightKg: number | null } | null;
    recipientName: string | null;
    recipientPhone: string | null;
  } | null;
  passengers?: number;
  shareable?: boolean;
  womenOnly?: boolean;
  fareMode?: FareMode;
  pool?: { id: string; sharedM: number } | null;
  hasStartPin?: boolean;
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
  /** On the trip: the car's road ETA to the destination (same shape as driverEta). */
  destinationEta?: DriverEta | null;
  trail: TrailFix[];
  events: RideEvent[];
  /** The 4-digit code the rider tells the driver before the trip starts (open rides). */
  startPin?: string | null;
  /** The car: people in it now and free seats (once a driver is assigned). */
  car?: (SeatLayout & { inCar: number; riders: number }) | null;
}

export interface RideHistoryPage {
  items: RideSummary[];
  nextCursor: string | null;
}

export interface OrderInput {
  quoteId: string;
  class: AnyRideClass;
  paymentMethod: PaymentMethod;
  pickup: { address: string | null; landmark: string | null };
  dropoff: { address: string | null; landmark: string | null };
  comment: string | null;
  clientRequestId: string;
  /** People riding (1–3); older APIs ignore it. */
  passengers?: number;
  /** Agrees to share the car ("Hamroh bilan"): cash only. */
  shareable?: boolean;
  /** A woman driver only (women riders). */
  womenOnly?: boolean;
  /** 'seat': a fixed route's per-person price in a shared car. */
  fareMode?: FareMode;
  /** Cargo: the load described more precisely than in the quote (the price stays). */
  cargo?: { description?: string | null; weightKg?: number | null };
  /** Delivery: the parcel. */
  parcel?: { description?: string | null; weightKg?: number | null };
  /** Delivery: who receives it (the driver calls them). */
  recipient?: { name: string; phone: string } | null;
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
      /** Road ETA to the destination during the trip. */
      destinationEtaS: number | null;
    }
  | { type: 'ride.refund'; rideId: string; status: string; amount: number }
  | { type: 'intercity.updated'; tripId: string; bookingId: string | null; status: string }
  | { type: 'complaint.updated'; complaintId: string; rideId: string; status: string };

// App configuration (GET /config) --------------------------------------------------------

export interface AppConfig {
  support: { phone: string | null; telegram: string | null; officeAddress: string | null };
  /** null: no forced update. */
  minAppVersion: { rider: string | null; driver: string | null };
  /** Store pages for the update screen; null: the app's own fallback. */
  storeUrls?: {
    rider: { android: string | null; ios: string | null };
    driver: { android: string | null; ios: string | null };
  };
  features: {
    cardPayments: boolean;
    uploads: boolean;
    intercity: boolean;
    maskedCalls: boolean;
    scheduledRides: boolean;
  };
  cardProviders: CardProvider[];
  /** The seat board's cancellation rules riders agree to when booking. */
  intercity?: IntercityCancelRules;
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
  /** Hides it (POST places/recent/hide); older APIs: absent. */
  key?: string;
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
  /** Short-lived read URLs of the photos (url null when storage is off). */
  photos?: { uploadId: string; url: string | null }[];
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
export type BookingStatus =
  'awaiting_payment' | 'booked' | 'boarded' | 'completed' | 'cancelled' | 'no_show';

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
  /** GET /intercity/trips/:id only: what cancelling a booking costs, free until freeUntil. */
  cancelRules?: IntercityCancelRules & { freeUntil: string };
  /** GET /intercity/trips/:id only: a booking in the app pays this share by card first. */
  depositRules?: { percent: number; min: number; paymentMinutes: number } | null;
  /**
   * Search results: a trip between other towns passing the rider's (the seat priced for the
   * rider's part, `share` of the trip; `fullPrice` the whole trip's).
   */
  alongTheWay?: boolean;
  pickup?: IntercityPoint;
  dropoff?: IntercityPoint;
  share?: number;
  fullPrice?: { rear: number; front: number };
  /** Along the way: the rider's own town's meeting point, about when the car passes it. */
  boardingPoint?: { name: string; meetingPoint: string; estimatedAt: string } | null;
  alightingPoint?: { name: string; meetingPoint: string } | null;
  /** The rider's part of the trip's road metres. */
  partDistanceM?: number | null;
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
  /** Paid by card in advance (0: none); the rest, payCash, in cash to the driver. */
  depositAmount?: number;
  payCash?: number;
  /** The deposit's card payment: checkout links while it waits, the refund later. */
  payment?: RidePayment | null;
  /** A seat along the way: the rider's own towns. */
  alongTheWay?: boolean;
  pickup?: { slug: string; nameUz: string } | null;
  dropoff?: { slug: string; nameUz: string } | null;
  /** Where and about when the rider gets in (their town's meeting point), where they get off. */
  boardingPoint?: { name: string; meetingPoint: string; estimatedAt: string } | null;
  alightingPoint?: { name: string; meetingPoint: string } | null;
  /** The rider's part of the trip's road metres (the whole trip's for a whole seat). */
  partDistanceM?: number | null;
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
  cancelRules?: IntercityCancelRules;
  /** Free cancellation until then; later a share of the price is kept. */
  cancelFreeUntil?: string;
  /** What cancelling costs right now (0 = free, or it cannot be cancelled). */
  cancelFeeNow?: number;
}

export interface IntercityCancelRules {
  freeCancelMinutes: number;
  lateCancelFeePercent: number;
}

export interface BookInput {
  seats: number;
  front: boolean;
  pickupNote: string | null;
  clientRequestId: string;
  /** A seat along the way: the rider's towns (slugs), as the search found them. */
  from?: string | null;
  to?: string | null;
}

// Uploads (complaint photos) -------------------------------------------------------------

export interface UploadsConfig {
  /** False until the server has object storage: photos cannot be added then. */
  enabled: boolean;
  purposes: Record<string, { contentTypes: string[]; maxBytes: number }>;
}

export interface UploadView {
  id: string;
  purpose: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending' | 'ready';
  url: string | null;
  createdAt: string;
}

export interface CreatedUpload {
  id: string;
  purpose: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending';
  /** PUT the bytes here with exactly these headers (they are signed). */
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
    expiresInSeconds: number;
  };
}
