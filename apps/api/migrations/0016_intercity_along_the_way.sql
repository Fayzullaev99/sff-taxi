-- Wave 4, the trip board: seats "along the way" (yo‘l-yo‘lakay) and the seating rule on
-- trips published before it (docs/architecture.md §11).

-- A rider may book part of a trip, between towns the trip passes (Sirdaryo -> Toshkent on a
-- Guliston -> Toshkent trip); the driver sees where to pick them up and drop them off.
-- NULL = the trip's own ends.
ALTER TABLE intercity_bookings
  ADD COLUMN pickup_point_id  uuid REFERENCES intercity_points (id),
  ADD COLUMN dropoff_point_id uuid REFERENCES intercity_points (id),
  ADD CONSTRAINT intercity_bookings_part_check
    CHECK ((pickup_point_id IS NULL) = (dropoff_point_id IS NULL)
       AND (pickup_point_id IS NULL OR pickup_point_id <> dropoff_point_id));

-- The rear-seats check (0015) is NOT VALID, but every UPDATE of a row is still checked: an
-- open trip offering 4 seats could not even count a booking. Cut those down to the rule
-- where the seats already booked allow it (front + 2 rear, or 2 rear without the front).
UPDATE intercity_trips
SET seats_total = CASE WHEN front_seat THEN 3 ELSE 2 END,
    updated_at = now()
WHERE status IN ('scheduled', 'boarding')
  AND seats_total - (CASE WHEN front_seat THEN 1 ELSE 0 END) > 2
  AND seats_booked <= CASE WHEN front_seat THEN 3 ELSE 2 END;
