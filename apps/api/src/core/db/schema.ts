import type { ColumnType, Generated, JSONColumnType } from 'kysely';

/** Hand-written to match migrations/*.sql; keep them in step. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, never, never>;

export type SessionClient = 'rider' | 'driver' | 'admin';

export interface UsersTable {
  id: string;
  phone: string;
  full_name: string | null;
  status: Generated<'active' | 'blocked'>;
  rider_rating_sum: Generated<number>;
  rider_rating_count: Generated<number>;
  no_show_count: Generated<number>;
  /** Self-declared; the female-driver option is offered to women. */
  gender: Gender | null;
  gender_set_at: Timestamp | null;
  created_at: CreatedAt;
}

export type Gender = 'female' | 'male';

export interface AdminsTable {
  user_id: string;
  created_at: CreatedAt;
}

export interface PhoneVerificationsTable {
  id: string;
  phone: string;
  code_hash: Buffer;
  attempts: Generated<number>;
  expires_at: Timestamp;
  verified_at: Timestamp | null;
  ip: string | null;
  provider: string | null;
  provider_message_id: string | null;
  created_at: CreatedAt;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: Buffer;
  client: SessionClient;
  expires_at: Timestamp;
  rotated_at: Timestamp | null;
  revoked_at: Timestamp | null;
  user_agent: string | null;
  ip: string | null;
  created_at: CreatedAt;
}

export interface SettingsTable {
  key: string;
  value: JSONColumnType<Record<string, unknown>>;
  updated_at: Timestamp;
}

