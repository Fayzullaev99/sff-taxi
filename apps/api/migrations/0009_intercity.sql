-- Intercity trip board (market analysis §6.4 "hybrid trip board", R6/D4/O6): drivers publish
-- departures between towns, riders book seats (the front seat costs more), operators book
-- for callers. Seat prices come from the tariff (whole car per km x seat share) or an
-- operator's route price, and a driver may move them within a band (±15%).

-- Where trips start and end: the Sirdaryo towns (the cities table) and Tashkent.
CREATE TABLE intercity_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_uz       text NOT NULL CHECK (char_length(name_uz) BETWEEN 1 AND 100),
  name_ru       text NOT NULL CHECK (char_length(name_ru) BETWEEN 1 AND 100),
  lat           double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  city_id       uuid REFERENCES cities (id),
  -- where cars for other towns gather; a driver may name another place per trip
  meeting_point text NOT NULL CHECK (char_length(meeting_point) BETWEEN 3 AND 200),
  is_active     boolean NOT NULL DEFAULT true,
  sort          int NOT NULL DEFAULT 0
);

INSERT INTO intercity_points (slug, name_uz, name_ru, lat, lng, city_id, meeting_point, sort)
SELECT c.slug, c.name_uz, c.name_ru, c.center_lat, c.center_lng, c.id,
       CASE c.slug
         WHEN 'guliston' THEN 'Guliston avtovokzali'
         ELSE c.name_uz || ' markazi, bozor yonida'
       END,
       c.sort
FROM cities c;
-- In Tashkent, cars for the Sirdaryo direction gather near Olmazor (market analysis §3).
INSERT INTO intercity_points (slug, name_uz, name_ru, lat, lng, meeting_point, sort)
VALUES ('toshkent', 'Toshkent', 'Ташкент', 41.2995, 69.2401,
        'Olmazor, Sirdaryo yo‘nalishi avtoturargohi', 0);

-- Route seat prices set by operators (market analysis §6.3: Guliston->Tashkent 70 000 rear,
-- 80 000 front, a hypothesis to validate in the field). Without one, the tariff decides.
CREATE TABLE intercity_fares (
  from_point_id uuid NOT NULL REFERENCES intercity_points (id),
  to_point_id   uuid NOT NULL REFERENCES intercity_points (id),
  price_rear    bigint NOT NULL CHECK (price_rear > 0),
  price_front   bigint NOT NULL CHECK (price_front >= price_rear),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_point_id, to_point_id),
  CHECK (from_point_id <> to_point_id)
);
INSERT INTO intercity_fares (from_point_id, to_point_id, price_rear, price_front)
SELECT a.id, b.id, 70000, 80000
FROM intercity_points a, intercity_points b
WHERE (a.slug, b.slug) IN (('guliston', 'toshkent'), ('toshkent', 'guliston'));

CREATE SEQUENCE intercity_trip_number_seq START 5001;

-- A departure a driver published.
-- scheduled (booking open) -> boarding (at the meeting point) -> departed -> arrived;
-- scheduled | boarding -> cancelled (driver or operator)
CREATE TABLE intercity_trips (
  id               uuid PRIMARY KEY,
  number           bigint NOT NULL UNIQUE DEFAULT nextval('intercity_trip_number_seq'),
  driver_id        uuid NOT NULL REFERENCES drivers (user_id),
  from_point_id    uuid NOT NULL REFERENCES intercity_points (id),
  to_point_id      uuid NOT NULL REFERENCES intercity_points (id),
  departure_at     timestamptz NOT NULL,
  meeting_point    text NOT NULL CHECK (char_length(meeting_point) BETWEEN 3 AND 200),
  comment          text CHECK (char_length(comment) <= 500),
  class            text NOT NULL CHECK (class IN ('economy', 'comfort')),
  -- the car as it was when published: make, model, colour, plate
  vehicle          jsonb NOT NULL,
  distance_m       int NOT NULL CHECK (distance_m > 0),
  -- seats offered (the front one included when front_seat is true)
  seats_total      smallint NOT NULL CHECK (seats_total BETWEEN 1 AND 4),
  seats_booked     smallint NOT NULL DEFAULT 0,
  front_seat       boolean NOT NULL,
  front_booked     boolean NOT NULL DEFAULT false,
  -- per seat, fixed when published: what every booking pays
  price_rear       bigint NOT NULL CHECK (price_rear > 0),
  price_front      bigint NOT NULL CHECK (price_front >= price_rear),
  -- the tariff/route reference the driver's prices were checked against
  reference_rear   bigint NOT NULL CHECK (reference_rear > 0),
  status           text NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'boarding', 'departed', 'arrived', 'cancelled')),
  cancelled_by     text CHECK (cancelled_by IN ('driver', 'operator')),
  cancel_reason    text CHECK (char_length(cancel_reason) <= 300),
  boarding_at      timestamptz,
  departed_at      timestamptz,
  arrived_at       timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_point_id <> to_point_id),
  -- seat counting holds whatever races happen in the application
  CHECK (seats_booked BETWEEN 0 AND seats_total),
  CHECK (front_seat OR NOT front_booked)
);
-- the board: open departures of a route, soonest first
CREATE INDEX intercity_trips_board_idx ON intercity_trips (from_point_id, to_point_id, departure_at)
  WHERE status IN ('scheduled', 'boarding');
