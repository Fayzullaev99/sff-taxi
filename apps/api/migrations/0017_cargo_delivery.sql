-- Cargo ("Yuk tashish") and delivery ("Yetkazib berish") next to taxi (docs/shared-rides.md §8).
-- They use the same quotes, rides, dispatch and money: cargo with its own classes and cars,
-- delivery (a parcel carried by a taxi car, the sender not in the car) with taxi classes.

-- The car's body and what it carries. A car with a cargo class is a cargo car: it gets cargo
-- rides only (Resolution 200's passenger-taxi rules do not apply to it, the cargo rules do).
ALTER TABLE vehicles
  ADD COLUMN body text NOT NULL DEFAULT 'sedan'
    CHECK (body IN ('sedan', 'hatchback', 'minivan', 'van', 'pickup', 'truck')),
  -- how much the car may load, kg
  ADD COLUMN payload_kg int CHECK (payload_kg BETWEEN 1 AND 20000),
  -- total (gross) mass, kg: above 3 500 the driver needs a category C licence
  ADD COLUMN gross_kg int CHECK (gross_kg BETWEEN 500 AND 40000),
  -- cargo_s: Damas/Labo class; cargo_m: Gazel/Porter/Isuzu class (takes small loads too)
  ADD COLUMN cargo_class text CHECK (cargo_class IN ('cargo_s', 'cargo_m')),
  ADD CONSTRAINT vehicles_cargo_check
    CHECK (cargo_class IS NULL OR (payload_kg IS NOT NULL AND body IN ('van', 'pickup', 'truck')));

-- The service a quote is for, and its cargo options (loaders, the customer riding along, the
-- load) or the parcel of a delivery, as the rider gave them when asking for the price.
ALTER TABLE quotes
  ADD COLUMN service text NOT NULL DEFAULT 'taxi' CHECK (service IN ('taxi', 'cargo', 'delivery')),
  ADD COLUMN cargo jsonb;

-- A ride's class is a taxi class for taxi and delivery rides, a cargo class for cargo.
ALTER TABLE rides DROP CONSTRAINT rides_class_check;
ALTER TABLE rides
  ADD CONSTRAINT rides_class_check
    CHECK (class IN ('economy', 'comfort', 'cargo_s', 'cargo_m')),
  ADD CONSTRAINT rides_service_class_check
    CHECK ((service = 'cargo') = (class IN ('cargo_s', 'cargo_m'))),
  -- cargo: {loaders, riderRides, description, weightKg}
  ADD COLUMN cargo jsonb,
  -- delivery: {description, weightKg} and who receives it (the driver calls them)
  ADD COLUMN parcel jsonb,
  ADD COLUMN recipient_name text CHECK (char_length(recipient_name) BETWEEN 1 AND 100),
  ADD COLUMN recipient_phone text CHECK (recipient_phone ~ '^\+998\d{9}$'),
  ADD CONSTRAINT rides_cargo_check CHECK ((service = 'cargo') = (cargo IS NOT NULL)),
  ADD CONSTRAINT rides_delivery_check CHECK (
    (service = 'delivery') = (recipient_phone IS NOT NULL)
    AND (service = 'delivery') = (parcel IS NOT NULL)),
  -- a load or a parcel is never a shared ride
  ADD CONSTRAINT rides_service_shareable_check CHECK (service = 'taxi' OR NOT shareable);
