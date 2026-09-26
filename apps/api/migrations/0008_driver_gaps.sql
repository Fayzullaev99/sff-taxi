-- What the driver app needs beyond the first release (docs/architecture.md §7):

-- Many Cobalts and Nexias carry the CNG (methane/propane) tank in the trunk: a car can have
-- a big trunk and still no room for luggage. Luggage needs big_trunk and no tank there.
ALTER TABLE vehicles ADD COLUMN cng_in_trunk boolean NOT NULL DEFAULT false;

-- Why a driver let an offer pass (too far, the destination, the rider's rating, ...): shown
-- to operators, feeds the dispatch tuning; never held against the driver by itself.
ALTER TABLE ride_offers ADD COLUMN decline_reason text CHECK (char_length(decline_reason) <= 200);

-- A rejected or blocked driver asks for the decision to be reviewed ("transparent rules,
-- human appeal", market analysis §6.1). One open appeal per driver at a time.
CREATE TABLE driver_appeals (
  id           uuid PRIMARY KEY,
  driver_id    uuid NOT NULL REFERENCES drivers (user_id) ON DELETE CASCADE,
  -- the status the driver appeals against
  status_at    text NOT NULL CHECK (status_at IN ('rejected', 'blocked')),
  text         text NOT NULL CHECK (char_length(text) BETWEEN 5 AND 1000),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution   text CHECK (char_length(resolution) <= 1000),
  resolved_by  uuid REFERENCES users (id),
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE UNIQUE INDEX driver_appeals_one_open ON driver_appeals (driver_id) WHERE status = 'open';
CREATE INDEX driver_appeals_open_idx ON driver_appeals (created_at) WHERE status = 'open';
CREATE INDEX driver_appeals_driver_idx ON driver_appeals (driver_id, created_at DESC);
