-- Wave 4 (docs/shared-rides.md): shared rides ("Hamroh bilan"), the seating rule, the female
-- driver preference, fixed route fares between towns and districts, deposits for bookings
-- made in advance, and the service a ride is for (taxi now; cargo and delivery next).

-- Seating rule -----------------------------------------------------------------------------
-- One passenger in front and never more than two in the back: at most 3 passengers per car,
-- whatever the car's registered seats (src/lib/pool.ts MAX_PASSENGERS).

-- Genders: riders declare their own (the female-driver option is offered to women), operators
-- verify drivers' against the passport.
ALTER TABLE users
  ADD COLUMN gender text CHECK (gender IN ('female', 'male')),
  ADD COLUMN gender_set_at timestamptz;

ALTER TABLE drivers
  ADD COLUMN gender text CHECK (gender IN ('female', 'male')),
  ADD COLUMN gender_verified_at timestamptz,
  ADD COLUMN gender_verified_by uuid REFERENCES users (id),
  -- a verified woman driver may take women riders only
  ADD COLUMN women_riders_only boolean NOT NULL DEFAULT false,
  -- takes other riders who agreed to share while carrying someone
  ADD COLUMN pool_enabled boolean NOT NULL DEFAULT false,
  -- people in the car riding without the app (the driver's own count), shown to riders
  ADD COLUMN extra_passengers smallint NOT NULL DEFAULT 0 CHECK (extra_passengers BETWEEN 0 AND 3),
  -- where the driver is heading (home, or the people in the car): offers only on the way
  ADD COLUMN destination jsonb,
  ADD COLUMN destination_lat double precision CHECK (destination_lat BETWEEN -90 AND 90),
  ADD COLUMN destination_lng double precision CHECK (destination_lng BETWEEN -180 AND 180),
  ADD COLUMN destination_set_at timestamptz,
  ADD CONSTRAINT drivers_destination_check
    CHECK ((destination_lat IS NULL) = (destination_lng IS NULL)
       AND (destination_lat IS NULL) = (destination IS NULL)),
  -- people without the app in the car: the driver must say where they are going
  ADD CONSTRAINT drivers_extra_needs_destination_check
    CHECK (extra_passengers = 0 OR destination_lat IS NOT NULL),
  ADD CONSTRAINT drivers_women_riders_only_check
    CHECK (NOT women_riders_only OR (gender = 'female' AND gender_verified_at IS NOT NULL)),
  ADD CONSTRAINT drivers_gender_verified_check
    CHECK (gender_verified_at IS NULL OR gender IS NOT NULL);

-- Fixed route fares ----------------------------------------------------------------------
-- Operators fix the price between two towns/districts (Yangiyer -> Guliston 10 000 per seat):
-- per km a long ride costs too much for one person. A point's zone is its town boundary
-- (the cities row) widened by zone_radius_m, or a circle around it (Tashkent).
ALTER TABLE intercity_points
  ADD COLUMN zone_radius_m int NOT NULL DEFAULT 3000 CHECK (zone_radius_m BETWEEN 200 AND 50000);
UPDATE intercity_points SET zone_radius_m = 15000 WHERE slug = 'toshkent';

CREATE TABLE route_fares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_point_id uuid NOT NULL REFERENCES intercity_points (id),
  to_point_id   uuid NOT NULL REFERENCES intercity_points (id),
  class         text NOT NULL DEFAULT 'economy' CHECK (class IN ('economy', 'comfort')),
  -- one person in a shared car (the car takes others going the same way)
  seat_price    bigint CHECK (seat_price > 0),
  -- the whole car, nobody else taken; null = the tariff's per-km price
  car_price     bigint CHECK (car_price > 0),
  is_active     boolean NOT NULL DEFAULT true,
  updated_by    uuid REFERENCES users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_point_id, to_point_id, class),
  CHECK (from_point_id <> to_point_id),
  CHECK (seat_price IS NOT NULL OR car_price IS NOT NULL),
  CHECK (car_price IS NULL OR seat_price IS NULL OR car_price >= seat_price)
);
-- The founder's example (a hypothesis to check in the field): Yangiyer <-> Guliston 10 000 per
-- seat; Guliston <-> Tashkent as on the trip board.
INSERT INTO route_fares (from_point_id, to_point_id, seat_price)
SELECT a.id, b.id, p.price
FROM (VALUES ('yangiyer', 'guliston', 10000), ('guliston', 'yangiyer', 10000),
             ('guliston', 'toshkent', 70000), ('toshkent', 'guliston', 70000)) AS p (a, b, price)
