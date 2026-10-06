-- Review 2026-10: the history lists page "newest first by id" (uuid v7, time-ordered) but the
-- indexes were on (owner, requested_at / created_at): Postgres read every ride (or ledger
-- entry) the person ever had and sorted it, per page. These match the ORDER BY id DESC.

-- the rider's history (GET /rides), the driver's (GET /driver/rides) and operators' rides
-- of one driver
CREATE INDEX rides_rider_id_desc_idx ON rides (rider_id, id DESC);
CREATE INDEX rides_driver_id_desc_idx ON rides (driver_id, id DESC) WHERE driver_id IS NOT NULL;

-- the driver's earnings for a day or week (GET /driver/earnings, the home screen)
CREATE INDEX rides_driver_completed_idx ON rides (driver_id, completed_at)
  WHERE status = 'completed';

-- the driver's ledger (GET /driver/ledger, operators' billing page)
CREATE INDEX driver_ledger_driver_id_desc_idx ON driver_ledger (driver_id, id DESC);

-- the rider's trip-board bookings (GET /intercity/bookings)
CREATE INDEX intercity_bookings_rider_id_desc_idx ON intercity_bookings (rider_id, id DESC);
