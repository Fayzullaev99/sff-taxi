-- Two more taxi classes next to Ekonom and Komfort (docs/architecture.md §4, §6, §7):
-- Miniven (6-7 passenger seats, up to 6 people and big luggage) and Biznes (premium cars,
-- at most 3 years old, a 4.8+ driver). Each has its own tariff block with an operator's
-- switch (src/lib/tariff.ts: stored tariffs without the new blocks derive them from economy,
-- switched off); the rules for cars are in src/lib/driver-rules.ts, which car takes which
-- ride in src/lib/ride-classes.ts.

-- Cars: the new classes; a minivan has 6-7 passenger seats, any other car at most 4.
ALTER TABLE vehicles DROP CONSTRAINT vehicles_class_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_class_check
  CHECK (class IN ('economy', 'comfort', 'minivan', 'business'));
ALTER TABLE vehicles DROP CONSTRAINT vehicles_seats_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_seats_check
  CHECK (seats BETWEEN 1 AND 7 AND (class = 'minivan' OR seats <= 4));

-- A higher class's driver may take lower classes' rides ("upgrade down"): null = the class's
-- default (on for comfort, as before this column existed; off for business and minivan).
ALTER TABLE drivers ADD COLUMN takes_lower_classes boolean;

-- Rides: the new classes; a minivan ride carries up to 6 people, any other at most 3 (one in
-- front, two in the back).
ALTER TABLE rides DROP CONSTRAINT rides_class_check;
ALTER TABLE rides ADD CONSTRAINT rides_class_check
  CHECK (class IN ('economy', 'comfort', 'minivan', 'business', 'cargo_s', 'cargo_m'));
ALTER TABLE rides DROP CONSTRAINT rides_passengers_check;
ALTER TABLE rides ADD CONSTRAINT rides_passengers_check
  CHECK (passengers BETWEEN 1 AND 6 AND (class = 'minivan' OR passengers <= 3));

-- A trip on the board carries its car's class; route prices may be set per class.
ALTER TABLE intercity_trips DROP CONSTRAINT intercity_trips_class_check;
ALTER TABLE intercity_trips ADD CONSTRAINT intercity_trips_class_check
  CHECK (class IN ('economy', 'comfort', 'minivan', 'business'));
ALTER TABLE route_fares DROP CONSTRAINT route_fares_class_check;
ALTER TABLE route_fares ADD CONSTRAINT route_fares_class_check
  CHECK (class IN ('economy', 'comfort', 'minivan', 'business'));

-- The seating rule in the database (0015), now by the car's class: a minivan carries its
-- seats (at most 6), any other car at most 3 (src/lib/ride-classes.ts carCapacityFor).
CREATE OR REPLACE FUNCTION rides_seating_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap   int;
  extra int;
  used  int;
BEGIN
  IF NEW.driver_id IS NULL
     OR NEW.status NOT IN ('driver_assigned', 'driver_arrived', 'in_progress') THEN
    RETURN NEW;
  END IF;
  SELECT LEAST(COALESCE(v.seats, 3), CASE WHEN v.class = 'minivan' THEN 6 ELSE 3 END),
         d.extra_passengers
    INTO cap, extra
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
