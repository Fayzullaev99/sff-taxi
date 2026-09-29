import type {
  AdminRideItem,
  BookingRules,
  LiveBoard,
  LiveDriver,
  PoolRules,
  RideBase,
  RouteFareBody,
} from '../api/types';
import { SERVICE_TONE, SERVICES, type Tone } from './format';

/**
 * Wave 4 in the panel (docs/shared-rides.md): the seating rule, shared-ride prices, the
 * shared-ride rules form, fixed route prices and cars carrying several riders on the live map.
 */

/** Hard seating rule: one passenger in front, never more than two in the back. */
export const FRONT_SEATS = 1;
export const REAR_SEATS_MAX = 2;
export const MAX_PASSENGERS = FRONT_SEATS + REAR_SEATS_MAX;

/** "3 kishi (1 old, 2 orqa)": where a party of `n` sits. */
export function seatingText(n: number): string {
  const people = Math.max(1, Math.min(n, MAX_PASSENGERS));
  const front = Math.min(people, FRONT_SEATS);
  const rear = people - front;
  return rear ? `${people} kishi (${front} old, ${rear} orqa)` : `${people} kishi (old o‘rindiq)`;
}

/**
 * A rider's shared-ride discount, the same formula as the API (apps/api/src/lib/pool.ts
 * poolDiscount): the full percent once the full-discount share of their own trip was shared,
 * proportionally less below it; whole 100 so‘m, never more than the fare.
 */
export function poolDiscount(
  fare: number,
  tripM: number,
  sharedM: number,
  rules: Pick<PoolRules, 'discount_percent' | 'full_discount_share_percent'>,
): number {
  if (fare <= 0 || sharedM <= 0 || tripM <= 0) return 0;
  const needed = (tripM * rules.full_discount_share_percent) / 100;
  const share = Math.min(1, sharedM / needed);
  const discount = Math.floor((fare * rules.discount_percent * share) / 100 / 100) * 100;
  return Math.max(0, Math.min(fare, discount));
}

export interface PoolExampleInput {
  /** Each rider's own quoted price (alone). */
  fareA: number;
  fareB: number;
  /** Each rider's own trip. */
  tripAKm: number;
  tripBKm: number;
  /** The part of the road both ride together. */
  sharedKm: number;
}

export interface PoolExampleLine {
  fare: number;
  discount: number;
  pays: number;
}

/** Two riders sharing a car: what each pays and what the driver gets. */
export function poolExample(
  x: PoolExampleInput,
  rules: Pick<PoolRules, 'discount_percent' | 'full_discount_share_percent'>,
): { a: PoolExampleLine; b: PoolExampleLine; driver: number } {
  const line = (fare: number, tripKm: number): PoolExampleLine => {
    const shared = Math.min(x.sharedKm, tripKm);
    const discount = poolDiscount(fare, tripKm * 1000, shared * 1000, rules);
    return { fare, discount, pays: fare - discount };
  };
  const a = line(x.fareA, x.tripAKm);
  const b = line(x.fareB, x.tripBKm);
  return { a, b, driver: a.pays + b.pays };
}

/** The founder's example: A 100 000 for 40 km, B joins halfway to the same place (40 000). */
export const FOUNDER_EXAMPLE: PoolExampleInput = {
  fareA: 100_000,
  fareB: 40_000,
  tripAKm: 40,
  tripBKm: 20,
  sharedKm: 20,
};

/** Why an example cannot be computed (a field), or null. */
export function exampleProblems(
  x: Record<keyof PoolExampleInput, number | null>,
): Partial<Record<keyof PoolExampleInput, string>> {
  const out: Partial<Record<keyof PoolExampleInput, string>> = {};
  for (const k of ['fareA', 'fareB'] as const) {
    const v = x[k];
    if (v === null || v < 0 || v > 10_000_000) out[k] = 'Narxni kiriting';
  }
  for (const k of ['tripAKm', 'tripBKm', 'sharedKm'] as const) {
    const v = x[k];
    if (v === null || v < 0 || v > 1000) out[k] = '0–1000 km';
  }
  if (!out.sharedKm && x.sharedKm !== null) {
    const longest = Math.max(x.tripAKm ?? 0, x.tripBKm ?? 0);
    if (x.sharedKm > longest) out.sharedKm = 'Umumiy qism safarlardan uzun bo‘lmaydi';
  }
  return out;
}

// Shared-ride rules form (times in minutes on screen, seconds in the API) --------------------

