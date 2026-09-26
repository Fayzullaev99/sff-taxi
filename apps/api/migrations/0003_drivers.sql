-- Drivers: the application with the documents Cabinet Resolution No. 200 (02.04.2025) asks
-- for, the car, operator verification with reasons, the shift and GPS position, and the
-- prepaid balance ledger fees and the withheld tax are taken from (docs/architecture.md).

CREATE TABLE drivers (
  user_id                 uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  full_name               text NOT NULL CHECK (char_length(full_name) BETWEEN 3 AND 100),
  -- Res. 200 cl. 10: 21 years or older
  birth_date              date NOT NULL,
  -- JShShIR: the self-employed driver's personal number; the 1% tax is withheld against it
  pinfl                   text NOT NULL UNIQUE CHECK (pinfl ~ '^\d{14}$'),
  -- driving licence ("haydovchilik guvohnomasi"): series + number, category B required
  licence_number          text NOT NULL UNIQUE CHECK (licence_number ~ '^[A-Z]{2}\d{7}$'),
  licence_categories      text[] NOT NULL CHECK ('B' = ANY (licence_categories)),
  -- Res. 200 cl. 10: at least 3 years of driving experience
  licence_issued_on       date NOT NULL,
  -- the passenger-transport licence card (Res. 200): no card, no rides
  licence_card_number     text NOT NULL UNIQUE CHECK (licence_card_number ~ '^[A-Z0-9-]{5,30}$'),
  licence_card_expires_on date NOT NULL,
  -- pending: applied, waiting for an operator; active: may drive; rejected: may re-apply;
  -- blocked: stopped by an operator (with a reason the driver sees)
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'active', 'rejected', 'blocked')),
  status_reason           text CHECK (char_length(status_reason) <= 500),
  approved_at             timestamptz,
  approved_by             uuid REFERENCES users (id),
  -- shift and position (the last fix that passed the GPS filter)
  is_online               boolean NOT NULL DEFAULT false,
  online_since            timestamptz,
  lat                     double precision CHECK (lat BETWEEN -90 AND 90),
  lng                     double precision CHECK (lng BETWEEN -180 AND 180),
  heading                 real,
  located_at              timestamptz,
  -- counters behind the transparent priority score (src/lib/priority.ts)
  offers_received         int NOT NULL DEFAULT 0 CHECK (offers_received >= 0),
  offers_accepted         int NOT NULL DEFAULT 0 CHECK (offers_accepted >= 0),
  rides_completed         int NOT NULL DEFAULT 0 CHECK (rides_completed >= 0),
  rides_cancelled         int NOT NULL DEFAULT 0 CHECK (rides_cancelled >= 0),
  rating_sum              int NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  rating_count            int NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_online OR status = 'active')
);
CREATE INDEX drivers_status_idx ON drivers (status, created_at);
-- dispatch looks at online drivers only
CREATE INDEX drivers_online_idx ON drivers (lat, lng) WHERE is_online;

-- The car. Res. 200: at most 4 passenger seats, not older than 15 years for city work,
-- no van-type cars (Damas/Labo) — enforced by the API, the seat limit here as well.
CREATE TABLE vehicles (
  driver_id  uuid PRIMARY KEY REFERENCES drivers (user_id) ON DELETE CASCADE,
  make       text NOT NULL CHECK (char_length(make) BETWEEN 2 AND 40),
  model      text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 40),
  colour     text NOT NULL CHECK (char_length(colour) BETWEEN 2 AND 30),
  -- Uzbek plate without spaces: "20A123BC" (private) or "20123ABC" (legal entity)
  plate      text NOT NULL UNIQUE CHECK (plate ~ '^\d{2}([A-Z]\d{3}[A-Z]{2}|\d{3}[A-Z]{3})$'),
  year       smallint NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  seats      smallint NOT NULL CHECK (seats BETWEEN 1 AND 4),
  class      text NOT NULL CHECK (class IN ('economy', 'comfort')),
  -- what the car offers for ride options
  features   text[] NOT NULL DEFAULT '{}'
               CHECK (features <@ ARRAY['ac', 'child_seat', 'pets', 'big_trunk']::text[]),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Document photos (URLs for now; uploads to object storage come with the driver app).
CREATE TABLE driver_documents (
  driver_id   uuid NOT NULL REFERENCES drivers (user_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN (
                'licence_card', 'driver_licence', 'passport', 'vehicle_registration',
                'insurance', 'vehicle_photo', 'selfie')),
  url         text NOT NULL CHECK (char_length(url) BETWEEN 10 AND 2000),
  expires_on  date,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, kind)
);

-- Every approval, rejection, block and unblock with who did it and why: drivers see the
-- reason, and a block can be appealed (market analysis §6.1 "transparent rules").
CREATE TABLE driver_status_changes (
  id          uuid PRIMARY KEY,
  driver_id   uuid NOT NULL REFERENCES drivers (user_id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status   text NOT NULL,
  reason      text CHECK (char_length(reason) <= 500),
  actor_id    uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_status_changes_driver_idx ON driver_status_changes (driver_id, created_at DESC);

-- Prepaid balance. Cash stays with the driver; the platform fee and the withheld tax are
-- debited here, top-ups credited. Append-only: a mistake is fixed with an adjustment entry,
-- and the balance is always the sum of the entries.
CREATE TABLE driver_ledger (
  id         uuid PRIMARY KEY,
  driver_id  uuid NOT NULL REFERENCES drivers (user_id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind IN ('topup', 'commission', 'tax', 'pass', 'adjustment')),
  amount     bigint NOT NULL CHECK (amount <> 0),
  ride_id    uuid,
  note       text CHECK (char_length(note) <= 300),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('commission', 'tax', 'pass') OR amount < 0),
  CHECK (kind <> 'topup' OR amount > 0)
);
CREATE INDEX driver_ledger_driver_idx ON driver_ledger (driver_id, created_at DESC);
-- a ride is charged each kind at most once, however often completion is retried
CREATE UNIQUE INDEX driver_ledger_ride_kind_idx ON driver_ledger (ride_id, kind)
  WHERE ride_id IS NOT NULL;

CREATE FUNCTION taxi_ledger_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'driver_ledger is append-only: add an adjustment entry instead'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER driver_ledger_append_only
  BEFORE UPDATE OR DELETE ON driver_ledger
  FOR EACH ROW EXECUTE FUNCTION taxi_ledger_append_only();
REVOKE UPDATE, DELETE ON driver_ledger FROM taxi_app;

-- Day and week passes: city rides without commission while the pass runs.
CREATE TABLE driver_passes (
  id         uuid PRIMARY KEY,
  driver_id  uuid NOT NULL REFERENCES drivers (user_id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind IN ('day', 'week')),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  price      bigint NOT NULL CHECK (price >= 0),
  ledger_id  uuid REFERENCES driver_ledger (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX driver_passes_driver_idx ON driver_passes (driver_id, ends_at DESC);
