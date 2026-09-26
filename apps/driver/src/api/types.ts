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
}

export interface DriverDocument {
  kind: string;
  url: string;
  expiresOn: string | null;
  uploadedAt: string;
}

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
  licenceCard: { number: string; expiresOn: string };
  status: DriverStatus;
  statusReason: string | null;
  approvedAt: string | null;
  isOnline: boolean;
  onlineSince: string | null;
  location: { lat: number; lng: number; heading: number | null; at: string } | null;
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
  ride: {
    id: string;
    number: number;
    class: 'economy' | 'comfort';
    kind: 'city' | 'intercity';
    pickup: Place;
    dropoff: Place;
    distanceM: number;
    fare: number;
    options: string[];
    comment: string | null;
    paymentMethod: 'cash' | 'card';
    riderRating: number;
  };
}

export type RideStatus =
  'searching' | 'driver_assigned' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled';

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
  class: 'economy' | 'comfort';
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
  };
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
  rider?: { id: string; name: string | null; phone: string; rating: number; noShows: number };
  earnings: RideEarnings | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LedgerEntry {
  id: string;
  kind: 'topup' | 'commission' | 'tax' | 'pass' | 'adjustment';
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
