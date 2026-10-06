/** Response shapes of the SFF Taxi API used by the driver app (apps/api, README "API"). */

export interface CodeSent {
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export type DriverStatus = 'pending' | 'active' | 'rejected' | 'blocked';

export interface Account {
  id: string;
  phone: string;
  fullName: string | null;
  isAdmin: boolean;
  driver: { status: DriverStatus; statusReason: string | null; isOnline: boolean } | null;
}

export interface Vehicle {
  make: string;
  model: string;
  colour: string;
  plate: string;
  plateFormatted: string;
  year: number;
  seats: number;
  class: 'economy' | 'comfort';
  features: string[];
  /** A CNG tank in the trunk: no luggage rides even with a big trunk. */
  cngInTrunk?: boolean;
  /** Whether luggage rides come (big trunk, no tank in it). */
  luggage?: boolean;
  /** The car photo riders see (15-minute read URL), null until uploaded. */
  photoUrl?: string | null;
  /** taxi: passenger rides and deliveries; cargo: cargo rides of its class only. */
  service?: 'taxi' | 'cargo';
  body?: string | null;
  payloadKg?: number | null;
  grossKg?: number | null;
  cargoClass?: 'cargo_s' | 'cargo_m' | null;
}

export interface DriverDocument {
  kind: string;
  /** Read URL of the uploaded file (15 minutes), or the link an older app sent. */
  url: string | null;
  uploadId?: string | null;
  /** The file's type (a legacy link: by its extension; null when unknown). */
  contentType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | string | null;
  expiresOn: string | null;
  uploadedAt: string;
}

/** The licence card check with the Ministry of Transport's registry (docs/fiscal-and-licence.md). */
export type LicenceVerification = 'unverified' | 'valid' | 'invalid';

export interface Priority {
  score: number;
  acceptance: number;
  reliability: number;
  rating: number;
  stars: number;
}

/** `GET /v1/driver/me` */
export interface DriverMe {
  id: string;
  fullName: string;
  phone: string | null;
  birthDate: string;
  pinfl: string;
  licence: { number: string; categories: string[]; issuedOn: string };
  licenceCard: {
    number: string;
    expiresOn: string;
    verification?: LicenceVerification;
    checkedAt?: string | null;
  };
  status: DriverStatus;
  statusReason: string | null;
  approvedAt: string | null;
  isOnline: boolean;
  onlineSince: string | null;
  location: { lat: number; lng: number; heading: number | null; at: string } | null;
  /** The driver's face riders see (read URL), null until uploaded. */
  photoUrl?: string | null;
  vehicle: Vehicle | null;
  documents: DriverDocument[];
  missingDocuments: string[];
  priority: Priority;
  stats: {
    offersReceived: number;
    offersAccepted: number;
    ridesCompleted: number;
    ridesCancelled: number;
    ratingCount: number;
  };
  createdAt: string;
  balance: number;
  minBalance: number;
  /** Uzbek sentences: why the driver cannot work now. */
  blockers: string[];
  /** Declared in the application; `genderVerified` once an operator checked the passport. */
  gender?: Gender | null;
  genderVerified?: boolean;
  /** A verified woman driver takes women riders only. */
  womenRidersOnly?: boolean;
  /** Shared rides and the heading filter (wave 4; absent on an older API). */
  pool?: DriverPool | null;
}

export type Gender = 'female' | 'male';

/** `GET /v1/geo/search` (public): address suggestions. */
export interface GeoAddress {
  /** "Mustaqillik ko‘chasi, 12" */
  title: string;
  /** "Guliston, Sirdaryo viloyati" */
  subtitle: string | null;
  locality?: string | null;
  lat: number;
  lng: number;
}

/** The car's seats: one in front, at most two in the back (the hard seating rule). */
export interface SeatLayout {
  occupied: number;
  capacity: number;
  front: number;
  rear: number;
  free: number;
}

export interface DriverDestination {
  lat: number;
  lng: number;
  address: string | null;
  landmark?: string | null;
}

/** `GET /v1/driver/me` → `pool`. */
export interface DriverPool {
  enabled: boolean;
  /** People in the car without the app (0–3). */
  extraPassengers: number;
  /** Where the driver is heading: only rides on the way are offered. */
  destination: DriverDestination | null;
  destinationSetAt: string | null;
  seats: SeatLayout;
}

/** `PUT /v1/driver/preferences` (every field optional). */
export interface PreferencesBody {
  poolEnabled?: boolean;
  extraPassengers?: number;
  destination?: { lat: number; lng: number; address: string | null } | null;
  womenRidersOnly?: boolean;
}

/** One stop of a plan: riders' pickups and drop-offs, the driver's own destination. */
export interface PlanStop {
  rideId: string | null;
  type: 'pickup' | 'dropoff' | 'destination';
  lat: number;
  lng: number;
  passengers: number;
}

/** `driver/rides/current` → `pool.stops[]`: the stops ahead, in order. */
export interface PoolStop {
  rideId: string;
  number: number;
  type: 'pickup' | 'dropoff';
  lat: number;
  lng: number;
  place: { address: string | null; landmark: string | null } | null;
  riderName: string | null;
  passengers: number;
  status: RideStatus;
}

/** Several riders in the car (null for one). */
export interface DriverRidePool {
  riders: number;
  occupancy: SeatLayout & { inCar: number; riders: number };
  stops: PoolStop[];
}

export interface Place {
  address: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
}

/** `GET /v1/driver/offers` */
export interface Offer {
  id: string;
  kind: 'direct' | 'broadcast';
  expiresAt: string;
  /** Road ETA to the pickup (s) and distance (m), null when unknown. */
  etaS: number | null;
  distanceM: number | null;
  /** A ride on the car's way (riders in the car, or a heading): the detour and new stop order. */
  along?: { detourS: number | null; stops: PlanStop[] } | null;
  ride: {
    id: string;
    number: number;
    class: 'economy' | 'comfort' | 'cargo_s' | 'cargo_m';
    kind: 'city' | 'intercity';
    pickup: Place;
    dropoff: Place;
    distanceM: number;
    fare: number;
    options: string[];
    comment: string | null;
    paymentMethod: 'cash' | 'card';
    riderRating: number;
    /** A ride ordered for later: when the rider wants the car (null = now). */
    scheduledFor?: string | null;
    /** Fees the rider owes from earlier cancelled cash rides, taken in cash with this fare. */
    owedFee?: number;
    /** People in this order (1–3). */
    passengers?: number;
    /** The rider agreed to share the car. */
    shareable?: boolean;
    /** The rider asked for a woman driver. */
    womenOnly?: boolean;
    /** 'seat': a fixed per-seat route price (a shared car); 'car': the whole car. */
    fareMode?: 'car' | 'seat';
    service?: 'taxi' | 'cargo' | 'delivery';
    cargo?: CargoDetails | null;
    /** A delivery's parcel (the recipient is shown only after accepting). */
    parcel?: ParcelDetails | null;
  };
}

export interface CargoDetails {
  /** Loaders ("yukchi") who load and unload, 0–2. */
  loaders: number;
  /** The customer rides in the cab (one person). */
  riderRides: boolean;
  description: string | null;
  weightKg: number | null;
}

export interface ParcelDetails {
  description: string | null;
  weightKg: number | null;
}

export type RideStatus =
  | 'scheduled'
  | 'searching'
  | 'driver_assigned'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface RideEarnings {
  fare: number | null;
  commission: number;
  commissionNote: string | null;
  tax: number;
  net: number;
}

/** `GET /v1/driver/rides/current`, `/:id`, and every ride step's answer. */
export interface DriverRide {
  id: string;
  number: number;
  status: RideStatus;
  channel: string;
  kind: 'city' | 'intercity';
  class: 'economy' | 'comfort' | 'cargo_s' | 'cargo_m';
  cityId: string | null;
  pickup: Place;
  dropoff: Place;
  options: string[];
  comment: string | null;
  distanceM: number;
  durationS: number | null;
  fare: {
    quoted: number;
    waiting: number;
    total: number | null;
    cancellationFee: number;
    /** This ride's own cancellation fee (cash rides): owed, collected (by a later ride), waived. */
    cancellationFeeStatus?: 'owed' | 'collected' | 'waived' | null;
    /** Earlier rides' owed fees this ride collects in cash (after completion: what was taken). */
    owedFee?: number;
    /** The shared-ride discount (the part of the trip shared with other riders). */
    poolDiscount?: number;
    /** Paid by card in advance (a ride booked for later). */
    deposit?: number;
    /** What the rider pays for the trip now: the fare after the discount, before waiting. */
    pays?: number;
  };
  /** People in this order (1–3). */
  passengers?: number;
  shareable?: boolean;
  womenOnly?: boolean;
  fareMode?: 'car' | 'seat';
  /** The trip starts only with the 4-digit code the rider tells the driver. */
  hasStartPin?: boolean;
  /** taxi (default), cargo or delivery; `class` is cargo_s/cargo_m for cargo. */
  service?: 'taxi' | 'cargo' | 'delivery';
  /** Cargo rides: loaders, the customer riding along, the load (null otherwise). */
  cargo?: CargoDetails | null;
  /** Deliveries: the parcel and who receives it. */
  delivery?: {
    parcel: ParcelDetails | null;
    recipientName: string | null;
    recipientPhone: string | null;
  } | null;
  /**
   * The current ride / a ride by id: the stops ahead when the car carries several riders
   * (null for one). Ride history items carry `{id, sharedM}` instead (see lib/pool).
   */
  pool?: DriverRidePool | { id: string; sharedM: number } | null;
  paymentMethod: 'cash' | 'card';
  paymentStatus: string;
  vehicle: (Vehicle & { plateFormatted: string }) | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  requestedAt: string;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Ordered for later: when the rider wants the car. */
  scheduledFor?: string | null;
  /** `phone`: null once the ride is over (finished or cancelled). */
  rider?: {
    id: string;
    name: string | null;
    phone: string | null;
    rating: number;
    noShows: number;
  };
  earnings: RideEarnings | null;
  /** Cash to take: (cash ride ? fare : 0) + paid waiting + owed fees. */
  collectCash?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LedgerEntry {
  id: string;
  kind:
    | 'topup'
    | 'commission'
    | 'tax'
    | 'pass'
    | 'adjustment'
    | 'card_fare'
    | 'payout'
    | 'cancel_fee'
    | 'cancel_fee_collected';
  amount: number;
  rideId: string | null;
  note: string | null;
  createdAt: string;
}

export interface Pass {
  id: string;
  kind: 'day' | 'week';
  startsAt: string;
  endsAt: string;
  price: number;
}

/** `GET /v1/driver/balance` */
export interface Balance {
  balance: number;
  minBalance: number;
  canWork: boolean;
  activePass: Pass | null;
  entries: LedgerEntry[];
}

/** `GET /v1/driver/earnings?period=day|week` */
export interface Earnings {
  from: string;
  to: string;
  rides: number;
  /** Intercity seats delivered in the period. */
  intercityBookings?: number;
  fares: number;
  cash: number;
  commission: number;
  tax: number;
  net: number;
}

/** `GET /v1/tariffs?lat&lng` (public) — the driver app only needs waiting and fees. */
export interface PublishedTariff {
  serviceable: boolean;
  city: string | null;
  tariff: {
    waiting: { free_minutes: number; per_minute: number };
    cancellation_fee: number;
  } | null;
}

// Uploads -------------------------------------------------------------------------------

/** `POST /v1/uploads/:id/complete`, `GET /v1/uploads/:id` */
export interface UploadView {
  id: string;
  purpose: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending' | 'ready';
  url: string | null;
  createdAt: string;
}

// Appeals -------------------------------------------------------------------------------

/** `GET /v1/driver/appeals` (newest first), `POST` answer. */
export interface Appeal {
  id: string;
  statusAt: 'rejected' | 'blocked';
  text: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// Card top-ups --------------------------------------------------------------------------

/** `POST /v1/driver/topups`, `GET /v1/driver/topups[/:id]` (a payment intent). */
export interface Topup {
  id: string;
  purpose: 'ride' | 'topup';
  amount: number;
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refund_pending' | 'refunded';
  provider: 'payme' | 'click' | null;
  expiresAt: string;
  paidAt: string | null;
  /** Where to pay, while it can still be paid. */
  checkout: Partial<Record<'payme' | 'click', string>> | null;
  createdAt: string;
}

// Intercity -----------------------------------------------------------------------------

export interface IntercityPoint {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string | null;
  lat: number;
  lng: number;
  meetingPoint: string | null;
}

/** `GET /v1/driver/intercity/fares?from&to&class` */
export interface IntercityFare {
  from: IntercityPoint;
  to: IntercityPoint;
  class: 'economy' | 'comfort';
  distanceM: number;
  durationS: number | null;
  source: 'route' | 'tariff';
  reference: { rear: number; front: number };
  band: { min: number; max: number };
}

export interface BookingTown {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string | null;
}

export interface TripBooking {
  id: string;
  number: number;
  tripId: string;
  status: 'booked' | 'boarded' | 'completed' | 'cancelled' | 'no_show';
  channel: string;
  seats: number;
  front: boolean;
  price: number;
  /** Paid by card in advance (the driver's once the trip is done). */
  depositAmount?: number;
  /** The rest, taken in cash at boarding. */
  payCash?: number;
  /** A seat for part of the route: picked up / dropped off in towns on the way. */
  alongTheWay?: boolean;
  pickup?: BookingTown | null;
  dropoff?: BookingTown | null;
  /** Along the way: the rider's town's meeting point, about when the car passes it. */
  boardingPoint?: { name: string; meetingPoint: string; estimatedAt: string } | null;
  alightingPoint?: { name: string; meetingPoint: string } | null;
  /** The rider's part of the trip's road metres. */
  partDistanceM?: number | null;
  pickupNote: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  riderId: string;
  riderName: string | null;
  riderPhone: string | null;
  commission: number;
  tax: number;
  createdAt: string;
  boardedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** `GET /v1/driver/intercity/trips/:id` and every step's answer. */
export interface DriverTrip {
  id: string;
  number: number;
  status: 'scheduled' | 'boarding' | 'departed' | 'arrived' | 'cancelled';
  from: IntercityPoint;
  to: IntercityPoint;
  departureAt: string;
  meetingPoint: string | null;
  comment: string | null;
  class: 'economy' | 'comfort';
  distanceM: number;
  seats: { total: number; free: number; frontOffered: boolean; frontFree: boolean };
  price: { rear: number; front: number };
  referenceRear: number;
  vehicle: { make: string; model: string; colour: string; plateFormatted: string };
  cancelledBy: string | null;
  cancelReason: string | null;
  boardingAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  cancelledAt: string | null;
  bookings: TripBooking[];
}

export interface PublishTripBody {
  from: string;
  to: string;
  departureAt: string;
  seats: number;
  frontSeat: boolean;
  priceRear: number | null;
  meetingPoint: string | null;
  comment: string | null;
}
