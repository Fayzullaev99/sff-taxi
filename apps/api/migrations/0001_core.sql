-- SFF Taxi core schema: accounts, sessions, platform settings and the outbox.
--
-- Money is whole so'm in bigint (UZS has no subunit in circulation).
-- Coordinates are WGS84 degrees in double precision; distances are computed in SQL
-- with the haversine formula (taxi_distance_m) — no PostGIS dependency.
-- Timestamps are UTC (timestamptz); "Tashkent time" is UTC+5 all year.

-- Accounts --------------------------------------------------------------------------
-- One account per phone number. The same account can ride, drive (a row in `drivers`)
-- and dispatch (a row in `admins`); each app signs in with its own session.

CREATE TABLE users (
  id         uuid PRIMARY KEY,
  phone      text NOT NULL UNIQUE CHECK (phone ~ '^\+998\d{9}$'),
  full_name  text CHECK (char_length(full_name) BETWEEN 1 AND 100),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Platform operators (dispatch, driver verification, support).
CREATE TABLE admins (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE phone_verifications (
  id                  uuid PRIMARY KEY,
  phone               text NOT NULL,
  code_hash           bytea NOT NULL,
  attempts            int NOT NULL DEFAULT 0,
  expires_at          timestamptz NOT NULL,
  verified_at         timestamptz,
  ip                  inet,
  provider            text,
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_verifications_phone_idx ON phone_verifications (phone, created_at DESC);

-- Refresh-token sessions. A presented refresh token is rotated; reuse of a rotated
-- token revokes the whole family (stolen-token detection).
CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   bytea NOT NULL,
  client       text NOT NULL CHECK (client IN ('rider', 'driver', 'admin')),
  expires_at   timestamptz NOT NULL,
  rotated_at   timestamptz,
  revoked_at   timestamptz,
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_family_idx ON sessions (family_id);

-- Platform settings: one validated JSON document per key (src/modules/settings).
-- A missing key means "use the built-in default".
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Outbox: events written in the same transaction as the change they describe, then
-- delivered by the worker (dispatch, realtime, push/SMS notifications, ...).
CREATE TABLE outbox (
  id              uuid PRIMARY KEY,
  topic           text NOT NULL,
  payload         jsonb NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (next_attempt_at) WHERE processed_at IS NULL;

-- Which handlers already processed an event: when one handler fails, a retry
-- runs only the handlers that have not succeeded yet.
CREATE TABLE outbox_deliveries (
  event_id     uuid NOT NULL REFERENCES outbox (id) ON DELETE CASCADE,
  handler      text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, handler)
);

-- Helpers --------------------------------------------------------------------------

-- Great-circle distance in metres; the same formula as distanceM() in src/lib/distance.ts.
CREATE FUNCTION taxi_distance_m(lat1 double precision, lng1 double precision,
                                lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Runtime role access ----------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO taxi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taxi_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO taxi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taxi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO taxi_app;
