-- Scheduled rides: ordered for later (30 minutes to 24 hours ahead) at the fixed price of the
-- scheduled time; dispatch starts 15 minutes before it (docs/architecture.md §5).
ALTER TABLE quotes ADD COLUMN scheduled_for timestamptz;

ALTER TABLE rides ADD COLUMN scheduled_for timestamptz;
ALTER TABLE rides DROP CONSTRAINT rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check CHECK (status IN (
  'scheduled', 'awaiting_payment', 'searching', 'driver_assigned', 'driver_arrived',
  'in_progress', 'completed', 'cancelled'));
ALTER TABLE rides ADD CONSTRAINT rides_scheduled_check
  CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL);
-- the dispatch loop: scheduled rides whose search is due
CREATE INDEX rides_scheduled_idx ON rides (scheduled_for) WHERE status = 'scheduled';
