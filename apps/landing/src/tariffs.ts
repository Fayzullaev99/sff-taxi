import { config } from './config.ts';

/**
 * Prices for the "Narxlar" section: the API's public tariff at the launch city
 * (`GET /v1/tariffs?lat&lng`, apps/api src/modules/rides TariffsController: the published,
 * fixed prices) when it answers, else the launch tariff below, which mirrors
 * apps/api/src/lib/tariff.ts DEFAULT_TARIFF (keep them in step when the launch tariff
 * changes; the section says which one it shows).
 */

export interface PublicClassTariff {
  id: string;
  label: string;
  enabled: boolean;
  bands: { upToM: number; price: number }[];
  beyondPerKm: number;
  outsidePerKm: number;
  intercityPerKm: number;
  intercityMin: number;
}

export interface PublicTariffs {
  currency: 'UZS';
  classes: PublicClassTariff[];
  night: { percent: number; from: string; to: string };
  waiting: { freeMinutes: number; perMinute: number };
  options: { childSeat: number; luggage: number; pets: number; ac: number };
  stops: { perStop: number; freeMinutes: number };
  seats: { sharePercent: number; frontExtraPercent: number };
  cancellationFee: number;
  intercityFromKm: number;
  pool: { enabled: boolean; discountPercent: number };
  cargo: {
    enabled: boolean;
    classes: {
      id: string;
      base: number;
      includedKm: number;
      perKm: number;
      maxPayloadKg: number;
    }[];
    delivery: { enabled: boolean; maxWeightKg: number };
  };
  /** The city the live tariff is for (null for the built-in default). */
  city: string | null;
}

/** Central Guliston, the launch city (apps/api migrations/0002_geo.sql). */
export const LAUNCH_CITY = { lat: 40.49598, lng: 68.77587 };

export const FALLBACK_TARIFFS: PublicTariffs = {
  currency: 'UZS',
  classes: [
    {
      id: 'economy',
      label: 'Ekonom',
      enabled: true,
      bands: [
        { upToM: 2000, price: 5000 },
        { upToM: 4000, price: 7000 },
        { upToM: 7000, price: 10_000 },
      ],
      beyondPerKm: 900,
      outsidePerKm: 1500,
      intercityPerKm: 1700,
      intercityMin: 25_000,
    },
    {
      id: 'comfort',
      label: 'Komfort',
      enabled: true,
      bands: [
        { upToM: 2000, price: 6300 },
        { upToM: 4000, price: 8800 },
        { upToM: 7000, price: 12_500 },
      ],
      beyondPerKm: 1100,
      outsidePerKm: 1900,
      intercityPerKm: 2100,
      intercityMin: 31_000,
    },
    {
      id: 'minivan',
      label: 'Miniven',
      enabled: false,
      bands: [
        { upToM: 2000, price: 7000 },
        { upToM: 4000, price: 9800 },
        { upToM: 7000, price: 14_000 },
      ],
      beyondPerKm: 1300,
      outsidePerKm: 2100,
      intercityPerKm: 2400,
      intercityMin: 35_000,
    },
    {
      id: 'business',
      label: 'Biznes',
      enabled: false,
      bands: [
        { upToM: 2000, price: 9500 },
        { upToM: 4000, price: 13_300 },
        { upToM: 7000, price: 19_000 },
      ],
      beyondPerKm: 1800,
      outsidePerKm: 2900,
      intercityPerKm: 3300,
      intercityMin: 47_500,
    },
  ],
  night: { percent: 20, from: '23:00', to: '06:00' },
  waiting: { freeMinutes: 2, perMinute: 500 },
  options: { childSeat: 2000, luggage: 2000, pets: 3000, ac: 0 },
  stops: { perStop: 1000, freeMinutes: 3 },
  seats: { sharePercent: 30, frontExtraPercent: 10 },
  cancellationFee: 3000,
  intercityFromKm: 20,
  pool: { enabled: true, discountPercent: 15 },
  cargo: {
    enabled: true,
    classes: [
      { id: 'cargo_s', base: 35_000, includedKm: 10, perKm: 1500, maxPayloadKg: 700 },
      { id: 'cargo_m', base: 56_000, includedKm: 10, perKm: 2400, maxPayloadKg: 1500 },
    ],
    delivery: { enabled: true, maxWeightKg: 10 },
  },
  city: null,
};

/** The in-city price of a class for a road distance (the bands, then per started km). */
export function cityFare(cls: PublicClassTariff, meters: number): number {
  const band = cls.bands.find((b) => meters <= b.upToM);
  if (band) return band.price;
  const last = cls.bands[cls.bands.length - 1];
  if (!last) return 0;
  const extraKm = Math.ceil((meters - last.upToM) / 1000);
  return roundUp100(last.price + extraKm * cls.beyondPerKm);
}

