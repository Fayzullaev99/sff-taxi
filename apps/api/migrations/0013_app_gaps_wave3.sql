-- What the rider app, the driver app and the operator panel reported missing after wave 2
-- (apps/*/README.md "API gaps"), and collecting owed cancellation fees.

-- Complaint photos: riders attach up to three pictures (a lost bag, a dirty seat) uploaded
-- through the uploads module with the purpose complaint_photo (images only, like photos).
ALTER TABLE uploads DROP CONSTRAINT uploads_purpose_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_purpose_check CHECK (purpose IN (
  'document', 'profile_photo', 'vehicle_photo', 'complaint_photo'));
ALTER TABLE complaints
  ADD COLUMN photo_upload_ids uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(photo_upload_ids) <= 3);

-- Operators booking seats for a caller: a double click in the panel is one booking.
CREATE UNIQUE INDEX intercity_bookings_phone_request_idx
  ON intercity_bookings (created_by, client_request_id)
  WHERE channel = 'phone' AND client_request_id IS NOT NULL;

-- Recent destinations a rider hid from the list (the ride history itself stays).
CREATE TABLE rider_hidden_places (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- the destination rounded to 4 decimals (~11 m), as the recent list groups them
  place_key  text NOT NULL CHECK (place_key ~ '^-?\d+\.\d{4},-?\d+\.\d{4}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_key)
);

-- Owed cancellation fees of cash rides (docs/architecture.md §5): a fee recorded on a
-- cancelled cash ride is owed until the rider's next cash ride collects it (shown as its own
-- line on that quote and ride), or an operator waives it.
ALTER TABLE rides
  ADD COLUMN fee_status text CHECK (fee_status IN ('owed', 'collected', 'waived')),
  -- the ride collecting this fee (attached when ordered; cleared if that ride is cancelled)
  ADD COLUMN fee_collect_ride_id uuid REFERENCES rides (id),
  ADD COLUMN fee_waived_by uuid REFERENCES users (id),
  ADD COLUMN fee_waive_note text CHECK (char_length(fee_waive_note) <= 300),
  -- on the collecting ride: the owed fees it collects in cash on top of its fare
  ADD COLUMN owed_fee int NOT NULL DEFAULT 0 CHECK (owed_fee >= 0),
  ADD CONSTRAINT rides_fee_needs_amount_check CHECK (fee_status IS NULL OR cancellation_fee > 0);
CREATE INDEX rides_fee_owed_idx ON rides (rider_id) WHERE fee_status = 'owed';
CREATE INDEX rides_fee_collect_idx ON rides (fee_collect_ride_id)
  WHERE fee_collect_ride_id IS NOT NULL;

-- The collecting driver took the fee in cash (debit); the driver it is owed to is credited.
ALTER TABLE driver_ledger DROP CONSTRAINT driver_ledger_kind_check;
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_kind_check CHECK (kind IN (
  'topup', 'commission', 'tax', 'pass', 'adjustment', 'card_fare', 'payout', 'cancel_fee',
  'cancel_fee_collected'));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_cancel_fee_check
  CHECK (kind <> 'cancel_fee' OR (amount > 0 AND ride_id IS NOT NULL));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_cancel_fee_collected_check
  CHECK (kind <> 'cancel_fee_collected' OR (amount < 0 AND ride_id IS NOT NULL));
