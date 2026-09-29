-- Hot spots found by the wave 4 load test (docs/audit.md "Load test (wave 4)").

-- Dispatch looks for cars on their way (drivers heading somewhere, cars carrying riders who
-- share) on every step, and every quote previews the shared cars nearby: a few online drivers
-- out of all online ones.
CREATE INDEX drivers_along_idx ON drivers (lat, lng)
  WHERE is_online AND (pool_enabled OR destination_lat IS NOT NULL);

-- Every rider's quote counts the free verified women drivers nearby ("a woman driver"): without
-- it, a scan of every registered driver.
CREATE INDEX drivers_women_idx ON drivers (lat, lng)
  WHERE is_online AND gender = 'female' AND gender_verified_at IS NOT NULL;
