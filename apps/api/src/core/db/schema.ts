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
export type LedgerKind = 'topup' | 'commission' | 'tax' | 'pass' | 'adjustment';
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
  updated_at: Timestamp;
}

export interface DriverDocumentsTable {
  driver_id: string;
  kind: DocumentKind;
  url: string;
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
}
