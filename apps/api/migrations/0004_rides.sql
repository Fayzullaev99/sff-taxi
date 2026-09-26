-- Rides: fixed-price quotes, the ride state machine with its event history, dispatch offers,
-- ratings both ways, SOS alerts and the 1% tax withheld per ride (docs/architecture.md).
--
-- searching -> driver_assigned -> driver_arrived -> in_progress -> completed
-- searching | driver_assigned | driver_arrived -> cancelled (rider, driver no-show, operator, system)
-- driver_assigned | driver_arrived -> searching (the driver dropped the ride: dispatch again)
-- in_progress -> cancelled (operators only)

-- A price shown to the rider before ordering. Ordering references it, so the fare the rider
-- saw is exactly the fare of the ride: no surge, no recalculation.
CREATE TABLE quotes (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  city_id     uuid NOT NULL REFERENCES cities (id),
  pickup_lat  double precision NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng  double precision NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  dropoff_lat double precision NOT NULL CHECK (dropoff_lat BETWEEN -90 AND 90),
  dropoff_lng double precision NOT NULL CHECK (dropoff_lng BETWEEN -180 AND 180),
  options     text[] NOT NULL DEFAULT '{}',
  distance_m  int NOT NULL CHECK (distance_m >= 0),
  duration_s  int CHECK (duration_s >= 0),
  -- osrm or estimate (straight line x detour factor)
  route_source text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('city', 'intercity')),
  -- the fare of each class (src/lib/tariff.ts Fare)
  fares       jsonb NOT NULL,
  -- the tariff the fares came from: waiting and cancellation of the ride follow it too
  tariff      jsonb NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_user_idx ON quotes (user_id, created_at DESC);

CREATE SEQUENCE ride_number_seq START 10001;

CREATE TABLE rides (
  id                 uuid PRIMARY KEY,
  -- short number people say on the phone
  number             bigint NOT NULL UNIQUE DEFAULT nextval('ride_number_seq'),
  rider_id           uuid NOT NULL REFERENCES users (id),
  rider_phone        text NOT NULL CHECK (rider_phone ~ '^\+998\d{9}$'),
  rider_name         text CHECK (char_length(rider_name) <= 100),
  -- app: the rider ordered; phone: an operator ordered for a caller
  channel            text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'phone')),
  created_by         uuid NOT NULL REFERENCES users (id),
  -- the app's idempotency key: a retried request returns the same ride
  client_request_id  uuid,
  quote_id           uuid REFERENCES quotes (id),
  city_id            uuid NOT NULL REFERENCES cities (id),
  kind               text NOT NULL CHECK (kind IN ('city', 'intercity')),
  class              text NOT NULL CHECK (class IN ('economy', 'comfort')),
  -- {address, landmark} as given: "Guliston bozori, orientir: markaziy darvoza"
  pickup             jsonb NOT NULL,
  pickup_lat         double precision NOT NULL,
  pickup_lng         double precision NOT NULL,
  dropoff            jsonb NOT NULL,
  dropoff_lat        double precision NOT NULL,
  dropoff_lng        double precision NOT NULL,
  options            text[] NOT NULL DEFAULT '{}'
                       CHECK (options <@ ARRAY['child_seat', 'luggage', 'pets', 'ac']::text[]),
  comment            text CHECK (char_length(comment) <= 500),
  distance_m         int NOT NULL CHECK (distance_m >= 0),
  duration_s         int CHECK (duration_s >= 0),
  -- the quoted fare breakdown and the tariff snapshot (waiting, cancellation fee)
  fare               jsonb NOT NULL,
  tariff             jsonb NOT NULL,
  fare_quoted        bigint NOT NULL CHECK (fare_quoted >= 0),
  -- paid waiting after the free minutes, fixed when the trip starts
  waiting_fee        bigint NOT NULL DEFAULT 0 CHECK (waiting_fee >= 0),
  -- what the rider pays: quoted fare + waiting, set on completion
  fare_total         bigint CHECK (fare_total >= 0),
  -- owed by a rider who cancelled after the driver waited, or did not show up
  cancellation_fee   bigint NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
  -- the driver's platform fee and the withheld tax for this ride (ledger has the entries)
  commission         bigint NOT NULL DEFAULT 0 CHECK (commission >= 0),
  commission_note    text,
  tax                bigint NOT NULL DEFAULT 0 CHECK (tax >= 0),
  payment_method     text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card')),
  payment_status     text NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending', 'paid', 'not_charged')),
  status             text NOT NULL CHECK (status IN (
                       'searching', 'driver_assigned', 'driver_arrived', 'in_progress',
                       'completed', 'cancelled')),
  driver_id          uuid REFERENCES drivers (user_id),
  -- the car as it was when assigned: make, model, colour, plate
  vehicle            jsonb,
  -- dispatch progress: direct offers one by one, then broadcast, then operators
  dispatch_stage     text NOT NULL DEFAULT 'direct'
                       CHECK (dispatch_stage IN ('direct', 'broadcast', 'operator')),
  direct_offers      int NOT NULL DEFAULT 0 CHECK (direct_offers >= 0),
  broadcast_at       timestamptz,
  attention_at       timestamptz,
  cancelled_by       text CHECK (cancelled_by IN ('rider', 'driver', 'operator', 'system')),
  cancel_reason      text CHECK (char_length(cancel_reason) <= 300),
  -- share-trip link token; the link stops working when the ride ends
  share_token        text UNIQUE,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  assigned_at        timestamptz,
  arrived_at         timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rider_id, client_request_id),
  CHECK (status NOT IN ('driver_assigned', 'driver_arrived', 'in_progress', 'completed')
         OR driver_id IS NOT NULL),
  CHECK (status <> 'completed' OR fare_total IS NOT NULL)
);
-- A driver never has two active rides and a rider never two open ones, whatever races
-- happen in the application.
CREATE UNIQUE INDEX rides_one_active_per_driver ON rides (driver_id)
  WHERE status IN ('driver_assigned', 'driver_arrived', 'in_progress');
