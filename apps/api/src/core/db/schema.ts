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
  created_at: CreatedAt;
}

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
  'topup' | 'commission' | 'tax' | 'pass' | 'adjustment' | 'card_fare' | 'payout';
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
  ride_id: string;
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

export const UPLOAD_PURPOSES = ['document', 'profile_photo', 'vehicle_photo'] as const;
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
  purpose: 'ride' | 'topup';
  ride_id: string | null;
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
  ratings: RatingsTable;
  sos_events: SosEventsTable;
  tax_withholdings: TaxWithholdingsTable;
  push_devices: PushDevicesTable;
  notifications: NotificationsTable;
  uploads: UploadsTable;
  payment_intents: PaymentIntentsTable;
  payment_transactions: PaymentTransactionsTable;
}