/** Whole-car intercity price for a road distance. */
export function intercityFare(cls: PublicClassTariff, meters: number): number {
  return Math.max(cls.intercityMin, roundUp100(Math.ceil(meters / 1000) * cls.intercityPerKm));
}

export const roundUp100 = (n: number) => Math.ceil(n / 100) * 100;

/** 12500 -> "12 500" (a narrow no-break space keeps the groups on one line). */
export function money(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The API's tariff document (apps/api/src/lib/tariff.ts `Tariff`), as the endpoint returns it. */
export interface ApiClassTariff {
  enabled: boolean;
  bands: { up_to_m: number; price: number }[];
  beyond_per_km: number;
  outside_per_km: number;
  intercity_per_km: number;
  intercity_min: number;
}
export interface ApiTariffResponse {
  serviceable: boolean;
  city: string | null;
  tariff: {
    classes: Record<string, ApiClassTariff>;
    night: { percent: number; from: string; to: string };
    waiting: { free_minutes: number; per_minute: number };
    options: { child_seat: number; luggage: number; pets: number; ac: number };
    seats: { share_percent: number; front_extra_percent: number };
    intercity_from_km: number;
    cancellation_fee: number;
    stops?: { per_stop: number; free_minutes: number };
  } | null;
}

const CLASS_ORDER = ['economy', 'comfort', 'minivan', 'business'];

/** The API document in the page's shape; pool and cargo keep the built-in values. */
export function fromApi(body: ApiTariffResponse): PublicTariffs | null {
  if (!body.serviceable || !body.tariff) return null;
  const t = body.tariff;
  const ids = [
    ...CLASS_ORDER.filter((id) => id in t.classes),
    ...Object.keys(t.classes).filter((id) => !CLASS_ORDER.includes(id)),
  ];
  return {
    currency: 'UZS',
    classes: ids.map((id) => {
      const c = t.classes[id]!;
      const fallback = FALLBACK_TARIFFS.classes.find((f) => f.id === id);
      return {
        id,
        label: fallback?.label ?? id,
        enabled: c.enabled,
        bands: c.bands.map((b) => ({ upToM: b.up_to_m, price: b.price })),
        beyondPerKm: c.beyond_per_km,
        outsidePerKm: c.outside_per_km,
        intercityPerKm: c.intercity_per_km,
        intercityMin: c.intercity_min,
      };
    }),
    night: { percent: t.night.percent, from: t.night.from, to: t.night.to },
    waiting: { freeMinutes: t.waiting.free_minutes, perMinute: t.waiting.per_minute },
    options: {
      childSeat: t.options.child_seat,
      luggage: t.options.luggage,
      pets: t.options.pets,
      ac: t.options.ac,
    },
    stops: t.stops
      ? { perStop: t.stops.per_stop, freeMinutes: t.stops.free_minutes }
      : FALLBACK_TARIFFS.stops,
    seats: { sharePercent: t.seats.share_percent, frontExtraPercent: t.seats.front_extra_percent },
    cancellationFee: t.cancellation_fee,
    intercityFromKm: t.intercity_from_km,
    pool: FALLBACK_TARIFFS.pool,
    cargo: FALLBACK_TARIFFS.cargo,
    city: body.city,
  };
}

/** A light shape check so a changed API never breaks the page: fall back instead. */
export function isApiTariffResponse(v: unknown): v is ApiTariffResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.serviceable !== 'boolean') return false;
  if (!o.serviceable) return true;
  const t = o.tariff as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') return false;
  const classes = t.classes as Record<string, unknown> | undefined;
  return (
    !!classes &&
    typeof classes === 'object' &&
    Object.values(classes).every(
      (c) =>
        c &&
        typeof c === 'object' &&
        Array.isArray((c as ApiClassTariff).bands) &&
        typeof (c as ApiClassTariff).beyond_per_km === 'number',
    ) &&
    typeof t.night === 'object' &&
    typeof t.waiting === 'object' &&
    typeof t.cancellation_fee === 'number'
  );
}

/** Fetches the launch city's tariff; any failure (offline, an older API) gives null. */
export async function fetchTariffs(
  fetchFn: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<PublicTariffs | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({
      lat: String(LAUNCH_CITY.lat),
      lng: String(LAUNCH_CITY.lng),
    });
    const res = await fetchFn(`${config.apiUrl}/v1/tariffs?${query}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return isApiTariffResponse(body) ? fromApi(body) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