CREATE UNIQUE INDEX rides_one_open_per_rider ON rides (rider_id)
  WHERE status IN ('searching', 'driver_assigned', 'driver_arrived', 'in_progress');
CREATE INDEX rides_rider_idx ON rides (rider_id, requested_at DESC);
CREATE INDEX rides_driver_idx ON rides (driver_id, requested_at DESC);
CREATE INDEX rides_searching_idx ON rides (requested_at) WHERE status = 'searching';
CREATE INDEX rides_open_idx ON rides (status, requested_at)
  WHERE status IN ('searching', 'driver_assigned', 'driver_arrived', 'in_progress');

-- Everything that happened to a ride, who did it and why.
CREATE TABLE ride_events (
  id         uuid PRIMARY KEY,
  ride_id    uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  type       text NOT NULL,
  actor      text NOT NULL CHECK (actor IN ('rider', 'driver', 'operator', 'system')),
  actor_id   uuid REFERENCES users (id),
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_ride_idx ON ride_events (ride_id, created_at, id);

-- Offers made to drivers. direct: one driver at a time with a short timeout; broadcast: all
-- free drivers nearby, the first to accept wins.
CREATE TABLE ride_offers (
  id           uuid PRIMARY KEY,
  ride_id      uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  driver_id    uuid NOT NULL REFERENCES drivers (user_id),
  kind         text NOT NULL CHECK (kind IN ('direct', 'broadcast')),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  -- road ETA to the pickup and how it was ranked
  eta_s        int,
  distance_m   int,
  score        int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz
);
-- a driver sees at most one offer at a time
CREATE UNIQUE INDEX ride_offers_one_pending_per_driver ON ride_offers (driver_id)
  WHERE status = 'pending';
CREATE INDEX ride_offers_ride_idx ON ride_offers (ride_id, created_at);
CREATE INDEX ride_offers_pending_idx ON ride_offers (expires_at) WHERE status = 'pending';

ALTER TABLE driver_ledger
  ADD CONSTRAINT driver_ledger_ride_fk FOREIGN KEY (ride_id) REFERENCES rides (id);

-- Riders' side of trust: their rating from drivers and no-shows.
ALTER TABLE users
  ADD COLUMN rider_rating_sum   int NOT NULL DEFAULT 0 CHECK (rider_rating_sum >= 0),
  ADD COLUMN rider_rating_count int NOT NULL DEFAULT 0 CHECK (rider_rating_count >= 0),
  ADD COLUMN no_show_count      int NOT NULL DEFAULT 0 CHECK (no_show_count >= 0);

-- Ratings both ways, once per side per completed ride.
CREATE TABLE ratings (
  id          uuid PRIMARY KEY,
  ride_id     uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('rider', 'driver')),
  author_id   uuid NOT NULL REFERENCES users (id),
  subject_id  uuid NOT NULL REFERENCES users (id),
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags        text[] NOT NULL DEFAULT '{}',
  comment     text CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, author_role)
);
CREATE INDEX ratings_subject_idx ON ratings (subject_id, created_at DESC);

-- SOS pressed in a ride: logged and sent to operators at once; closed by an operator.
CREATE TABLE sos_events (
  id              uuid PRIMARY KEY,
  ride_id         uuid NOT NULL REFERENCES rides (id),
  user_id         uuid NOT NULL REFERENCES users (id),
  role            text NOT NULL CHECK (role IN ('rider', 'driver')),
  lat             double precision,
  lng             double precision,
  note            text CHECK (char_length(note) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users (id),
  resolution_note text CHECK (char_length(resolution_note) <= 500)
);
CREATE INDEX sos_events_open_idx ON sos_events (created_at) WHERE resolved_at IS NULL;

-- The self-employed driver's 1% turnover tax the platform withholds as tax agent
-- (PP-247, 12.08.2025) and remits by the 15th of the next month: one row per ride.
CREATE TABLE tax_withholdings (
  id             uuid PRIMARY KEY,
  ride_id        uuid NOT NULL UNIQUE REFERENCES rides (id),
  driver_id      uuid NOT NULL REFERENCES drivers (user_id),
  pinfl          text NOT NULL CHECK (pinfl ~ '^\d{14}$'),
  -- Tashkent calendar month of the ride, YYYY-MM
  period         text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  base_amount    bigint NOT NULL CHECK (base_amount >= 0),
  rate_percent   numeric(5, 2) NOT NULL CHECK (rate_percent >= 0),
  amount         bigint NOT NULL CHECK (amount >= 0),
  ledger_id      uuid REFERENCES driver_ledger (id),
  remitted_at    timestamptz,
  remittance_ref text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tax_withholdings_period_idx ON tax_withholdings (period, driver_id);
