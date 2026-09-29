import { z } from 'zod';
import { roundUp100 } from './distance.js';
import { type Fare, isNight, type RideKind, type Tariff } from './tariff.js';

/**
 * Cargo ("Yuk tashish") and delivery ("Yetkazib berish") prices (docs/shared-rides.md §8,
 * market research v2 §4 and §6.4). Like taxi fares they are fixed at quote time and never
 * surge. A cargo fare is a base price that already includes some kilometres and minutes of
 * loading, then a price per km beyond them, loaders ("yukchi") per person and the night
 * add-on. A delivery is a parcel carried by a taxi car: the taxi fare, or a share of it.
 */

export const CARGO_CLASSES = ['cargo_s', 'cargo_m'] as const;
/** cargo_s: Damas/Labo class (~500-700 kg); cargo_m: Gazel/Porter/Isuzu class (up to 1.5 t). */
export type CargoClass = (typeof CARGO_CLASSES)[number];
export const VEHICLE_BODIES = ['sedan', 'hatchback', 'minivan', 'van', 'pickup', 'truck'] as const;
export type VehicleBody = (typeof VEHICLE_BODIES)[number];
/** Bodies a cargo car may have (a load goes in a closed van, an open bed or a truck body). */
export const CARGO_BODIES: readonly VehicleBody[] = ['van', 'pickup', 'truck'];

/** A medium car can take a small car's load, not the other way round. */
export function carClassesFor(rideClass: CargoClass): CargoClass[] {
  return rideClass === 'cargo_s' ? ['cargo_s', 'cargo_m'] : ['cargo_m'];
}

/** The class a cargo car serves by its payload: up to 800 kg small, above that medium. */
export function cargoClassOf(payloadKg: number): CargoClass {
  return payloadKg <= SMALL_MAX_PAYLOAD_KG ? 'cargo_s' : 'cargo_m';
}
export const SMALL_MAX_PAYLOAD_KG = 800;

const soum = z.number().int().min(0).max(10_000_000);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const CargoClassTariff = z.object({
  /** The price of the order, including the first `included_km` and `included_minutes`. */
  base: soum,
  included_km: z.number().int().min(0).max(100),
  /**
   * Free loading (and waiting) minutes after the car arrives; then per started minute.
   * At most 30: the ride keeps them in its tariff snapshot's waiting rules.
   */
  included_minutes: z.number().int().min(0).max(30),
  /** Per started km beyond the included ones, in and around the city ... */
  per_km: soum,
  /** ... and on long rides between towns (road distance >= intercity_from_km). */
  intercity_per_km: soum,
  per_minute: soum,
  /** The heaviest load the class takes (the order refuses more). */
  max_payload_kg: z.number().int().min(50).max(20_000),
});
export type CargoClassTariff = z.infer<typeof CargoClassTariff>;

export const CargoRules = z.object({
  /** Cargo orders are accepted (the quote offers the service). */
  enabled: z.boolean(),
  classes: z.object({ cargo_s: CargoClassTariff, cargo_m: CargoClassTariff }),
  /** One loader (the driver's helper who loads, unloads and carries), per person. */
  loader_price: soum,
  max_loaders: z.number().int().min(0).max(4),
  /** A fixed add-on at night (Tashkent time), as for taxi rides. */
  night: z.object({ percent: z.number().int().min(0).max(100), from: HHMM, to: HHMM }),
  /** Road distance from which the intercity per-km price applies. */
  intercity_from_km: z.number().int().min(5).max(500),
  /** A parcel carried by a taxi car (the sender is not in the car). */
  delivery: z.object({
    enabled: z.boolean(),
    /** The delivery price as a share of the taxi fare of the same trip. */
    percent: z.number().int().min(10).max(300),
    /** The heaviest parcel a taxi car takes (a seat's worth). */
    max_weight_kg: z.number().int().min(1).max(50),
  }),
});
export type CargoRules = z.infer<typeof CargoRules>;

/**
 * Guliston launch defaults [H] (market research v2 §6.4): Yandex Fergana 2021 asked 58 000
 * including 10 km and 20 minutes, Guliston car fares are ~20% below Tashkent; medium ×1.6.
 */
