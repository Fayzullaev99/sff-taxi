-- Card payments through Payme and Click (docs/payments.md): riders prepay the fixed fare of a
-- card ride, drivers top up their prepaid balance. The platform is the merchant of record:
-- one Payme cashbox and one Click service, configured on the server. The provider logic
-- (JSON-RPC Merchant API, Click SHOP API prepare/complete, idempotency, expiry) is SFF Eats'.

-- What someone is asked to pay: a card ride's fare or a driver's top-up. Its id is what the
-- providers send back (Payme account.order_id, Click merchant_trans_id).
CREATE TABLE payment_intents (
  id                   uuid PRIMARY KEY,
  purpose              text NOT NULL CHECK (purpose IN ('ride', 'topup')),
  -- a card ride has exactly one intent
  ride_id              uuid UNIQUE REFERENCES rides (id),
  -- the driver whose balance a top-up credits
  driver_id            uuid REFERENCES drivers (user_id),
  -- who pays
  user_id              uuid NOT NULL REFERENCES users (id),
  -- whole so'm; the providers count tiyin (x 100)
  amount               bigint NOT NULL CHECK (amount > 0),
  -- pending -> paid -> refund_pending -> refunded;  pending -> expired | cancelled
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN (
                         'pending', 'paid', 'expired', 'cancelled', 'refund_pending', 'refunded')),
  provider             text CHECK (provider IN ('payme', 'click')),
  expires_at           timestamptz NOT NULL,
  paid_at              timestamptz,
  refund_requested_at  timestamptz,
  refunded_at          timestamptz,
  -- the provider's refund id or the operator's note of how the money went back
  refund_reference     text CHECK (char_length(refund_reference) <= 200),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'ride') = (ride_id IS NOT NULL)),
  CHECK ((purpose = 'topup') = (driver_id IS NOT NULL)),
  CHECK ((status IN ('paid', 'refund_pending', 'refunded')) = (paid_at IS NOT NULL)),
  CHECK ((status IN ('paid', 'refund_pending', 'refunded')) = (provider IS NOT NULL)),
  CHECK ((status = 'refunded') = (refunded_at IS NOT NULL))
);
-- the expiry job: intents still waiting, oldest deadline first
CREATE INDEX payment_intents_pending_idx ON payment_intents (expires_at) WHERE status = 'pending';
CREATE INDEX payment_intents_driver_idx ON payment_intents (driver_id, created_at DESC)
  WHERE driver_id IS NOT NULL;
-- operators' refund queue
CREATE INDEX payment_intents_refunds_idx ON payment_intents (refund_requested_at)
  WHERE status = 'refund_pending';

-- One row per provider transaction. Providers retry their callbacks, so every callback is
-- looked up by (provider, external_id) first; the unique constraints make a repeat a no-op.
CREATE TABLE payment_transactions (
  id             uuid PRIMARY KEY,
  -- short number handed to Click as merchant_prepare_id / merchant_confirm_id
  seq            bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  provider       text NOT NULL CHECK (provider IN ('payme', 'click')),
  -- Payme transaction id / Click click_trans_id
  external_id    text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 100),
  intent_id      uuid NOT NULL REFERENCES payment_intents (id),
  -- tiyin (1 so'm = 100 tiyin), as the providers count
  amount         bigint NOT NULL CHECK (amount > 0),
  -- created -> performed -> refunded;  created -> cancelled
  state          text NOT NULL DEFAULT 'created'
                   CHECK (state IN ('created', 'performed', 'cancelled', 'refunded')),
  -- Payme's own creation time in epoch milliseconds (Click has none)
  provider_time  bigint,
  performed_at   timestamptz,
  cancelled_at   timestamptz,
  -- Payme cancel reason code (1..10); null for Click
  cancel_reason  int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id),
  CHECK ((state IN ('performed', 'refunded')) = (performed_at IS NOT NULL)),
  CHECK ((state IN ('cancelled', 'refunded')) = (cancelled_at IS NOT NULL))
);
-- an intent is paid at most once, whichever provider paid it
CREATE UNIQUE INDEX payment_transactions_paid_idx ON payment_transactions (intent_id)
  WHERE performed_at IS NOT NULL;
CREATE INDEX payment_transactions_intent_idx ON payment_transactions (intent_id, state);
-- Payme GetStatement: transactions by Payme's creation time
CREATE INDEX payment_transactions_time_idx ON payment_transactions (provider, provider_time)
  WHERE provider_time IS NOT NULL;

-- Rides paid by card wait for the payment before dispatch; their money can be refunded.
ALTER TABLE rides DROP CONSTRAINT rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check CHECK (status IN (
  'awaiting_payment', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress',
  'completed', 'cancelled'));
ALTER TABLE rides DROP CONSTRAINT rides_payment_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_payment_status_check CHECK (payment_status IN (
  'pending', 'paid', 'not_charged', 'failed', 'refund_pending', 'refunded'));
-- a rider still paying for a ride has an open ride too
DROP INDEX rides_one_open_per_rider;
CREATE UNIQUE INDEX rides_one_open_per_rider ON rides (rider_id)
  WHERE status IN ('awaiting_payment', 'searching', 'driver_assigned', 'driver_arrived',
                   'in_progress');

-- Driver balance: a card ride's fare is owed to the driver (card_fare, a credit) and paid out
-- to the driver's card or account by operators (payout, a debit); a top-up paid online is
-- credited once per payment.
ALTER TABLE driver_ledger DROP CONSTRAINT driver_ledger_kind_check;
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_kind_check CHECK (kind IN (
  'topup', 'commission', 'tax', 'pass', 'adjustment', 'card_fare', 'payout'));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_card_fare_check
  CHECK (kind <> 'card_fare' OR (amount > 0 AND ride_id IS NOT NULL));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_payout_check
  CHECK (kind <> 'payout' OR amount < 0);
ALTER TABLE driver_ledger ADD COLUMN payment_intent_id uuid UNIQUE REFERENCES payment_intents (id);
