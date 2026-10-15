-- Ordering for someone else ("Boshqa odam uchun", docs/architecture.md §5): the rider (or an
-- operator) orders, tracks and pays; the passenger is a name and a phone. The driver sees and
-- calls the passenger; the passenger gets an SMS with the car, the plate and the live share
-- link when a driver is assigned (the outbox's notifications handler).
ALTER TABLE rides
  ADD COLUMN passenger_name text CHECK (char_length(passenger_name) BETWEEN 1 AND 100),
  ADD COLUMN passenger_phone text CHECK (passenger_phone ~ '^\+998\d{9}$'),
  ADD CONSTRAINT rides_passenger_check CHECK ((passenger_name IS NULL) = (passenger_phone IS NULL)),
  -- a parcel has its recipient, a load its customer: only taxi rides carry someone else
  ADD CONSTRAINT rides_passenger_service_check CHECK (passenger_phone IS NULL OR service = 'taxi');

-- The rider's recent passengers (GET /rides/passengers), newest first.
CREATE INDEX rides_rider_passenger_idx ON rides (rider_id, id DESC) WHERE passenger_phone IS NOT NULL;