export interface OutboxTable {
  id: string;
  topic: string;
  payload: JSONColumnType<Record<string, unknown>>;
  attempts: Generated<number>;
  next_attempt_at: Timestamp;
  last_error: string | null;
  processed_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface OutboxDeliveriesTable {
  event_id: string;
  handler: string;
  delivered_at: CreatedAt;
}

export interface CitiesTable {
  id: Generated<string>;
  slug: string;
  name_uz: string;
  name_ru: string;
  center_lat: number;
  center_lng: number;
  boundary: JSONColumnType<[number, number][][]>;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  timezone: Generated<string>;
  is_active: Generated<boolean>;
  sort: Generated<number>;
  /** The city's own tariff (same shape as the global setting); null = global. */
  tariff: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

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
  /** The owed fees a driver collected in cash on top of a fare (debited: not theirs). */
  | 'cancel_fee_collected'
  /** A deposit the rider lost by cancelling late: the waiting driver's compensation. */
  | 'deposit';
export type RideClassColumn = 'economy' | 'comfort';

/** Dates (Postgres `date`) are read as "YYYY-MM-DD" strings: see database.ts. */
type DateOnly = ColumnType<string, string, string>;

export interface DriversTable {
  user_id: string;
  full_name: string;
  birth_date: DateOnly;
  pinfl: string;
  licence_number: string;
  licence_categories: string[];
  licence_issued_on: DateOnly;
  licence_card_number: string;
  licence_card_expires_on: DateOnly;
  status: Generated<DriverStatus>;
  status_reason: string | null;
  approved_at: Timestamp | null;
  approved_by: string | null;
  is_online: Generated<boolean>;
  online_since: Timestamp | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  located_at: Timestamp | null;
  offers_received: Generated<number>;
  offers_accepted: Generated<number>;
  rides_completed: Generated<number>;
  rides_cancelled: Generated<number>;
  rating_sum: Generated<number>;
  rating_count: Generated<number>;
  photo_upload_id: string | null;
  licence_status: Generated<'unverified' | 'valid' | 'invalid'>;
  licence_checked_at: Timestamp | null;
  /** From the application; verified by an operator against the passport. */
  gender: Gender | null;
  gender_verified_at: Timestamp | null;
  gender_verified_by: string | null;
  /** A verified woman driver taking women riders only. */
  women_riders_only: Generated<boolean>;
  /** Takes riders who agreed to share while carrying someone. */
  pool_enabled: Generated<boolean>;
  /** People in the car without the app (the driver's own count). */
  extra_passengers: Generated<number>;
  /** Where the driver is heading: offers only on the way. */
  destination: NullableJson<Place & { lat: number; lng: number }>;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_set_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface VehiclesTable {
  driver_id: string;
  make: string;
  model: string;
  colour: string;
  plate: string;
  year: number;
  seats: number;
  class: RideClassColumn;
  features: Generated<VehicleFeature[]>;
  /** A CNG tank in the trunk: no room for luggage even in a big trunk. */
  cng_in_trunk: Generated<boolean>;
  photo_upload_id: string | null;
  updated_at: Timestamp;
}

export interface DriverDocumentsTable {
  driver_id: string;
  kind: DocumentKind;
  /** Apps built before uploads send a URL; otherwise upload_id. Exactly one is set. */
  url: string | null;
  upload_id: string | null;
  expires_on: DateOnly | null;
  uploaded_at: Timestamp;
}

export interface DriverStatusChangesTable {
  id: string;
  driver_id: string;
  from_status: string;
  to_status: string;
  reason: string | null;
  actor_id: string | null;
  created_at: CreatedAt;
}

export interface DriverLedgerTable {
  id: string;
  driver_id: string;
  kind: LedgerKind;
  amount: number;
  ride_id: string | null;
  note: string | null;
  created_by: string | null;
  payment_intent_id: string | null;
  booking_id: string | null;
  created_at: CreatedAt;
}

export interface DriverPassesTable {
  id: string;
  driver_id: string;
  kind: 'day' | 'week';
  starts_at: Timestamp;
  ends_at: Timestamp;
  price: number;
  ledger_id: string | null;
  created_at: CreatedAt;
}

export const RIDE_STATUSES = [
  /** Ordered for later: dispatch starts 15 minutes before scheduled_for. */
  'scheduled',
  /** A card ride waiting for its prepayment (Payme/Click) before dispatch. */
  'awaiting_payment',
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];
/** A driver is busy with a ride in these. */
export const ACTIVE_RIDE_STATUSES = ['driver_assigned', 'driver_arrived', 'in_progress'] as const;
/** Not finished yet, but dispatched: a driver is searched for or busy with it. */
export const OPEN_RIDE_STATUSES = ['searching', ...ACTIVE_RIDE_STATUSES] as const;
/** Not finished yet, including a card ride still waiting for its payment. */
export const UNFINISHED_RIDE_STATUSES = ['awaiting_payment', ...OPEN_RIDE_STATUSES] as const;
export type RidePaymentStatus =
  'pending' | 'paid' | 'not_charged' | 'failed' | 'refund_pending' | 'refunded';
export type RideActor = 'rider' | 'driver' | 'operator' | 'system';
export const RIDE_SERVICES = ['taxi', 'cargo', 'delivery'] as const;
export type RideService = (typeof RIDE_SERVICES)[number];
export type FareMode = 'car' | 'seat';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
export type DispatchStage = 'direct' | 'broadcast' | 'operator';

export interface Place {
  address: string | null;
  /** Orientir: "opposite school No. 5". */
  landmark: string | null;
}

export interface VehicleSnapshot {
  make: string;
  model: string;
  colour: string;
  plate: string;
  class: RideClassColumn;
}

type Json<T> = ColumnType<T, string, string>;
type NullableJson<T> = ColumnType<T | null, string | null, string | null>;

export interface QuotesTable {
  id: string;
  user_id: string;
  city_id: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  options: Generated<string[]>;
  distance_m: number;
  duration_s: number | null;
  route_source: string;
  kind: 'city' | 'intercity';
  fares: Json<Record<string, unknown>>;
  tariff: Json<Record<string, unknown>>;
  expires_at: Timestamp;
  /** A quote for later: priced at this time (night add-on). */
  scheduled_for: Timestamp | null;
  /** The fixed route between the ends, when there is one (RouteQuote). */
  route: NullableJson<Record<string, unknown>>;
  created_at: CreatedAt;
}

export interface RidesTable {
  id: string;
  number: Generated<number>;
  rider_id: string;
  rider_phone: string;
  rider_name: string | null;
  channel: Generated<'app' | 'phone'>;
  created_by: string;
  client_request_id: string | null;
  quote_id: string | null;
  city_id: string;
  kind: 'city' | 'intercity';
  class: RideClassColumn;
  pickup: Json<Place>;
  pickup_lat: number;
  pickup_lng: number;
  dropoff: Json<Place>;
  dropoff_lat: number;
  dropoff_lng: number;
  options: Generated<string[]>;
  comment: string | null;
  distance_m: number;
  duration_s: number | null;
  fare: Json<Record<string, unknown>>;
  tariff: Json<Record<string, unknown>>;
  fare_quoted: number;
  waiting_fee: Generated<number>;
  fare_total: number | null;
  cancellation_fee: Generated<number>;
  commission: Generated<number>;
  commission_note: string | null;
  tax: Generated<number>;
  payment_method: Generated<'cash' | 'card'>;
  payment_status: Generated<RidePaymentStatus>;
  status: RideStatus;
  driver_id: string | null;
  vehicle: NullableJson<VehicleSnapshot>;
  dispatch_stage: Generated<DispatchStage>;
  direct_offers: Generated<number>;
  broadcast_at: Timestamp | null;
  attention_at: Timestamp | null;
  cancelled_by: RideActor | null;
  cancel_reason: string | null;
  share_token: string | null;
  scheduled_for: Timestamp | null;
  /** A cash ride's cancellation fee: owed until a later ride collects it, or waived. */
  fee_status: 'owed' | 'collected' | 'waived' | null;
  fee_collect_ride_id: string | null;
  fee_waived_by: string | null;
  fee_waive_note: string | null;
  /** Owed fees of earlier rides this ride collects in cash on top of its fare. */
  owed_fee: Generated<number>;
  service: Generated<RideService>;
  /** People riding (1-3: one in front, at most two in the back). */
  passengers: Generated<number>;
  /** The rider agreed to share the car with riders going the same way. */
  shareable: Generated<boolean>;
  /** A woman driver only. */
  women_only: Generated<boolean>;
  rider_gender: Gender | null;
  /** car: the whole car; seat: a fixed per-person price in a shared car. */
  fare_mode: Generated<FareMode>;
  route_fare_id: string | null;
  pool_id: string | null;
  /** Road metres shared with other app riders (planned). */
  pool_shared_m: Generated<number>;
  /** The shared-ride discount off the quoted fare. */
  pool_discount: Generated<number>;
  /** Paid by card in advance (a ride booked for later); the rest is cash. */
  deposit_amount: Generated<number>;
  /** The code the rider tells the driver before the trip starts. */
  start_pin: string | null;
  requested_at: Generated<Date>;
  assigned_at: Timestamp | null;
  arrived_at: Timestamp | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  updated_at: Timestamp;
}

export interface RideEventsTable {
  id: string;
  ride_id: string;
  type: string;
  actor: RideActor;
  actor_id: string | null;
  data: Json<Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface RideOffersTable {
  id: string;
  ride_id: string;
  driver_id: string;
  kind: 'direct' | 'broadcast';
  status: Generated<OfferStatus>;
  eta_s: number | null;
  distance_m: number | null;
  score: number | null;
  created_at: Generated<Date>;
  expires_at: Timestamp;
  responded_at: Timestamp | null;
  decline_reason: string | null;
  /** A car already carrying riders: the stops the driver would follow (src/lib/pool.ts). */
  pool_plan: NullableJson<unknown[]>;
  /** How much longer the car's plan gets with this ride. */
  detour_s: number | null;
}

export interface RidePoolsTable {
  id: string;
  driver_id: string;
  status: Generated<'open' | 'closed'>;
  /** Stops ahead, in order (src/lib/pool.ts PlanStop). */
  plan: Json<unknown[]>;
  created_at: CreatedAt;
  updated_at: Timestamp;
  closed_at: Timestamp | null;
}

export interface RouteFaresTable {
  id: Generated<string>;
  from_point_id: string;
  to_point_id: string;
  class: Generated<RideClassColumn>;
  seat_price: number | null;
  car_price: number | null;
  is_active: Generated<boolean>;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface RatingsTable {
  id: string;
  ride_id: string;
  author_role: 'rider' | 'driver';
  author_id: string;
  subject_id: string;
  stars: number;
  tags: Generated<string[]>;
  comment: string | null;
  created_at: CreatedAt;
}

export interface SosEventsTable {
  id: string;
  ride_id: string;
  user_id: string;
  role: 'rider' | 'driver';
  lat: number | null;
  lng: number | null;
  note: string | null;
  created_at: CreatedAt;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface TaxWithholdingsTable {
  id: string;
  /** A ride or an intercity booking: exactly one is set. */
  ride_id: string | null;
  booking_id: string | null;
  driver_id: string;
  pinfl: string;
  period: string;
  base_amount: number;
  rate_percent: number;
  amount: number;
  ledger_id: string | null;
  remitted_at: Timestamp | null;
  remittance_ref: string | null;
  created_at: CreatedAt;
}

export type PushApp = 'rider' | 'driver';

export interface PushDevicesTable {
  id: string;
  user_id: string;
  token: string;
  app: PushApp;
  platform: 'ios' | 'android' | 'web';
  locale: Generated<'uz' | 'ru'>;
  created_at: CreatedAt;
  last_seen_at: Timestamp;
}

export interface NotificationsTable {
  id: string;
  dedupe_key: string;
  user_id: string | null;
  channel: 'push' | 'sms';
  kind: string;
  ride_id: string | null;
  status: 'sent' | 'failed' | 'skipped';
  error: string | null;
  provider_ref: string | null;
  created_at: CreatedAt;
}

export const UPLOAD_PURPOSES = [
  'document',
  'profile_photo',
  'vehicle_photo',
  'complaint_photo',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export interface UploadsTable {
  id: string;
  owner_id: string;
  purpose: UploadPurpose;
  object_key: string;
  content_type: UploadContentType;
  size_bytes: number;
  status: Generated<'pending' | 'ready'>;
  created_at: CreatedAt;
  completed_at: Timestamp | null;
}

export type PaymentProvider = 'payme' | 'click';
export type PaymentIntentStatus =
  'pending' | 'paid' | 'expired' | 'cancelled' | 'refund_pending' | 'refunded';

export interface PaymentIntentsTable {
  id: string;
  purpose: 'ride' | 'topup' | 'booking';
  ride_id: string | null;
  /** A trip-board booking's deposit. */
  booking_id: string | null;
  driver_id: string | null;
  user_id: string;
  amount: number;
  status: Generated<PaymentIntentStatus>;
  provider: PaymentProvider | null;
  expires_at: Timestamp;
  paid_at: Timestamp | null;
  refund_requested_at: Timestamp | null;
  refunded_at: Timestamp | null;
  refund_reference: string | null;
  created_at: CreatedAt;
}

export interface PaymentTransactionsTable {
  id: string;
  seq: Generated<number>;
  provider: PaymentProvider;
  external_id: string;
  intent_id: string;
  amount: number;
  state: Generated<'created' | 'performed' | 'cancelled' | 'refunded'>;
  provider_time: number | null;
  performed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  cancel_reason: number | null;
  created_at: CreatedAt;
}

export interface DriverAppealsTable {
  id: string;
  driver_id: string;
  status_at: 'rejected' | 'blocked';
  text: string;
  status: Generated<'open' | 'resolved'>;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface IntercityPointsTable {
  id: Generated<string>;
  slug: string;
  name_uz: string;
  name_ru: string;
  lat: number;
  lng: number;
  city_id: string | null;
  meeting_point: string;
  is_active: Generated<boolean>;
  sort: Generated<number>;
  /** The zone around the point for fixed route fares (beyond the town boundary). */
  zone_radius_m: Generated<number>;
}

export interface IntercityFaresTable {
  from_point_id: string;
  to_point_id: string;
  price_rear: number;
  price_front: number;
  updated_at: Timestamp;
}

export const TRIP_STATUSES = ['scheduled', 'boarding', 'departed', 'arrived', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const BOOKING_STATUSES = [
  'awaiting_payment',
  'booked',
  'boarded',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface IntercityTripsTable {
  id: string;
  number: Generated<number>;
  driver_id: string;
  from_point_id: string;
  to_point_id: string;
  departure_at: Timestamp;
  meeting_point: string;
  comment: string | null;
  class: RideClassColumn;
  vehicle: Json<VehicleSnapshot>;
  distance_m: number;
  seats_total: number;
  seats_booked: Generated<number>;
  front_seat: boolean;
  front_booked: Generated<boolean>;
  price_rear: number;
  price_front: number;
  reference_rear: number;
  status: Generated<TripStatus>;
  cancelled_by: 'driver' | 'operator' | null;
  cancel_reason: string | null;
  boarding_at: Timestamp | null;
  departed_at: Timestamp | null;
  arrived_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface IntercityBookingsTable {
  id: string;
  number: Generated<number>;
  trip_id: string;
  rider_id: string;
  rider_phone: string;
  rider_name: string | null;
  channel: Generated<'app' | 'phone'>;
  created_by: string;
  client_request_id: string | null;
  seats: number;
  front: Generated<boolean>;
  price: number;
  pickup_note: string | null;
  status: Generated<BookingStatus>;
  cancelled_by: 'rider' | 'driver' | 'operator' | 'system' | null;
  cancel_reason: string | null;
  cancellation_fee: Generated<number>;
  commission: Generated<number>;
  commission_note: string | null;
  tax: Generated<number>;
  /** Paid by card to book; the rest is cash to the driver. */
  deposit_amount: Generated<number>;
  /** Part of the trip (along the way): the rider's towns; null = the trip's ends. */
  pickup_point_id: string | null;
  dropoff_point_id: string | null;
  created_at: CreatedAt;
  boarded_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  updated_at: Timestamp;
}

export interface FiscalReceiptsTable {
  id: string;
  ride_id: string | null;
  booking_id: string | null;
  provider: string;
  status: Generated<'pending' | 'sent' | 'skipped'>;
  amount: number;
  payload: Json<Record<string, unknown>>;
  receipt_id: string | null;
  fiscal_sign: string | null;
  receipt_url: string | null;
  attempts: Generated<number>;
  last_error: string | null;
  created_at: CreatedAt;
  sent_at: Timestamp | null;
}

export interface LicenceChecksTable {
  id: string;
  driver_id: string;
  source: 'manual' | 'mintrans';
  licence_card_number: string;
  result: 'valid' | 'invalid';
  expires_on: DateOnly | null;
  note: string | null;
  raw: NullableJson<unknown>;
  checked_by: string | null;
  created_at: CreatedAt;
}

export const PLACE_KINDS = ['home', 'work', 'other'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface RiderPlacesTable {
  id: string;
  user_id: string;
  kind: PlaceKind;
  label: string | null;
  address: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

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

export interface ComplaintsTable {
  id: string;
  ride_id: string;
  rider_id: string;
  driver_id: string | null;
  type: ComplaintType;
  status: Generated<ComplaintStatus>;
  text: string;
  resolution: ComplaintResolution | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
  /** Up to three photos (uploads with the purpose complaint_photo). */
  photo_upload_ids: Generated<string[]>;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface ComplaintMessagesTable {
  id: string;
  complaint_id: string;
  author_id: string | null;
  author_role: 'rider' | 'admin';
  text: string;
  created_at: CreatedAt;
}

export interface RiderHiddenPlacesTable {
  user_id: string;
  /** lat,lng rounded to 4 decimals: how recent destinations are grouped. */
  place_key: string;
  /** When it was hidden: a later ride there shows it again. */
  created_at: Timestamp;
}

export interface DB {
  users: UsersTable;
  admins: AdminsTable;
  phone_verifications: PhoneVerificationsTable;
  sessions: SessionsTable;
  settings: SettingsTable;
  outbox: OutboxTable;
  outbox_deliveries: OutboxDeliveriesTable;
  cities: CitiesTable;
  drivers: DriversTable;
  vehicles: VehiclesTable;
  driver_documents: DriverDocumentsTable;
  driver_status_changes: DriverStatusChangesTable;
  driver_ledger: DriverLedgerTable;
  driver_passes: DriverPassesTable;
  quotes: QuotesTable;
  rides: RidesTable;
  ride_events: RideEventsTable;
  ride_offers: RideOffersTable;
  ride_pools: RidePoolsTable;
  route_fares: RouteFaresTable;
  ratings: RatingsTable;
  sos_events: SosEventsTable;
  tax_withholdings: TaxWithholdingsTable;
  push_devices: PushDevicesTable;
  notifications: NotificationsTable;
  uploads: UploadsTable;
  payment_intents: PaymentIntentsTable;
  payment_transactions: PaymentTransactionsTable;
  driver_appeals: DriverAppealsTable;
  intercity_points: IntercityPointsTable;
  intercity_fares: IntercityFaresTable;
  intercity_trips: IntercityTripsTable;
  intercity_bookings: IntercityBookingsTable;
  fiscal_receipts: FiscalReceiptsTable;
  licence_checks: LicenceChecksTable;
  rider_places: RiderPlacesTable;
  complaints: ComplaintsTable;
  complaint_messages: ComplaintMessagesTable;
  rider_hidden_places: RiderHiddenPlacesTable;
}
