import type {
  AdminRideItem,
  CargoClass,
  CargoClassTariff,
  CargoRules,
  LiveDriver,
  RideService,
} from '../api/types';

/**
 * Cargo ("Yuk tashish") and delivery ("Yetkazib berish") in the panel (docs/shared-rides.md
 * §8): the price as the API computes it (apps/api/src/lib/cargo.ts computeCargoFare), the
 * settings form's rules, and which rides and cars are cargo ones.
 */

const roundUp100 = (n: number) => Math.ceil(n / 100) * 100;

export interface CargoExample {
  cargoClass: CargoClass;
  km: number;
  loaders: number;
  night: boolean;
}

export interface CargoPrice {
  kind: 'city' | 'intercity';
  base: number;
  extraKm: number;
  perKm: number;
  distance: number;
  night: number;
  loaders: number;
  loadersTotal: number;
  total: number;
}

/** A cargo fare: the class's base (with its included km), km beyond, night, loaders. */
export function cargoPrice(x: CargoExample, rules: CargoRules): CargoPrice {
  const t = rules.classes[x.cargoClass];
  const roadM = x.km * 1000;
  const kind = roadM >= rules.intercity_from_km * 1000 ? 'intercity' : 'city';
  const extraKm = Math.max(0, Math.ceil(roadM / 1000) - t.included_km);
  const perKm = kind === 'intercity' ? t.intercity_per_km : t.per_km;
  const distance = extraKm * perKm;
  const base = t.base + distance;
  const night = x.night ? Math.round((base * rules.night.percent) / 100) : 0;
  const loaders = Math.max(0, Math.min(x.loaders, rules.max_loaders));
  const loadersTotal = loaders * rules.loader_price;
  return {
    kind,
    base,
    extraKm,
    perKm,
    distance,
    night,
    loaders,
    loadersTotal,
    total: roundUp100(base + night + loadersTotal),
  };
}

const int = (min: number, max: number) => ({ min, max });

/** The API's limits (CargoRules). */
export const CLASS_LIMITS: Record<keyof CargoClassTariff, { min: number; max: number }> = {
  base: int(0, 10_000_000),
  included_km: int(0, 100),
  included_minutes: int(0, 30),
  per_km: int(0, 10_000_000),
  intercity_per_km: int(0, 10_000_000),
  per_minute: int(0, 10_000_000),
  max_payload_kg: int(50, 20_000),
};

/** A draft: numbers the operator is typing may be null. */
export type Nullable<T> = {
  [K in keyof T]: T[K] extends number ? number | null : T[K] extends object ? Nullable<T[K]> : T[K];
};
export type CargoDraft = Nullable<CargoRules>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems keyed by path ("classes.cargo_s.base", "delivery.percent"). */
export function cargoProblems(d: CargoDraft): Record<string, string> {
  const out: Record<string, string> = {};
  const check = (key: string, v: number | null, min: number, max: number) => {
    if (v === null || Number.isNaN(v)) out[key] = 'Qiymatni kiriting';
    else if (!Number.isInteger(v)) out[key] = 'Butun son';
    else if (v < min || v > max) out[key] = `${min} dan ${max} gacha`;
  };
  for (const c of ['cargo_s', 'cargo_m'] as const) {
    for (const [k, lim] of Object.entries(CLASS_LIMITS)) {
      check(`classes.${c}.${k}`, d.classes[c][k as keyof CargoClassTariff], lim.min, lim.max);
    }
  }
  check('loader_price', d.loader_price, 0, 10_000_000);
  check('max_loaders', d.max_loaders, 0, 4);
  check('night.percent', d.night.percent, 0, 100);
  if (!HHMM.test(d.night.from)) out['night.from'] = 'SS:DD';
  if (!HHMM.test(d.night.to)) out['night.to'] = 'SS:DD';
  check('intercity_from_km', d.intercity_from_km, 5, 500);
  check('delivery.percent', d.delivery.percent, 10, 300);
  check('delivery.max_weight_kg', d.delivery.max_weight_kg, 1, 50);
  const s = d.classes.cargo_s.max_payload_kg;
  const m = d.classes.cargo_m.max_payload_kg;
  if (!out['classes.cargo_m.max_payload_kg'] && s !== null && m !== null && m < s) {
    out['classes.cargo_m.max_payload_kg'] = 'O‘rta sinf kichigidan kam ko‘tarmaydi';
  }
  return out;
}

/** What a car on the live board is: a cargo car (by its class) or a taxi. */
export function isCargoCar(d: Pick<LiveDriver, 'cargoClass'>): boolean {
  return Boolean(d.cargoClass);
}

/** A ride's service (older API builds send none: a taxi ride). */
export function serviceOf(r: Pick<AdminRideItem, 'service'>): RideService {
  return r.service ?? 'taxi';
}

/** A scheduled ride held until its card deposit is paid. */
export function awaitingDeposit(
  r: Pick<AdminRideItem, 'status' | 'scheduledFor' | 'fare'>,
): boolean {
  return r.status === 'awaiting_payment' && r.scheduledFor !== null && (r.fare.deposit ?? 0) > 0;
}