JOIN intercity_points a ON a.slug = p.a
JOIN intercity_points b ON b.slug = p.b;

ALTER TABLE quotes
  -- the fixed route between the ends, when there is one: {id, from, to, seatPrice, carPrice}
  ADD COLUMN route jsonb;

-- Shared rides ---------------------------------------------------------------------------
-- A driver carrying several riders at once: their stops ahead, in order (src/lib/pool.ts).
CREATE TABLE ride_pools (
  id         uuid PRIMARY KEY,
  driver_id  uuid NOT NULL REFERENCES drivers (user_id),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  plan       jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(plan) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX ride_pools_one_open_per_driver ON ride_pools (driver_id) WHERE status = 'open';

ALTER TABLE rides
  -- taxi now; cargo and delivery use the same rides with their own classes
  ADD COLUMN service text NOT NULL DEFAULT 'taxi' CHECK (service IN ('taxi', 'cargo', 'delivery')),
  ADD COLUMN passengers smallint NOT NULL DEFAULT 1 CHECK (passengers BETWEEN 1 AND 3),
  -- the rider agreed to share the car with other riders going the same way
  ADD COLUMN shareable boolean NOT NULL DEFAULT false,
  -- a woman driver only (the rider declared themselves a woman)
  ADD COLUMN women_only boolean NOT NULL DEFAULT false,
  -- the rider's declared gender when ordering (women drivers may take women only)
  ADD COLUMN rider_gender text CHECK (rider_gender IN ('female', 'male')),
  -- car: the whole car (tariff or fixed); seat: fixed per-person price in a shared car
  ADD COLUMN fare_mode text NOT NULL DEFAULT 'car' CHECK (fare_mode IN ('car', 'seat')),
  ADD COLUMN route_fare_id uuid REFERENCES route_fares (id),
  ADD COLUMN pool_id uuid REFERENCES ride_pools (id),
  -- road metres this rider shared the car with other app riders (planned)
  ADD COLUMN pool_shared_m int NOT NULL DEFAULT 0 CHECK (pool_shared_m >= 0),
  -- the shared-ride discount, off the quoted fare
  ADD COLUMN pool_discount bigint NOT NULL DEFAULT 0 CHECK (pool_discount >= 0),
  -- paid in advance by card for a ride booked for later; the rest is cash to the driver
  ADD COLUMN deposit_amount bigint NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  -- the rider tells the driver this code before the trip starts (night, shared, women-only
  -- and intercity rides): the right rider in the right car
  ADD COLUMN start_pin text CHECK (start_pin ~ '^\d{4}$'),
  ADD CONSTRAINT rides_seat_is_shared_check CHECK (fare_mode = 'car' OR shareable),
  ADD CONSTRAINT rides_pool_discount_le_fare_check CHECK (pool_discount <= fare_quoted),
  ADD CONSTRAINT rides_deposit_le_fare_check CHECK (deposit_amount <= fare_quoted),
  ADD CONSTRAINT rides_pool_shared_check CHECK (pool_id IS NULL OR shareable);

-- One active ride per driver, except riders sharing a car (the same pool, checked below).
DROP INDEX rides_one_active_per_driver;
CREATE UNIQUE INDEX rides_one_active_per_driver ON rides (driver_id)
  WHERE status IN ('driver_assigned', 'driver_arrived', 'in_progress') AND pool_id IS NULL;
CREATE INDEX rides_pool_idx ON rides (pool_id) WHERE pool_id IS NOT NULL;
CREATE INDEX rides_driver_active_idx ON rides (driver_id)
  WHERE status IN ('driver_assigned', 'driver_arrived', 'in_progress');

-- The seating rule and "one car, one pool" in the database, whatever the application does:
-- the riders of a driver's active rides plus the people without the app never exceed
-- LEAST(seats, 3), and a driver's active rides are either one ride alone or all one pool.
CREATE FUNCTION rides_seating_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap   int;
  extra int;
  used  int;
BEGIN
  IF NEW.driver_id IS NULL
     OR NEW.status NOT IN ('driver_assigned', 'driver_arrived', 'in_progress') THEN
    RETURN NEW;
  END IF;
  SELECT LEAST(COALESCE(v.seats, 3), 3), d.extra_passengers INTO cap, extra
  FROM drivers d LEFT JOIN vehicles v ON v.driver_id = d.user_id
  WHERE d.user_id = NEW.driver_id;
  SELECT COALESCE(sum(r.passengers), 0) INTO used
  FROM rides r
  WHERE r.driver_id = NEW.driver_id AND r.id <> NEW.id
    AND r.status IN ('driver_assigned', 'driver_arrived', 'in_progress');
  IF used + NEW.passengers + COALESCE(extra, 0) > COALESCE(cap, 3) THEN
    RAISE EXCEPTION 'seating rule: % + % + % > %', used, NEW.passengers, extra, cap
      USING ERRCODE = 'SF001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM rides r
    WHERE r.driver_id = NEW.driver_id AND r.id <> NEW.id
      AND r.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
      AND (NEW.pool_id IS NULL OR r.pool_id IS DISTINCT FROM NEW.pool_id)
  ) THEN
    RAISE EXCEPTION 'driver % already has an active ride', NEW.driver_id USING ERRCODE = 'SF002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rides_seating_guard
  BEFORE INSERT OR UPDATE OF driver_id, status, passengers, pool_id ON rides
  FOR EACH ROW EXECUTE FUNCTION rides_seating_guard();

