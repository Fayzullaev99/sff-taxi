-- Hot spots found by the load test (2 000 drivers, 50 000 riders, 500 000 rides; docs/audit.md
-- "Load test").

-- Driver balances are sums of the ledger (dispatch eligibility, the operators' driver list,
-- card money owed): an index-only scan per driver instead of visiting ~250 heap rows each.
CREATE INDEX driver_ledger_balance_idx ON driver_ledger (driver_id, kind) INCLUDE (amount);

-- Operators search rides by a fragment of the caller's phone ("4521"): a trigram index instead
-- of reading every ride. pg_trgm is a trusted extension: the database owner may create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX rides_rider_phone_trgm_idx ON rides USING gin (rider_phone gin_trgm_ops);