CREATE INDEX intercity_trips_driver_idx ON intercity_trips (driver_id, departure_at DESC);
-- a driver is on the road with one trip at a time
CREATE UNIQUE INDEX intercity_trips_one_underway ON intercity_trips (driver_id)
  WHERE status IN ('boarding', 'departed');

-- Seats a rider booked on a trip (by the app or through an operator).
-- booked -> boarded -> completed;  booked -> cancelled | no_show
CREATE TABLE intercity_bookings (
  id                 uuid PRIMARY KEY,
  number             bigint NOT NULL UNIQUE DEFAULT nextval('ride_number_seq'),
  trip_id            uuid NOT NULL REFERENCES intercity_trips (id),
  rider_id           uuid NOT NULL REFERENCES users (id),
  rider_phone        text NOT NULL CHECK (rider_phone ~ '^\+998\d{9}$'),
  rider_name         text CHECK (char_length(rider_name) <= 100),
  channel            text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'phone')),
  created_by         uuid NOT NULL REFERENCES users (id),
  client_request_id  uuid,
  seats              smallint NOT NULL CHECK (seats BETWEEN 1 AND 4),
  -- one of the seats is the front one
  front              boolean NOT NULL DEFAULT false,
  -- what the rider pays the driver in cash: rear seats + the front seat, fixed at booking
  price              bigint NOT NULL CHECK (price > 0),
  pickup_note        text CHECK (char_length(pickup_note) <= 300),
  status             text NOT NULL DEFAULT 'booked'
                       CHECK (status IN ('booked', 'boarded', 'completed', 'cancelled', 'no_show')),
  cancelled_by       text CHECK (cancelled_by IN ('rider', 'driver', 'operator')),
  cancel_reason      text CHECK (char_length(cancel_reason) <= 300),
  -- a late cancellation owes this (recorded; collected like other cancellation fees)
  cancellation_fee   bigint NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
  -- the driver's platform fee and the withheld tax for this booking (ledger has the entries)
  commission         bigint NOT NULL DEFAULT 0 CHECK (commission >= 0),
  commission_note    text,
  tax                bigint NOT NULL DEFAULT 0 CHECK (tax >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  boarded_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rider_id, client_request_id),
  CHECK (NOT front OR seats >= 1)
);
-- one live booking per rider per trip (more seats go in the same booking)
CREATE UNIQUE INDEX intercity_bookings_one_per_rider ON intercity_bookings (trip_id, rider_id)
  WHERE status IN ('booked', 'boarded');
-- the front seat is sold once
CREATE UNIQUE INDEX intercity_bookings_one_front ON intercity_bookings (trip_id)
  WHERE front AND status IN ('booked', 'boarded');
CREATE INDEX intercity_bookings_trip_idx ON intercity_bookings (trip_id, created_at);
CREATE INDEX intercity_bookings_rider_idx ON intercity_bookings (rider_id, created_at DESC);

-- Charges and the withheld tax are per ride or per booking.
ALTER TABLE driver_ledger ADD COLUMN booking_id uuid REFERENCES intercity_bookings (id);
CREATE UNIQUE INDEX driver_ledger_booking_kind_idx ON driver_ledger (booking_id, kind)
  WHERE booking_id IS NOT NULL;
ALTER TABLE tax_withholdings ALTER COLUMN ride_id DROP NOT NULL;
ALTER TABLE tax_withholdings ADD COLUMN booking_id uuid UNIQUE REFERENCES intercity_bookings (id);
ALTER TABLE tax_withholdings ADD CONSTRAINT tax_withholdings_source_check
  CHECK ((ride_id IS NULL) <> (booking_id IS NULL));
