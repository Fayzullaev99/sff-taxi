import { describe, expect, it } from 'vitest';
import {
  carClassesFor,
  CargoRules,
  cargoClassOf,
  cargoRideTariff,
  computeCargoFare,
  DEFAULT_CARGO,
  deliveryFare,
} from './cargo.js';
import { checkVehicle, type VehicleFacts } from './driver-rules.js';
import { DEFAULT_TARIFF, type Fare, Tariff, waitingFee } from './tariff.js';

/** A moment given in Tashkent local time (UTC+5). */
const tashkent = (iso: string) => new Date(`${iso}+05:00`);
const NOON = tashkent('2026-09-28T12:00');
const NIGHT = tashkent('2026-09-28T23:30');

const cargo = (roadM: number, over: Partial<Parameters<typeof computeCargoFare>[0]> = {}) =>
  computeCargoFare({ roadM, cargoClass: 'cargo_s', loaders: 0, at: NOON, ...over }, DEFAULT_CARGO);

describe('cargo fares', () => {
  it('the defaults are a valid settings document', () => {
    expect(CargoRules.parse(DEFAULT_CARGO)).toEqual(DEFAULT_CARGO);
  });

  it('charges the base price within the included kilometres', () => {
    expect(cargo(4000).total).toBe(35_000);
    expect(cargo(10_000).total).toBe(35_000);
    expect(cargo(4000, { cargoClass: 'cargo_m' }).total).toBe(56_000);
  });

  it('adds every started km beyond the included ones', () => {
    // 15 km: 5 km beyond 10 -> 35 000 + 5 x 1 500
    const f = cargo(14_200);
    expect(f.cargo.extraKm).toBe(5);
    expect(f.total).toBe(42_500);
    expect(cargo(14_200, { cargoClass: 'cargo_m' }).total).toBe(56_000 + 5 * 2400);
  });

  it('prices loaders per person, capped at the maximum', () => {
    expect(cargo(5000, { loaders: 1 }).total).toBe(65_000);
    expect(cargo(5000, { loaders: 2 }).total).toBe(95_000);
    const capped = cargo(5000, { loaders: 5 });
    expect(capped.cargo.loaders).toBe(2);
    expect(capped.total).toBe(95_000);
  });

  it('adds the night percent to the transport part, not to the loaders', () => {
    const f = cargo(5000, { at: NIGHT, loaders: 1 });
    expect(f.night).toBe(7000);
    expect(f.total).toBe(35_000 + 7000 + 30_000);
  });

  it('uses the intercity per-km price on long rides', () => {
    const rules = CargoRules.parse({
      ...DEFAULT_CARGO,
      classes: {
        ...DEFAULT_CARGO.classes,
        cargo_s: { ...DEFAULT_CARGO.classes.cargo_s, intercity_per_km: 2000 },
      },
    });
    const f = computeCargoFare(
      { roadM: 60_000, cargoClass: 'cargo_s', loaders: 0, at: NOON },
      rules,
    );
    expect(f.kind).toBe('intercity');
    expect(f.total).toBe(35_000 + 50 * 2000);
    expect(cargo(19_000).kind).toBe('city');
  });

  it('keeps the taxi fare shape (views and charges read it)', () => {
    const f = cargo(12_000, { loaders: 1 });
    expect(f).toMatchObject({
      rideClass: 'cargo_s',
      distanceM: 12_000,
      seat: null,
      options: {},
      cargo: { basePrice: 35_000, includedKm: 10, includedMinutes: 20, maxPayloadKg: 700 },
    });
  });

  it('gives the ride the loading minutes as free waiting, then per minute', () => {
    const t = cargoRideTariff(DEFAULT_TARIFF, DEFAULT_CARGO, 'cargo_m');
    expect(Tariff.parse(t).waiting).toEqual({ free_minutes: 20, per_minute: 400 });
    const arrived = new Date('2026-09-28T07:00:00Z');
    // 25 minutes of loading: 5 paid minutes
    expect(waitingFee(arrived, new Date(arrived.getTime() + 25 * 60_000), t)).toBe(2000);
    expect(waitingFee(arrived, new Date(arrived.getTime() + 19 * 60_000), t)).toBe(0);
  });

  it('refuses settings a ride could not keep', () => {
    const bad = {
      ...DEFAULT_CARGO,
      classes: {
        ...DEFAULT_CARGO.classes,
        cargo_s: { ...DEFAULT_CARGO.classes.cargo_s, included_minutes: 45 },
      },
    };
    expect(CargoRules.safeParse(bad).success).toBe(false);
  });

  it('a medium car takes small loads, a small car only small ones', () => {
    expect(carClassesFor('cargo_s')).toEqual(['cargo_s', 'cargo_m']);
    expect(carClassesFor('cargo_m')).toEqual(['cargo_m']);
    expect(cargoClassOf(600)).toBe('cargo_s');
    expect(cargoClassOf(1500)).toBe('cargo_m');
  });
});

describe('delivery fares', () => {
  const taxi: Fare = {
    kind: 'city',
    rideClass: 'economy',
    distanceM: 3000,
    insideM: 3000,
    outsideM: 0,
    base: 7000,
    outside: 0,
    night: 0,
    options: {},
    total: 7000,
    seat: null,
  };

  it('is the taxi fare by default, or the configured share of it', () => {
    expect(deliveryFare(taxi, 100).total).toBe(7000);
    expect(deliveryFare(taxi, 150).total).toBe(10_500);
    expect(deliveryFare(taxi, 75).total).toBe(5300);
    expect(deliveryFare(taxi, 100)).toMatchObject({ delivery: { percent: 100 }, seat: null });
  });
});

describe('cargo cars (not Resolution 200 taxis)', () => {
  const today = '2026-09-28';
  const damas: VehicleFacts = {
    make: 'Chevrolet',
    model: 'Damas',
    year: 2008,
    seats: 1,
    class: 'economy',
    features: [],
    service: 'cargo',
    body: 'van',
    payloadKg: 550,
    grossKg: 1500,
  };

  it('a Damas is refused as a taxi but accepted for cargo', () => {
    const asTaxi = checkVehicle({ ...damas, service: 'taxi' }, today).map((p) => p.path);
    expect(asTaxi).toContain('vehicle.model');
    expect(asTaxi).toContain('vehicle.year');
    expect(checkVehicle(damas, today)).toEqual([]);
  });

  it('needs a cargo body, a payload and at most 25 years', () => {
    const problems = checkVehicle(
      { ...damas, body: 'sedan', payloadKg: null, year: 1999 },
      today,
    ).map((p) => p.path);
    expect(problems).toEqual(['vehicle.body', 'vehicle.payloadKg', 'vehicle.year']);
  });

  it('a car over 3.5 t needs a category C licence; B is enough up to 3.5 t', () => {
    const gazel = { ...damas, model: 'Gazel', body: 'truck', payloadKg: 1500, grossKg: 3500 };
    expect(checkVehicle(gazel, today, ['B'])).toEqual([]);
    const heavy = { ...gazel, grossKg: 5000 };
    expect(checkVehicle(heavy, today, ['B']).map((p) => p.path)).toEqual(['licenceCategories']);
    expect(checkVehicle(heavy, today, ['B', 'C'])).toEqual([]);
  });

  it('a taxi with a cargo body is refused', () => {
    const pickup = {
      ...damas,
      make: 'Isuzu',
      model: 'D-Max',
      year: 2020,
      service: 'taxi' as const,
    };
    expect(checkVehicle({ ...pickup, body: 'pickup' }, today).map((p) => p.path)).toEqual([
      'vehicle.body',
    ]);
  });
});
