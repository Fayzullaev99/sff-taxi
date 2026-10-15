-- Intermediate stops ("Oraliq manzil", docs/architecture.md §5): up to two stops between the
-- pickup and the drop-off, fixed at order time. The fare goes by the road through them, plus
-- a flat fee per stop; waiting at a stop is free for the tariff's stop minutes, then paid
-- like waiting at the pickup (added to waiting_fee when the car leaves the stop).

-- The quote's stops as priced: [{lat, lng}] in order.
ALTER TABLE quotes
  ADD COLUMN stops jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(stops) = 'array' AND jsonb_array_length(stops) <= 2);

-- The ride's stops: [{address, landmark, lat, lng, arrivedAt, leftAt, waitingFee}] in order.
-- Never on a shared ride (other riders' plans) nor on a cargo ride.
ALTER TABLE rides
  ADD COLUMN stops jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(stops) = 'array' AND jsonb_array_length(stops) <= 2),
  ADD CONSTRAINT rides_stops_service_check
    CHECK (jsonb_array_length(stops) = 0 OR (service <> 'cargo' AND NOT shareable));
