import type { ClassTariff, RideClass, RideKind, RideOption, Tariff } from '../api/types';

/**
 * The fare rules of apps/api/src/lib/tariff.ts, for the editor's live calculator. The API
 * splits a route into the parts inside and outside the city polygon; here the operator types
 * those distances directly, so the arithmetic is exactly the API's.
 */

export const roundUp100 = (amount: number) => Math.ceil(amount / 100) * 100;

/** Price of `metres` inside the city: the first band that covers it, then per started km. */
export function bandPrice(metres: number, t: ClassTariff): number {
  const band = t.bands.find((b) => metres <= b.up_to_m);
  if (band) return band.price;
  const last = t.bands.at(-1);
  if (!last) return 0;
  return last.price + Math.ceil((metres - last.up_to_m) / 1000) * t.beyond_per_km;
}

export interface CalcInput {
  rideClass: RideClass;
  /** Road metres inside the city polygon. */
  insideM: number;
  /** Road metres outside it (suburbs, villages). */
  outsideM: number;
  options: RideOption[];
  night: boolean;
}

export interface CalcFare {
  kind: RideKind;
  base: number;
  outside: number;
  night: number;
  options: number;
  total: number;
  seat: { rear: number; front: number } | null;
}

export function calcFare(input: CalcInput, tariff: Tariff): CalcFare {
  const t = tariff.classes[input.rideClass];
  const roadM = input.insideM + input.outsideM;
  const kind: RideKind = roadM >= tariff.intercity_from_km * 1000 ? 'intercity' : 'city';
  let base: number;
  let outside = 0;
  if (kind === 'intercity') {
    base = Math.max(t.intercity_min, Math.ceil(roadM / 1000) * t.intercity_per_km);
  } else {
    outside = input.outsideM > 0 ? Math.ceil(input.outsideM / 1000) * t.outside_per_km : 0;
    base = bandPrice(input.insideM, t) + outside;
  }
  const night = input.night ? Math.round((base * tariff.night.percent) / 100) : 0;
  const options = [...new Set(input.options)].reduce((s, o) => s + tariff.options[o], 0);
  const total = roundUp100(base + night + options);
  const rear = roundUp100((total * tariff.seats.share_percent) / 100);
  return {
    kind,
    base,
    outside,
    night,
    options,
    total,
    seat:
      kind === 'intercity'
        ? { rear, front: roundUp100((rear * (100 + tariff.seats.front_extra_percent)) / 100) }
        : null,
  };
}

const minuteOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Whether a Tashkent wall-clock minute falls in the night window (may run past midnight). */
export function isNightMinute(minute: number, night: Tariff['night']): boolean {
  const from = minuteOf(night.from);
  const to = minuteOf(night.to);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Whether it is night in Tashkent now (UTC+5, no DST). */
export function isNightNow(night: Tariff['night'], now = Date.now()): boolean {
  const d = new Date(now + 5 * 3600_000);
  return isNightMinute(d.getUTCHours() * 60 + d.getUTCMinutes(), night);
}

export interface Problem {
  path: string;
  message: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isSoum = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const isInt = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** The API's zod rules for a tariff (apps/api/src/lib/tariff.ts), in the operator's words. */
export function validateTariff(t: Tariff): Problem[] {
  const out: Problem[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  for (const c of ['economy', 'comfort'] as const) {
    const k = t.classes[c];
    const p = `classes.${c}`;
    if (k.bands.length < 1 || k.bands.length > 10) add(`${p}.bands`, '1 tadan 10 tagacha oraliq');
    k.bands.forEach((b, i) => {
      if (!isInt(b.up_to_m, 100, 100_000))
        add(`${p}.bands.${i}.up_to_m`, 'Masofa 0,1 dan 100 km gacha');
      if (!isSoum(b.price)) add(`${p}.bands.${i}.price`, 'Narxni kiriting');
      const prev = k.bands[i - 1];
      if (prev && !(b.up_to_m > prev.up_to_m && b.price >= prev.price)) {
        add(
          `${p}.bands.${i}.up_to_m`,
          'Oraliqlar masofa bo‘yicha o‘sib borishi, narx kamaymasligi kerak',
        );
      }
    });
    for (const f of [
      'beyond_per_km',
      'outside_per_km',
      'intercity_per_km',
      'intercity_min',
    ] as const) {
      if (!isSoum(k[f])) add(`${p}.${f}`, 'Summani kiriting');
    }
  }
  if (!isInt(t.night.percent, 0, 100)) add('night.percent', '0–100%');
  if (!HHMM.test(t.night.from)) add('night.from', 'SS:DD');
  if (!HHMM.test(t.night.to)) add('night.to', 'SS:DD');
  if (!isInt(t.waiting.free_minutes, 0, 30)) add('waiting.free_minutes', '0–30 daqiqa');
  if (!isSoum(t.waiting.per_minute)) add('waiting.per_minute', 'Summani kiriting');
  for (const o of ['child_seat', 'luggage', 'pets', 'ac'] as const) {
    if (!isSoum(t.options[o])) add(`options.${o}`, 'Summani kiriting (0 = bepul)');
  }
  if (!isInt(t.seats.share_percent, 1, 100)) add('seats.share_percent', '1–100%');
  if (!isInt(t.seats.front_extra_percent, 0, 100)) add('seats.front_extra_percent', '0–100%');
  if (!isInt(t.intercity_from_km, 5, 500)) add('intercity_from_km', '5–500 km');
  if (!isInt(t.service_radius_km, 0, 100)) add('service_radius_km', '0–100 km');
  if (!isSoum(t.cancellation_fee)) add('cancellation_fee', 'Summani kiriting');
  return out;
}

/** The launch tariff (the API's DEFAULT_TARIFF), used to start a city's own tariff. */
export const DEFAULT_TARIFF: Tariff = {
  classes: {
    economy: {
      bands: [
        { up_to_m: 2000, price: 5000 },
        { up_to_m: 4000, price: 7000 },
        { up_to_m: 7000, price: 10_000 },
      ],
      beyond_per_km: 900,
      outside_per_km: 1500,
      intercity_per_km: 1700,
      intercity_min: 25_000,
    },
    comfort: {
      bands: [
        { up_to_m: 2000, price: 6300 },
        { up_to_m: 4000, price: 8800 },
        { up_to_m: 7000, price: 12_500 },
      ],
      beyond_per_km: 1100,
      outside_per_km: 1900,
      intercity_per_km: 2100,
      intercity_min: 31_000,
    },
  },
  night: { percent: 20, from: '23:00', to: '06:00' },
  waiting: { free_minutes: 2, per_minute: 500 },
  options: { child_seat: 2000, luggage: 2000, pets: 3000, ac: 0 },
  seats: { share_percent: 30, front_extra_percent: 10 },
  intercity_from_km: 20,
  service_radius_km: 15,
  cancellation_fee: 3000,
};
