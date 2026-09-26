-- Notifications: Expo push to the rider and driver apps, SMS to riders who ordered by phone
-- and to operators on SOS. Same model as SFF Eats (migrations/0009_notifications.sql).

-- Expo push tokens of the apps. A token belongs to one install; when another account
-- signs in on the same phone the token moves to it.
CREATE TABLE push_devices (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 1 AND 200),
  app          text NOT NULL CHECK (app IN ('rider', 'driver')),
  platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  locale       text NOT NULL DEFAULT 'uz' CHECK (locale IN ('uz', 'ru')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id, app);

-- One row per (event, recipient, channel): outbox retries do not send twice.
-- sent; failed = gave up on this recipient; skipped = nothing to send to (no device).
CREATE TABLE notifications (
  id           uuid PRIMARY KEY,
  dedupe_key   text NOT NULL UNIQUE,
  user_id      uuid REFERENCES users (id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('push', 'sms')),
  kind         text NOT NULL,
  ride_id      uuid REFERENCES rides (id) ON DELETE SET NULL,
  status       text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error        text,
  provider_ref text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_ride_idx ON notifications (ride_id) WHERE ride_id IS NOT NULL;