export interface PoolForm {
  enabled: boolean;
  discount_percent: number | null;
  full_discount_share_percent: number | null;
  detour_city_min: number | null;
  detour_intercity_min: number | null;
  max_detour_percent: number | null;
  pickup_eta_min: number | null;
  search_radius_m: number | null;
  pool_preference_seconds: number | null;
  max_riders: number | null;
}

const toMin = (s: number) => Math.round((s / 60) * 100) / 100;

export function poolToForm(r: PoolRules): PoolForm {
  return {
    enabled: r.enabled,
    discount_percent: r.discount_percent,
    full_discount_share_percent: r.full_discount_share_percent,
    detour_city_min: toMin(r.max_detour_seconds_city),
    detour_intercity_min: toMin(r.max_detour_seconds_intercity),
    max_detour_percent: r.max_detour_percent,
    pickup_eta_min: toMin(r.max_pickup_eta_seconds),
    search_radius_m: r.search_radius_m,
    pool_preference_seconds: r.pool_preference_seconds,
    max_riders: r.max_riders,
  };
}

/** The API body of a valid form (call after poolFormProblems found nothing). */
export function formToPool(f: PoolForm): PoolRules {
  return {
    enabled: f.enabled,
    discount_percent: f.discount_percent!,
    full_discount_share_percent: f.full_discount_share_percent!,
    max_detour_seconds_city: Math.round(f.detour_city_min! * 60),
    max_detour_seconds_intercity: Math.round(f.detour_intercity_min! * 60),
    max_detour_percent: f.max_detour_percent!,
    max_pickup_eta_seconds: Math.round(f.pickup_eta_min! * 60),
    search_radius_m: f.search_radius_m!,
    pool_preference_seconds: f.pool_preference_seconds!,
    max_riders: f.max_riders!,
  };
}

/** The API's limits (PoolRules in apps/api/src/lib/pool.ts), in the form's units. */
export const POOL_LIMITS: Record<
  Exclude<keyof PoolForm, 'enabled'>,
  { min: number; max: number; integer: boolean }
> = {
  discount_percent: { min: 0, max: 50, integer: true },
  full_discount_share_percent: { min: 1, max: 100, integer: true },
  detour_city_min: { min: 1, max: 30, integer: false },
  detour_intercity_min: { min: 1, max: 60, integer: false },
  max_detour_percent: { min: 5, max: 200, integer: true },
  pickup_eta_min: { min: 1, max: 60, integer: false },
  search_radius_m: { min: 500, max: 50_000, integer: true },
  pool_preference_seconds: { min: 0, max: 600, integer: true },
  max_riders: { min: 2, max: MAX_PASSENGERS, integer: true },
};

export function poolFormProblems(f: PoolForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, lim] of Object.entries(POOL_LIMITS) as [
    keyof typeof POOL_LIMITS,
    (typeof POOL_LIMITS)[keyof typeof POOL_LIMITS],
  ][]) {
    const v = f[key];
    if (v === null || Number.isNaN(v)) out[key] = 'Qiymatni kiriting';
    else if (lim.integer && !Number.isInteger(v)) out[key] = 'Butun son';
    else if (v < lim.min || v > lim.max) out[key] = `${lim.min} dan ${lim.max} gacha`;
  }
  if (
    !out.detour_city_min &&
    !out.detour_intercity_min &&
    f.detour_intercity_min! < f.detour_city_min!
  ) {
    out.detour_intercity_min = 'Shaharlararo chegara shahardagidan kam bo‘lmasin';
  }
  if (!out.max_riders && f.max_riders! > MAX_PASSENGERS) {
    out.max_riders = `Ko‘pi bilan ${MAX_PASSENGERS} (1 old, 2 orqa)`;
  }
  return out;
}

// Deposits ---------------------------------------------------------------------------------

/** The deposit of a booking of `price` so‘m (the percent, at least the minimum, at most it). */
export function depositFor(
  price: number,
  r: Pick<BookingRules, 'deposit_percent' | 'deposit_min'>,
) {
  if (price <= 0 || r.deposit_percent <= 0) return 0;
  // the share rounded up to whole 1 000 so‘m (apps/api/src/lib/deposit.ts)
  const byPercent = Math.ceil((price * r.deposit_percent) / 100 / 1000) * 1000;
  return Math.min(price, Math.max(r.deposit_min, byPercent));
}

// Fixed route prices -----------------------------------------------------------------------

export interface RouteFareDraft extends Omit<RouteFareBody, 'seatPrice' | 'carPrice'> {
  seatPrice: number | null;
  carPrice: number | null;
  /** The operator ticked the price in (a price field may be left empty on purpose). */
  seatOn: boolean;
  carOn: boolean;
}