-- Offers of a ride on a car already carrying someone: the plan the driver would follow.
ALTER TABLE ride_offers
  ADD COLUMN pool_plan jsonb,
  ADD COLUMN detour_s int CHECK (detour_s >= 0);

-- Deposits for bookings in advance -------------------------------------------------------
-- A ride for later and a seat on the trip board are booked once part of the fare is paid by
-- card (admin/settings/booking); the rest is cash to the driver. The deposit is refunded when
-- the rider cancels in time or the platform cancels; otherwise it compensates the driver.
ALTER TABLE payment_intents
  ADD COLUMN booking_id uuid UNIQUE REFERENCES intercity_bookings (id);
ALTER TABLE payment_intents DROP CONSTRAINT payment_intents_purpose_check;
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_purpose_check
  CHECK (purpose IN ('ride', 'topup', 'booking'));
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_booking_check
  CHECK ((purpose = 'booking') = (booking_id IS NOT NULL));

ALTER TABLE intercity_bookings
  ADD COLUMN deposit_amount bigint NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  ADD CONSTRAINT intercity_bookings_deposit_check CHECK (deposit_amount <= price);
ALTER TABLE intercity_bookings DROP CONSTRAINT intercity_bookings_status_check;
ALTER TABLE intercity_bookings ADD CONSTRAINT intercity_bookings_status_check CHECK (status IN (
  'awaiting_payment', 'booked', 'boarded', 'completed', 'cancelled', 'no_show'));
ALTER TABLE intercity_bookings DROP CONSTRAINT intercity_bookings_cancelled_by_check;
ALTER TABLE intercity_bookings ADD CONSTRAINT intercity_bookings_cancelled_by_check
  CHECK (cancelled_by IN ('rider', 'driver', 'operator', 'system'));
-- a booking waiting for its deposit holds its seats (for the payment window)
DROP INDEX intercity_bookings_one_per_rider;
CREATE UNIQUE INDEX intercity_bookings_one_per_rider ON intercity_bookings (trip_id, rider_id)
  WHERE status IN ('awaiting_payment', 'booked', 'boarded');
DROP INDEX intercity_bookings_one_front;
CREATE UNIQUE INDEX intercity_bookings_one_front ON intercity_bookings (trip_id)
  WHERE front AND status IN ('awaiting_payment', 'booked', 'boarded');

-- The seating rule on the trip board too: 1 front + at most 2 rear seats offered. Trips
-- published before stay as they are (NOT VALID); new and edited ones are checked.
ALTER TABLE intercity_trips ADD CONSTRAINT intercity_trips_rear_seats_check
  CHECK (seats_total - (CASE WHEN front_seat THEN 1 ELSE 0 END) <= 2) NOT VALID;
ALTER TABLE intercity_bookings ADD CONSTRAINT intercity_bookings_seats_rule_check
  CHECK (seats <= 3) NOT VALID;

-- A deposit a rider lost (a late cancellation) is the waiting driver's money.
ALTER TABLE driver_ledger DROP CONSTRAINT driver_ledger_kind_check;
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_kind_check CHECK (kind IN (
  'topup', 'commission', 'tax', 'pass', 'adjustment', 'card_fare', 'payout', 'cancel_fee',
  'cancel_fee_collected', 'deposit'));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_deposit_check
  CHECK (kind <> 'deposit' OR amount > 0);
