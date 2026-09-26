-- What the rider app and the operator panel reported missing after their first release.

-- Riders' saved places (home, work and up to 18 others): one tap to order from or to them.
CREATE TABLE rider_places (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('home', 'work', 'other')),
  label      text CHECK (char_length(label) BETWEEN 1 AND 60),
  address    text CHECK (char_length(address) <= 300),
  landmark   text CHECK (char_length(landmark) <= 200),
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_places_user_idx ON rider_places (user_id, created_at);
-- one home and one work per rider
CREATE UNIQUE INDEX rider_places_one_home_work ON rider_places (user_id, kind)
  WHERE kind IN ('home', 'work');

-- Phone orders are idempotent per operator (a double click in the panel): the same request id
-- from the same operator is the same ride.
CREATE UNIQUE INDEX rides_phone_request_idx ON rides (created_by, client_request_id)
  WHERE channel = 'phone' AND client_request_id IS NOT NULL;
-- operators' ride lists by driver and by day
CREATE INDEX rides_requested_idx ON rides (requested_at DESC, id DESC);

-- Complaints (support tickets) about a ride, mirrored on SFF Eats' complaints: the rider
-- writes, operators answer in a thread and resolve with an outcome the rider sees.
CREATE TABLE complaints (
  id              uuid PRIMARY KEY,
  ride_id         uuid NOT NULL REFERENCES rides (id),
  rider_id        uuid NOT NULL REFERENCES users (id),
  -- the driver of the ride when the complaint was opened
  driver_id       uuid REFERENCES users (id),
  type            text NOT NULL CHECK (type IN (
                    'lost_item', 'driver_behaviour', 'route', 'price', 'car_condition',
                    'safety', 'other')),
  -- open -> in_progress (an operator answered) -> resolved
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  text            text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  resolution      text CHECK (resolution IN (
                    'item_returned', 'refund', 'driver_warned', 'driver_blocked', 'rejected',
                    'no_action')),
  resolution_note text CHECK (char_length(resolution_note) <= 1000),
  resolved_by     uuid REFERENCES users (id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX complaints_status_idx ON complaints (status, id);
CREATE INDEX complaints_ride_idx ON complaints (ride_id);
CREATE INDEX complaints_rider_idx ON complaints (rider_id, id);
CREATE INDEX complaints_driver_idx ON complaints (driver_id, id);
-- one open complaint of a kind per ride
CREATE UNIQUE INDEX complaints_one_open_per_type ON complaints (ride_id, type)
  WHERE status <> 'resolved';

CREATE TABLE complaint_messages (
  id           uuid PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users (id),
  author_role  text NOT NULL CHECK (author_role IN ('rider', 'admin')),
  text         text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX complaint_messages_complaint_idx ON complaint_messages (complaint_id, created_at);

-- operators' ratings list: the low ones first
CREATE INDEX ratings_created_idx ON ratings (created_at DESC, id DESC);
