-- Tips ("choychaqa", docs/architecture.md §8 "Tips"): after a ride the rider may add a tip,
-- one per ride. A cash tip is only recorded (the rider hands it over); a card tip is paid
-- through Payme/Click (a payment intent of purpose 'tip') and credited 100% to the driver's
-- balance (ledger kind 'tip'): no commission, no tax withheld (see the doc for why).
CREATE TABLE ride_tips (
  id          uuid PRIMARY KEY,
  ride_id     uuid NOT NULL UNIQUE REFERENCES rides (id),
  rider_id    uuid NOT NULL REFERENCES users (id),
  driver_id   uuid NOT NULL REFERENCES drivers (user_id),
  amount      int NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  method      text NOT NULL CHECK (method IN ('cash', 'card')),
  -- cash: recorded. card: awaiting_payment -> paid (-> refunded); a payment not made in time
  -- leaves it failed, and the rider may try again (a new intent for the same tip)
  status      text NOT NULL CHECK (status IN ('recorded', 'awaiting_payment', 'paid', 'failed',
                                              'refunded')),
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((method = 'cash') = (status = 'recorded')),
  CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL))
);
CREATE INDEX ride_tips_driver_idx ON ride_tips (driver_id, created_at DESC);

-- A card tip's payment: one intent per attempt, at most one waiting and one paid per tip.
ALTER TABLE payment_intents ADD COLUMN tip_id uuid REFERENCES ride_tips (id);
ALTER TABLE payment_intents DROP CONSTRAINT payment_intents_purpose_check;
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_purpose_check
  CHECK (purpose IN ('ride', 'topup', 'booking', 'tip'));
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_tip_check
  CHECK ((purpose = 'tip') = (tip_id IS NOT NULL));
CREATE UNIQUE INDEX payment_intents_tip_pending_idx ON payment_intents (tip_id)
  WHERE tip_id IS NOT NULL AND status = 'pending';
CREATE UNIQUE INDEX payment_intents_tip_paid_idx ON payment_intents (tip_id)
  WHERE tip_id IS NOT NULL AND status IN ('paid', 'refund_pending', 'refunded');

-- The driver's balance: a card tip, whole (once per ride: the (ride, kind) unique index).
ALTER TABLE driver_ledger DROP CONSTRAINT driver_ledger_kind_check;
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_kind_check CHECK (kind IN (
  'topup', 'commission', 'tax', 'pass', 'adjustment', 'card_fare', 'payout', 'cancel_fee',
  'cancel_fee_collected', 'deposit', 'promo_compensation', 'tip'));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_tip_check
  CHECK (kind <> 'tip' OR (amount > 0 AND ride_id IS NOT NULL));
