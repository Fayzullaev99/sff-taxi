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

export interface DB {
  users: UsersTable;
  admins: AdminsTable;
  phone_verifications: PhoneVerificationsTable;
  sessions: SessionsTable;
  settings: SettingsTable;
  outbox: OutboxTable;
  outbox_deliveries: OutboxDeliveriesTable;
  cities: CitiesTable;
}
