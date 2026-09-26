-- Legal integrations of Cabinet Resolution No. 200 (docs/fiscal-and-licence.md):
-- electronic fiscal receipts for every paid ride and seat (the tax authority's OFD), and
-- verification of the passenger-transport licence card (Ministry of Transport). Both go
-- through adapters: until the integrations are contracted, receipts are prepared and kept
-- ('none' provider) and licences are checked by operators ('manual' registry).

-- One receipt per completed ride or intercity booking. The payload is what the provider
-- is sent (kept even when nothing is sent yet, so receipts can be issued later); the
-- worker retries through the outbox until the provider accepts it.
CREATE TABLE fiscal_receipts (
  id           uuid PRIMARY KEY,
  ride_id      uuid UNIQUE REFERENCES rides (id),
  booking_id   uuid UNIQUE REFERENCES intercity_bookings (id),
  provider     text NOT NULL,
  -- pending: being sent; sent: the provider issued it; skipped: no provider configured
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  amount       bigint NOT NULL CHECK (amount >= 0),
  payload      jsonb NOT NULL,
  -- the provider's receipt id, fiscal sign and the link the rider opens (QR on the receipt)
  receipt_id   text,
  fiscal_sign  text,
  receipt_url  text CHECK (char_length(receipt_url) <= 1000),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  CHECK ((ride_id IS NULL) <> (booking_id IS NULL)),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX fiscal_receipts_status_idx ON fiscal_receipts (status, created_at);

-- The licence card check on the driver's profile: unverified until an operator (manual
-- registry) or the Ministry of Transport registry says valid or invalid. Approval needs valid.
ALTER TABLE drivers
  ADD COLUMN licence_status     text NOT NULL DEFAULT 'unverified'
                                  CHECK (licence_status IN ('unverified', 'valid', 'invalid')),
  ADD COLUMN licence_checked_at timestamptz;
-- drivers approved before this check existed were checked by the operator who approved them
UPDATE drivers SET licence_status = 'valid', licence_checked_at = approved_at
WHERE status IN ('active', 'blocked') AND approved_at IS NOT NULL;

-- Every check, with where it came from and what it said.
CREATE TABLE licence_checks (
  id                  uuid PRIMARY KEY,
  driver_id           uuid NOT NULL REFERENCES drivers (user_id) ON DELETE CASCADE,
  -- manual: an operator compared the card with the registry; mintrans: the registry's API
  source              text NOT NULL CHECK (source IN ('manual', 'mintrans')),
  licence_card_number text NOT NULL,
  result              text NOT NULL CHECK (result IN ('valid', 'invalid')),
  -- what the registry says the card is valid until, when it says
  expires_on          date,
  note                text CHECK (char_length(note) <= 500),
  raw                 jsonb,
  checked_by          uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX licence_checks_driver_idx ON licence_checks (driver_id, created_at DESC);
