-- Rider marketing: promo codes, "Do'stni taklif qil" referrals and ride credit
-- (docs/architecture.md §8 "Rider discounts"). The driver always earns the full fare: a
-- discount is the platform's cost. A cash ride's discount is credited to the driver's
-- balance (promo_compensation); a card ride is charged the discounted amount and the driver
-- is credited the full fare (card_fare). Commission and the 1% tax stay on the full fare.

-- Promo codes made by operators for campaigns. Codes are stored upper-case: riders type them
-- in any case.
CREATE TABLE promo_codes (
  id               uuid PRIMARY KEY,
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  -- percent of the fare (capped by max_discount) or a fixed amount of so'm
  kind             text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value            int NOT NULL CHECK (value > 0),
  max_discount     int CHECK (max_discount > 0),
  -- the fare (before the discount) must be at least this much
  min_fare         int NOT NULL DEFAULT 0 CHECK (min_fare >= 0),
  valid_from       timestamptz,
  valid_until      timestamptz,
  -- rides that may use it in total and per rider (reserved by an open ride or redeemed)
  usage_limit      int CHECK (usage_limit > 0),
  per_rider_limit  int NOT NULL DEFAULT 1 CHECK (per_rider_limit > 0),
  -- only a rider without a completed ride
  first_ride_only  boolean NOT NULL DEFAULT false,
  -- empty: every service / class
  services         text[] NOT NULL DEFAULT '{}',
  classes          text[] NOT NULL DEFAULT '{}',
  -- null: every city
  city_id          uuid REFERENCES cities (id),
  is_active        boolean NOT NULL DEFAULT true,
  description      text CHECK (char_length(description) <= 300),
  created_by       uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from)
);

-- Codes a rider entered (profile or order screen): the quote applies the best one.
CREATE TABLE rider_promos (
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  promo_id  uuid NOT NULL REFERENCES promo_codes (id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, promo_id)
);

-- Every rider's personal invitation code (made on first use).
CREATE TABLE referral_codes (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,20}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The installs (the app's own random id) a rider opened the invitation card on: a code
-- entered from one of them is the referrer inviting themselves from another SIM card.
CREATE TABLE referral_devices (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id  text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 100),
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX referral_devices_device_idx ON referral_devices (device_id);

-- A new rider who entered someone's code. One per invitee (one per phone: accounts are per
-- phone) and one per device; the invitee gets the welcome discount, the referrer a ride
-- credit after the invitee's first completed ride (capped per month: 'capped' is rewarded
-- with nothing). Operators may revoke one.
CREATE TABLE referrals (
  id              uuid PRIMARY KEY,
  referrer_id     uuid NOT NULL REFERENCES users (id),
  invitee_id      uuid NOT NULL UNIQUE REFERENCES users (id),
  code            text NOT NULL,
  device_id       text CHECK (char_length(device_id) BETWEEN 8 AND 100),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'rewarded', 'capped', 'revoked')),
  reward_amount   int NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
  reward_ride_id  uuid REFERENCES rides (id),
  rewarded_at     timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users (id),
  revoke_note     text CHECK (char_length(revoke_note) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_id <> invitee_id),
  CHECK ((status IN ('rewarded', 'capped')) = (rewarded_at IS NOT NULL) OR status = 'revoked'),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id, rewarded_at);
CREATE UNIQUE INDEX referrals_device_idx ON referrals (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX referrals_created_idx ON referrals (id DESC);

-- The discount a ride carries: a promo code or the referral welcome discount, and ride
-- credit. Reserved when the ride is ordered (it counts against the code's limits at once, so
-- concurrent orders cannot overuse them: the code row is locked while counting), redeemed
-- when the ride completes, released when it is cancelled.
CREATE TABLE ride_discounts (
  ride_id        uuid PRIMARY KEY REFERENCES rides (id),
  rider_id       uuid NOT NULL REFERENCES users (id),
  promo_id       uuid REFERENCES promo_codes (id),
  referral_id    uuid REFERENCES referrals (id),
  promo_amount   int NOT NULL DEFAULT 0 CHECK (promo_amount >= 0),
  credit_amount  int NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  status         text NOT NULL DEFAULT 'reserved'
                   CHECK (status IN ('reserved', 'redeemed', 'released')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  redeemed_at    timestamptz,
  released_at    timestamptz,
  CHECK (promo_id IS NULL OR referral_id IS NULL),
  CHECK ((promo_amount > 0) = (promo_id IS NOT NULL OR referral_id IS NOT NULL)),
  CHECK (promo_amount + credit_amount > 0),
  CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL)),
  CHECK ((status = 'released') = (released_at IS NOT NULL))
);
CREATE INDEX ride_discounts_promo_idx ON ride_discounts (promo_id, rider_id)
  WHERE promo_id IS NOT NULL AND status <> 'released';
CREATE INDEX ride_discounts_referral_idx ON ride_discounts (referral_id)
  WHERE referral_id IS NOT NULL AND status <> 'released';

-- Ride credit ("bonus"): an append-only ledger per rider, balance = sum. Referral rewards
-- credit it, an order reserves part of it (a debit with the ride), a cancellation gives it
-- back, operators correct or revoke with a note.
CREATE TABLE rider_credits (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id),
  kind         text NOT NULL
                 CHECK (kind IN ('referral_bonus', 'ride', 'ride_release', 'revoke', 'adjustment')),
  amount       int NOT NULL CHECK (amount <> 0),
  ride_id      uuid REFERENCES rides (id),
  referral_id  uuid REFERENCES referrals (id),
  note         text CHECK (char_length(note) <= 300),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('referral_bonus', 'ride_release') OR amount > 0),
  CHECK (kind NOT IN ('ride', 'revoke') OR amount < 0),
  CHECK (kind NOT IN ('ride', 'ride_release') OR ride_id IS NOT NULL),
  CHECK (kind <> 'referral_bonus' OR referral_id IS NOT NULL)
);
CREATE INDEX rider_credits_user_idx ON rider_credits (user_id, id DESC);
-- a ride reserves and releases credit once; a referral is rewarded and revoked once
CREATE UNIQUE INDEX rider_credits_ride_kind_idx ON rider_credits (ride_id, kind)
  WHERE ride_id IS NOT NULL;
CREATE UNIQUE INDEX rider_credits_referral_kind_idx ON rider_credits (referral_id, kind)
  WHERE referral_id IS NOT NULL;

CREATE FUNCTION taxi_rider_credits_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rider_credits is append-only: add an adjustment entry instead'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER rider_credits_append_only
  BEFORE UPDATE OR DELETE ON rider_credits
  FOR EACH ROW EXECUTE FUNCTION taxi_rider_credits_append_only();
REVOKE UPDATE, DELETE ON rider_credits FROM taxi_app;

-- The platform pays a cash ride's discount to the driver (the rider handed over less cash).
ALTER TABLE driver_ledger DROP CONSTRAINT driver_ledger_kind_check;
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_kind_check CHECK (kind IN (
  'topup', 'commission', 'tax', 'pass', 'adjustment', 'card_fare', 'payout', 'cancel_fee',
  'cancel_fee_collected', 'deposit', 'promo_compensation'));
ALTER TABLE driver_ledger ADD CONSTRAINT driver_ledger_promo_compensation_check
  CHECK (kind <> 'promo_compensation' OR (amount > 0 AND ride_id IS NOT NULL));
