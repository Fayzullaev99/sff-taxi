-- A ride's credit reservation may change after the order: the rider edited the intermediate
-- stops, the fare moved and so did the credit's share of it. The ledger stays append-only:
-- every such change is an 'adjustment' row carrying the ride (negative when more credit is
-- reserved, positive when less), so "one reservation, one release per ride" now binds those
-- two kinds only.
DROP INDEX rider_credits_ride_kind_idx;
CREATE UNIQUE INDEX rider_credits_ride_kind_idx ON rider_credits (ride_id, kind)
  WHERE ride_id IS NOT NULL AND kind IN ('ride', 'ride_release');