export const DEFAULT_CARGO: CargoRules = {
  enabled: true,
  classes: {
    cargo_s: {
      base: 35_000,
      included_km: 10,
      included_minutes: 20,
      per_km: 1500,
      intercity_per_km: 1500,
      per_minute: 300,
      max_payload_kg: 700,
    },
    cargo_m: {
      base: 56_000,
      included_km: 10,
      included_minutes: 20,
      per_km: 2400,
      intercity_per_km: 2400,
      per_minute: 400,
      max_payload_kg: 1500,
    },
  },
  loader_price: 30_000,
  max_loaders: 2,
  night: { percent: 20, from: '23:00', to: '06:00' },
  intercity_from_km: 20,
  delivery: { enabled: true, percent: 100, max_weight_kg: 10 },
};

export interface CargoFareInput {
  roadM: number;
  cargoClass: CargoClass;
  loaders: number;
  /** When the load is picked up: decides the night add-on. */
  at: Date;
}

/** A cargo fare: the taxi Fare's shape (views, receipts, charges read it) plus its parts. */
export interface CargoFare extends Omit<Fare, 'rideClass'> {
  rideClass: CargoClass;
  cargo: {
    /** The class's base price (with the included km and minutes). */
    basePrice: number;
    includedKm: number;
    includedMinutes: number;
    /** Started km beyond the included ones, and their price. */
    extraKm: number;
    perKm: number;
    distance: number;
    perMinute: number;
    loaders: number;
    loaderPrice: number;
    loadersTotal: number;
    /** The heaviest load the class takes. */
    maxPayloadKg: number;
  };
}

export function cargoKind(roadM: number, rules: CargoRules): RideKind {
  return roadM >= rules.intercity_from_km * 1000 ? 'intercity' : 'city';
}

export function computeCargoFare(input: CargoFareInput, rules: CargoRules): CargoFare {
  const t = rules.classes[input.cargoClass];
  const kind = cargoKind(input.roadM, rules);
  const extraKm = Math.max(0, Math.ceil(input.roadM / 1000) - t.included_km);
  const perKm = kind === 'intercity' ? t.intercity_per_km : t.per_km;
  const distance = extraKm * perKm;
  const base = t.base + distance;
  const night = isNight(input.at, rules.night) ? Math.round((base * rules.night.percent) / 100) : 0;
  const loaders = Math.max(0, Math.min(input.loaders, rules.max_loaders));
  const loadersTotal = loaders * rules.loader_price;
  return {
    kind,
    rideClass: input.cargoClass,
    distanceM: input.roadM,
    insideM: input.roadM,
    outsideM: 0,
    base,
    outside: 0,
    night,
    options: {},
    total: roundUp100(base + night + loadersTotal),
    seat: null,
    cargo: {
      basePrice: t.base,
      includedKm: t.included_km,
      includedMinutes: t.included_minutes,
      extraKm,
      perKm,
      distance,
      perMinute: t.per_minute,
      loaders,
      loaderPrice: rules.loader_price,
      loadersTotal,
      maxPayloadKg: t.max_payload_kg,
    },
  };
}

/**
 * The tariff snapshot a cargo ride keeps (a valid taxi Tariff: cancellation and waiting
 * read it): the included loading minutes are the free waiting, then the class's per-minute
 * price. The included minutes cover loading at the pickup; unloading is not timed.
 */
export function cargoRideTariff(taxi: Tariff, rules: CargoRules, cargoClass: CargoClass): Tariff {
  const t = rules.classes[cargoClass];
  return { ...taxi, waiting: { free_minutes: t.included_minutes, per_minute: t.per_minute } };
}

/** A delivery's fare: the taxi fare of the trip, or the configured share of it. */
export function deliveryFare(
  fare: Fare,
  percent: number,
): Fare & { delivery: { percent: number } } {
  const total = percent === 100 ? fare.total : roundUp100((fare.total * percent) / 100);
  return { ...fare, total, seat: null, delivery: { percent } };
}