/** The API's rules for a route price (RouteFareBody in route-fares.service.ts). */
export function routeFareProblems(d: RouteFareDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d.from) out.from = 'Qayerdan?';
  if (!d.to) out.to = 'Qayerga?';
  if (d.from && d.from === d.to) out.to = 'Yo‘nalish bir joyda boshlanib tugamaydi';
  const money = (v: number | null) =>
    v !== null && Number.isInteger(v) && v >= 1000 && v <= 10_000_000;
  if (d.seatOn && !money(d.seatPrice)) out.seatPrice = '1 000 dan 10 000 000 so‘mgacha';
  if (d.carOn && !money(d.carPrice)) out.carPrice = '1 000 dan 10 000 000 so‘mgacha';
  if (!d.seatOn && !d.carOn) out.seatPrice = 'O‘rindiq yoki butun mashina narxi kerak';
  if (d.seatOn && d.carOn && !out.seatPrice && !out.carPrice && d.carPrice! < d.seatPrice!) {
    out.carPrice = 'Butun mashina bir o‘rindiqdan arzon bo‘lmaydi';
  }
  return out;
}

export function routeFareBody(d: RouteFareDraft): RouteFareBody {
  return {
    from: d.from,
    to: d.to,
    class: d.class,
    seatPrice: d.seatOn ? d.seatPrice : null,
    carPrice: d.carOn ? d.carPrice : null,
    isActive: d.isActive,
    bothWays: d.bothWays,
  };
}

// Rides ------------------------------------------------------------------------------------

/** Badges of a ride's wave-4 facts, for lists and the detail. */
export function rideTags(
  r: Pick<RideBase, 'shareable' | 'womenOnly' | 'fareMode' | 'pool'> &
    Partial<Pick<RideBase, 'service' | 'status' | 'scheduledFor' | 'fare'>>,
) {
  const tags: { label: string; tone: Tone }[] = [];
  // cargo and deliveries stand out; a taxi ride carries no service badge
  if (r.service && r.service !== 'taxi') {
    tags.push({ label: SERVICES[r.service], tone: SERVICE_TONE[r.service] });
  }
  // a ride for later held until its card deposit is paid
  if (r.status === 'awaiting_payment' && r.scheduledFor && (r.fare?.deposit ?? 0) > 0) {
    tags.push({ label: 'Depozit kutilmoqda', tone: 'amber' });
  }
  if (r.shareable || r.pool) tags.push({ label: 'Hamroh', tone: 'blue' });
  if (r.womenOnly) tags.push({ label: 'Ayol haydovchi', tone: 'brand' });
  if (r.fareMode === 'seat') tags.push({ label: 'O‘rindiq narxi', tone: 'amber' });
  return tags;
}

// The live map -----------------------------------------------------------------------------

/**
 * The live endpoint lists a car once per open ride it carries (a shared car: up to 3 rows).
 * One row per driver, with every ride: the first ride stays `rideId`.
 */
export function mergeLiveDrivers(board: LiveBoard): LiveBoard {
  const byId = new Map<string, LiveDriver>();
  let merged = false;
  for (const d of board.drivers) {
    const seen = byId.get(d.id);
    if (!seen) {
      byId.set(d.id, { ...d, rideIds: d.rideId ? [d.rideId] : [] });
      continue;
    }
    merged = true;
    if (d.rideId && !seen.rideIds!.includes(d.rideId)) seen.rideIds!.push(d.rideId);
    if (!seen.rideId && d.rideId) {
      seen.rideId = d.rideId;
      seen.rideStatus = d.rideStatus;
      seen.state = 'busy';
    }
  }
  return merged || board.drivers.some((d) => !d.rideIds)
    ? { ...board, drivers: [...byId.values()] }
    : board;
}

export interface CarLoad {
  /** Open rides (riders) in or waiting for the car. */
  rides: AdminRideItem[];
  /** People of those rides. */
  passengers: number;
  /** More than one rider, or a rider who agreed to share. */
  shared: boolean;
}

/** What a car on the board carries, from the board's open rides. */
export function carLoad(board: LiveBoard, driverId: string): CarLoad {
  const rides = board.rides.filter((r) => r.driverId === driverId);
  const passengers = rides.reduce((s, r) => s + (r.passengers ?? 1), 0);
  return {
    rides,
    passengers,
    shared: rides.length > 1 || rides.some((r) => r.pool !== null && r.pool !== undefined),
  };
}
